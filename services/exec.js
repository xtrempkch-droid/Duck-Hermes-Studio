'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const fileStore = require('./file-store');
const sandbox = require('./sandbox');
const activity = require('./activity-log');
const diagnostics = require('./diagnostics');

const { dataDir } = require('./paths');

function historyFile() {
  return path.join(dataDir(), 'exec-history.json');
}

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_TIMEOUT_MS = 120000;
const HISTORY_LIMIT = 30;
const OUTPUT_LIMIT = 20000;
const APPROVAL_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING = 20;

const ALLOWED_BINARIES = new Set([
  'python3',
  'python',
  'node',
  'npm',
  'npx',
  'pytest',
  'make',
  'bash',
  'sh',
]);

const FORBIDDEN_TOKENS = /[;&|`$<>\n\r]/;
const BLOCKED_PATTERN = /(^|\s)(sudo|su|doas)\s|rm\s+-rf\s+\/|mkfs|dd\s+if=|:\(\)\s*\{/i;
const NETWORK_HINTS = /\b(curl|wget|pip install|pip3 install|npm install|npm i|apt|apt-get|nc|ssh|scp)\b/i;

/**
 * Binários da allowlist que executam código arbitrário: com `bash script.sh`,
 * `node -e "..."` ou `python3 -c`, o texto do comando não descreve o que roda.
 * A allowlist só restringe o primeiro binário; a trava real nesses casos é a
 * aprovação humana. O rótulo vai para a UI para ninguém confundir com sandbox.
 */
const INTERPRETER_BINARIES = new Set([
  'python3',
  'python',
  'node',
  'npm',
  'npx',
  'pytest',
  'make',
  'bash',
  'sh',
]);

const RISK_NOTES = {
  interpreter:
    'interpretador: o script/argumento pode executar qualquer coisa no seu usuário — a aprovação é a trava, não a allowlist',
  direct: 'binário direto da allowlist',
  sandbox: 'container descartável: sem rede, sem capabilities e com limites',
};

function commandRisk(command, mode) {
  if (mode === 'sandbox') return { level: 'sandbox', note: RISK_NOTES.sandbox };

  const binary = String(command || '').trim().split(/\s+/)[0] || '';
  const base = binary.split(/[\\/]/).pop();
  return INTERPRETER_BINARIES.has(base)
    ? { level: 'interpreter', note: RISK_NOTES.interpreter }
    : { level: 'direct', note: RISK_NOTES.direct };
}

/** command -> approvedAt (ms). Aprovação é por comando, na primeira vez. */
const approved = new Map();
/** key -> { mode, cwd, command, image } para o status não precisar parsear a chave. */
const approvedInfo = new Map();
const pending = new Map();

let networkEnabled = false;

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function ensureDataDir() {
  const dir = dataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJsonFile(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return fallback;
  }
}

async function writeJsonFile(file, value) {
  ensureDataDir();
  const temporary = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
  await fsp.rename(temporary, file);
}

function normalizeCommand(rawCommand) {
  const command = String(rawCommand || '').trim();

  if (!command) throw httpError('comando obrigatório', 400);
  if (command.length > 200) throw httpError('comando muito longo (máx. 200)', 400);
  if (FORBIDDEN_TOKENS.test(command)) {
    throw httpError('comando contém caracteres não permitidos (; | & $ ` < > ou quebra de linha)', 400);
  }
  if (BLOCKED_PATTERN.test(command)) {
    throw httpError('comando bloqueado por segurança (sudo/su, rm -rf /, mkfs, dd)', 403);
  }

  const binary = command.split(/\s+/)[0];
  if (!ALLOWED_BINARIES.has(binary)) {
    throw httpError(
      `comando deve começar com um destes binários: ${[...ALLOWED_BINARIES].join(', ')}`,
      400
    );
  }

  return command;
}

/**
 * Divide o comando em argumentos respeitando aspas simples/duplas.
 * Não há shell: nada é interpretado, apenas separado.
 */
