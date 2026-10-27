'use strict';

const crypto = require('crypto');
const path = require('path');
const { execFile } = require('child_process');

const DOCKER_TIMEOUT_MS = 3000;
const DEFAULT_IMAGE = 'gcc:latest';
const MAX_OUTPUT_BYTES = 256 * 1024;

const DEFAULTS = {
  containerWorkspaceDir: '/workspace',
  network: 'none',
  memory: '512m',
  cpus: '1.0',
  timeoutMs: 120000,
};

/**
 * Quem executa o comando quando não há container.
 * O rótulo é o que impede a UI e o log de sugerirem isolamento que não existe.
 */
const UNSANDBOXED_IMAGE_LABEL = 'local (sem isolamento)';

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/** Parser mínimo de `docker version` para saber se há daemon falando. */
function dockerAvailable() {
  return new Promise((resolve) => {
    execFile(
      'docker',
      ['version', '--format', '{{.Server.Version}}'],
      { timeout: DOCKER_TIMEOUT_MS, windowsHide: true, maxBuffer: 64 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve({ available: false, version: null, reason: 'docker não encontrado ou sem daemon' });
          return;
        }
        resolve({ available: true, version: String(stdout || '').trim() || null, reason: null });
      }
    );
  });
}

let cache = null;
const CACHE_TTL_MS = 10000;

/** O estado do Docker é cacheado por 10 s para não pagar um spawn por clique. */
async function status(options) {
  const settings = options || {};
  if (!settings.refresh && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.value;
  }
  const value = await dockerAvailable();
  cache = { at: Date.now(), value };
  return value;
}

function invalidateStatusCache() {
  cache = null;
}

function currentUser() {
  const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
  const gid = typeof process.getgid === 'function' ? process.getgid() : undefined;
  return uid === undefined || gid === undefined ? null : `${uid}:${gid}`;
}

function assertImage(image) {
  const value = String(image || '').trim();
  if (!value) return DEFAULT_IMAGE;
  if (value.length > 200) throw httpError('imagem longa demais', 400);
  // nome[:tag] ou registry/namespace/nome@sha256:...
  if (!/^[a-z0-9][a-z0-9._/-]*(?::[A-Za-z0-9._-]+)?(?:@sha256:[a-f0-9]{64})?$/i.test(value)) {
    throw httpError('nome de imagem inválido', 400);
  }
  return value;
}

/** Monta o argv completo de `docker run` — argv[0] incluso, para testes e UI. */
function buildArgv(options) {
  const settings = options || {};
  const image = assertImage(settings.image);
  const containerId = `duck-hermes-${crypto.randomBytes(4).toString('hex')}`;
  const mountTarget = settings.containerWorkspaceDir || DEFAULTS.containerWorkspaceDir;

  if (!settings.workspaceDir) throw httpError('workspaceDir obrigatório', 400);

  const argv = [
    'docker',
    'run',
    '--rm',
    '--name',
    containerId,
    '-v',
    `${settings.workspaceDir}:${mountTarget}`,
    '-w',
    mountTarget,
    '--memory',
    settings.memory || DEFAULTS.memory,
    '--cpus',
    settings.cpus || DEFAULTS.cpus,
    '--cap-drop',
    'ALL',
    '--network',
    settings.network === 'bridge' || settings.network === 'host' ? settings.network : 'none',
  ];

  if (settings.noNewPrivileges !== false) argv.push('--security-opt', 'no-new-privileges');

  const user = settings.user === undefined ? currentUser() : settings.user;
  if (user) argv.push('--user', user);

  const env = { ...(settings.env || {}) };
  if (user && env.HOME === undefined) env.HOME = '/tmp';
  for (const [key, value] of Object.entries(env)) argv.push('-e', `${key}=${value}`);

  if (Array.isArray(settings.extraArgs)) argv.push(...settings.extraArgs);

  argv.push(image, 'sh', '-lc', String(settings.command || ''));

  return { argv, containerId, image, mountTarget };
}