function tokenize(command) {
  const tokens = [];
  let current = '';
  let quote = null;
  let hasContent = false;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];

    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (char === '\\' && quote === '"' && index + 1 < command.length) {
        index += 1;
        current += command[index];
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      hasContent = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (hasContent || current) {
        tokens.push(current);
        current = '';
        hasContent = false;
      }
      continue;
    }

    current += char;
    hasContent = true;
  }

  if (quote) throw httpError('aspas não fechadas no comando', 400);
  if (hasContent || current) tokens.push(current);

  return tokens;
}

function normalizeCwd(rawCwd) {
  const requested = String(rawCwd || '').trim();
  const absolute = requested
    ? fileStore.resolvePath(requested)
    : fileStore.workspaceRoot();

  return { absolute, relative: fileStore.relativePath(absolute) };
}

function normalizeTimeout(rawTimeout) {
  const value = Number(rawTimeout);

  if (!rawTimeout || !Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  if (value <= 0) throw httpError('timeout deve ser positivo', 400);

  return Math.min(MAX_TIMEOUT_MS, Math.max(1000, Math.round(value)));
}

function approvalKey(command, cwdRelative) {
  return `${cwdRelative}::${command}`;
}

function isApproved(key) {
  const at = approved.get(key);
  if (!at) return false;
  if (Date.now() - at > APPROVAL_TTL_MS) {
    approved.delete(key);
    approvedInfo.delete(key);
    return false;
  }
  return true;
}

function prunePending() {
  const now = Date.now();
  for (const [id, item] of pending) {
    if (now - item.createdAt > APPROVAL_TTL_MS) pending.delete(id);
  }
  while (pending.size > MAX_PENDING) {
    pending.delete(pending.keys().next().value);
  }
}

/** Comando de sandbox é livre (o container é a fronteira); só se limita tamanho. */
function normalizeSandboxCommand(rawCommand) {
  const command = String(rawCommand || '').trim();
  if (!command) throw httpError('comando obrigatório', 400);
  if (command.length > 2000) throw httpError('comando muito longo (máx. 2000)', 400);
  if (command.includes('\0')) throw httpError('comando inválido', 400);
  return command;
}

function normalizeMode(rawMode) {
  const mode = String(rawMode || 'local').trim().toLowerCase();
  if (mode !== 'local' && mode !== 'sandbox') {
    throw httpError('mode deve ser "local" ou "sandbox"', 400);
  }
  return mode;
}

/**
 * Valida o pedido e, se o comando ainda não foi aprovado, cria uma aprovação
 * pendente. Nunca executa nada nesta etapa.
 */
async function requestExecution(input) {
  const body = input || {};
  const mode = normalizeMode(body.mode);
  const cwd = normalizeCwd(body.cwd);
  const timeout = normalizeTimeout(body.timeout);

  const network = body.network === true;
  if (network && !networkEnabled) {
    throw httpError('rede desabilitada; habilite em Configurações → Avançado', 403);
  }

  let base;

  if (mode === 'sandbox') {
    const dockerStatus = await sandbox.status();
    if (!dockerStatus.available) {
      throw httpError(
        'sandbox indisponível: ' +
          (dockerStatus.reason || 'docker não respondeu') +
          '. Instale o Docker ou use o modo local (sem isolamento).',
        409
      );
    }

    base = {
      mode,
      command: normalizeSandboxCommand(body.command),
      cwd: cwd.relative,
      absoluteCwd: cwd.absolute,
      timeout: Math.min(Math.max(timeout, 1000), 600000),
      image: sandbox.assertImage(body.image),
      network,
      isolation: 'docker',
      networkMode: network ? 'bridge' : 'none',
    };
  } else {
    base = {
      mode,
      command: normalizeCommand(body.command),
      cwd: cwd.relative,
      absoluteCwd: cwd.absolute,
      timeout,
      network,
      isolation: 'none',
      note: 'Este modo roda no seu usuário, sem container: a aprovação é a trava, não um sandbox.',
    };
  }

  const key = `${base.mode}::${base.image || '-'}::${base.networkMode || '-'}::${approvalKey(
    base.command,
    base.cwd
  )}`;

  base.risk = commandRisk(base.command, base.mode);

  if (isApproved(key)) {
    return { ...base, requiresApproval: false, approvalId: null };
  }

  prunePending();

  const approvalId = crypto.randomBytes(8).toString('hex');
  pending.set(approvalId, {
    id: approvalId,
    key,
    ...base,
    createdAt: Date.now(),
  });

  return {
    ...base,
    requiresApproval: true,
    approvalId,
    reason:
      mode === 'sandbox'
        ? 'primeira execução deste comando nesta imagem'
        : 'primeira execução deste comando',
    hint:
      mode === 'sandbox'
        ? 'Roda em container descartável: sem rede, sem capabilities, com limite de memória/CPU. Aprovação vale 10 minutos.'
        : 'Sem container: roda no seu usuário. A aprovação vale por 10 minutos.',
  };
}

function takeApproval(approvalId) {
  prunePending();

  const item = pending.get(String(approvalId || ''));
  if (!item) throw httpError('aprovação inválida ou expirada', 404);

  pending.delete(item.id);
  approved.set(item.key, Date.now());
  approvedInfo.set(item.key, {
    mode: item.mode,
    cwd: item.cwd,
    command: item.command,
    image: item.image || null,
  });
  return item;
}

function buildEnv(network) {
  const env = { ...process.env, HERMES_EXEC: '1' };

  // garante que node/npm do mesmo runtime estejam no PATH do filho
  const runtimeBin = path.dirname(process.execPath);
  env.PATH = env.PATH ? `${runtimeBin}${path.delimiter}${env.PATH}` : runtimeBin;

  if (!network) {
    // Best-effort: quebra clientes HTTP comuns, não é um sandbox.
    const dead = 'http://127.0.0.1:9';
    env.http_proxy = dead;
    env.https_proxy = dead;
    env.HTTP_PROXY = dead;
    env.HTTPS_PROXY = dead;
    env.NO_PROXY = '';
    env.no_proxy = '';
  }

  return env;
}

function trimOutput(text) {
  const value = String(text || '');
  if (value.length <= OUTPUT_LIMIT) return { value, truncated: false };
  return { value: `${value.slice(0, OUTPUT_LIMIT)}\n… (saída truncada)`, truncated: true };
}

function readHistory() {
  const data = readJsonFile(historyFile(), { runs: [] });
  return Array.isArray(data.runs) ? data.runs : [];
}

async function appendHistory(entry) {
  const runs = readHistory();
  runs.unshift(entry);
  await writeJsonFile(historyFile(), { runs: runs.slice(0, HISTORY_LIMIT) });
  return entry;
}

function runProcess(item) {
  return new Promise((resolve) => {
    const [binary, ...args] = tokenize(item.command);

    execFile(
      binary,
      args,
      {
        cwd: item.absoluteCwd,
        timeout: item.timeout,
        maxBuffer: 4 * 1024 * 1024,
        env: buildEnv(item.network),
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const timedOut = Boolean(error && error.killed);
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;

        resolve({
          ok: !error,
          code,
          timedOut,
          stdout: String(stdout || ''),
          stderr:
            String(stderr || '') ||
            (error && !timedOut ? String(error.message || '') : ''),
        });
      }
    );
  });
}

async function execute(input) {
  const request = await requestExecution(input);

  if (request.requiresApproval) {
    const error = httpError('execução requer aprovação', 428);
    error.payload = request;
    throw error;
  }

  return runApproved(request);
}

/** Registra a execução no log append-only e transforma stderr em diagnósticos. */
function recordExecution(item, result, durationMs) {
  const source = item.mode === 'sandbox' ? `sandbox:${item.image}` : 'exec:local';
  activity.log.hints.clearSource(source);

  const found = diagnostics.parseDiagnostics(result.stderr).map((diagnostic) => ({
    ...diagnostic,
    filePath: diagnostics.normalizeDiagnosticPath(
      diagnostic.filePath,
      fileStore.workspaceRoot(),
      item.mode === 'sandbox' ? '/workspace' : null
    ),
  }));

  for (const diagnostic of found) {
    activity.log.hints.add({
      filePath: diagnostic.filePath,
      line: diagnostic.line,
      column: diagnostic.column,
      message: diagnostics.formatDiagnostic(diagnostic),
      severity: diagnostic.severity,
      code: diagnostic.code,
      source,
    });
  }

  activity.log.recordRun({
    kind: item.mode === 'sandbox' ? 'sandbox' : 'local',
    image: item.mode === 'sandbox' ? item.image : sandbox.UNSANDBOXED_IMAGE_LABEL,
    command: item.command,
    exitCode: result.code,
    durationMs,
    timedOut: result.timedOut,
    stdout: result.stdout,
    stderr: result.stderr,
    metadata: { cwd: item.cwd, mode: item.mode, network: item.network },
  });

  return found;
}

function runProcessSandbox(item) {
  return sandbox.run({
    image: item.image,
    command: item.command,
    workspaceDir: fileStore.workspaceRoot(),
    network: item.networkMode || 'none',
    timeoutMs: item.timeout,
  });
}

async function runApproved(item) {
  const startedAt = Date.now();
  let result;
  let sandboxMeta = null;

  if (item.mode === 'sandbox') {
    const sandboxResult = await runProcessSandbox(item);
    sandboxMeta = {
      noNewPrivileges: sandboxResult.noNewPrivileges,
      warning: sandboxResult.warning || null,
      containerId: sandboxResult.containerId,
    };
    result = {
      ok: sandboxResult.exitCode === 0,
      code: sandboxResult.exitCode,
      timedOut: sandboxResult.timedOut,
      stdout: sandboxResult.stdout,
      stderr: sandboxResult.stderr,
    };
  } else {
    result = await runProcess(item);
  }

  const durationMs = Date.now() - startedAt;

  const stdout = trimOutput(result.stdout);
  const stderr = trimOutput(result.stderr);
  const found = recordExecution(item, result, durationMs);

  const entry = {
    id: crypto.randomBytes(4).toString('hex'),
    command: item.command,
    cwd: item.cwd,
    timeout: item.timeout,
    network: item.network,
    mode: item.mode,
    image: item.mode === 'sandbox' ? item.image : null,
    isolation: item.isolation,
    ok: result.ok,
    code: result.code,
    timedOut: result.timedOut,
    durationMs,
    stdout: stdout.value,
    stderr: stderr.value,
    truncated: stdout.truncated || stderr.truncated,
    diagnostics: found,
    sandbox: sandboxMeta,
    ranAt: new Date().toISOString(),
  };

  await appendHistory(entry);
  return entry;
}

/** Executa um comando já aprovado (usado pelo fluxo de aprovação). */
async function approveAndRun(approvalId) {
  const item = takeApproval(approvalId);
  return runApproved(item);
}

function setNetworkEnabled(value) {
  networkEnabled = Boolean(value);
  return networkEnabled;
}

function status() {
  prunePending();
  return {
    networkEnabled,
    approvedCommands: [...approved.keys()].map((key) => {
      const info = approvedInfo.get(key) || {};
      return {
        mode: info.mode || 'local',
        cwd: info.cwd || null,
        command: info.command || null,
        image: info.image || null,
        risk: commandRisk(info.command, info.mode),
      };
    }),
    pendingApprovals: pending.size,
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
    maxTimeoutMs: MAX_TIMEOUT_MS,
    allowedBinaries: [...ALLOWED_BINARIES],
    interpreterBinaries: [...INTERPRETER_BINARIES],
    allowlist: true,
    note:
      'A allowlist restringe o primeiro binário, não o que ele executa: bash/sh/node/python -c podem rodar qualquer coisa. A trava real é a aprovação; para isolamento use mode "sandbox".',
  };
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  requestExecution,
  approveAndRun,
  execute,
  readHistory,
  setNetworkEnabled,
  status,
  normalizeCommand,
  commandRisk,
  INTERPRETER_BINARIES,
  tokenize,
  normalizeCwd,
  normalizeTimeout,
  NETWORK_HINTS,
};