function executor(argv, timeoutMs) {
  return new Promise((resolve) => {
    const [bin, ...args] = argv;
    const started = Date.now();

    execFile(
      bin,
      args,
      {
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: MAX_OUTPUT_BYTES * 4,
        env: { ...process.env, DOCKER_CLI_HINTS: 'false' },
      },
      (error, stdout, stderr) => {
        const timedOut = Boolean(error && error.killed);
        let code = 0;
        if (error) code = typeof error.code === 'number' ? error.code : timedOut ? 124 : 1;
        resolve({
          exitCode: code,
          stdout: String(stdout || '').slice(0, MAX_OUTPUT_BYTES),
          stderr: String(stderr || '').slice(0, MAX_OUTPUT_BYTES),
          timedOut,
          durationMs: Date.now() - started,
        });
      }
    );
  });
}

/** Roda o comando num container descartável com as travas acima. */
async function run(options) {
  const settings = options || {};

  const noNewPrivileges =
    settings.noNewPrivileges === undefined
      ? process.env.HERMES_SANDBOX_NO_NEW_PRIVILEGES !== '0'
      : settings.noNewPrivileges !== false;

  const build = (flag) => buildArgv({ ...settings, noNewPrivileges: flag });
  let plan = build(noNewPrivileges);
  const timeoutMs = Math.min(
    Math.max(Number(settings.timeoutMs) || DEFAULTS.timeoutMs, 1000),
    600000
  );
  const startedAt = Date.now();
  let result = await executor(plan.argv, timeoutMs);
  let warning = null;

  // Em alguns kernels `no-new-privileges` + `--user` faz todo execve falhar.
  // Em vez de entregar um sandbox que não roda, refaz sem a flag e diz que fez.
  if (noNewPrivileges && result.exitCode !== 0 && /exec .*operation not permitted/i.test(result.stderr)) {
    warning =
      'este kernel recusou no-new-privileges com o usuário atual; a execução foi repetida sem essa flag (as demais travas continuam)';
    plan = build(false);
    result = await executor(plan.argv, timeoutMs);
  }

  return {
    kind: 'sandbox',
    containerId: plan.containerId,
    image: plan.image,
    command: String(settings.command || ''),
    workspaceDir: path.resolve(settings.workspaceDir),
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: Date.now() - startedAt,
    startedAt,
    timedOut: result.timedOut,
    isolation: 'docker',
    noNewPrivileges: plan.argv.includes('no-new-privileges'),
    warning,
    argv: plan.argv,
  };
}

function shellArgv(command, platform) {
  return (platform || process.platform) === 'win32'
    ? ['cmd.exe', '/d', '/s', '/c', String(command)]
    : ['sh', '-lc', String(command)];
}

/**
 * Alternativa sem isolamento — usada só quando o chamador pede `local`.
 * Honesta: o rótulo do resultado diz o que aconteceu.
 */
async function runLocal(options) {
  const settings = options || {};
  const argv = shellArgv(settings.command);
  const result = await executor(argv, Number(settings.timeoutMs) || DEFAULTS.timeoutMs);

  return {
    kind: 'local',
    containerId: `local-${process.pid}`,
    image: UNSANDBOXED_IMAGE_LABEL,
    command: String(settings.command || ''),
    workspaceDir: path.resolve(settings.workspaceDir),
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: result.durationMs,
    startedAt: Date.now() - result.durationMs,
    timedOut: result.timedOut,
    isolation: 'none',
    argv,
  };
}

module.exports = {
  DEFAULT_IMAGE,
  DEFAULTS,
  UNSANDBOXED_IMAGE_LABEL,
  buildArgv,
  run,
  runLocal,
  shellArgv,
  status,
  invalidateStatusCache,
  assertImage,
  dockerAvailable,
  MAX_OUTPUT_BYTES,
};
