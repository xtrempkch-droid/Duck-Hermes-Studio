'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const { fetch: fetchUrl } = require('./http-client');

const DATA_DIR = path.join(__dirname, '..', 'data');
const MACHINES_FILE = path.join(DATA_DIR, 'machines.json');
const HISTORY_FILE = path.join(DATA_DIR, 'runner-history.json');

const PROBE_TIMEOUT_MS = 1500;
const RUN_TIMEOUT_MS = 180000;
const HISTORY_LIMIT = 20;
const DEFAULT_TEST_COMMAND = 'npm test';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0']);
const ALLOWED_BINARIES = new Set(['npm', 'node', 'npx', 'docker', 'python3', 'pytest', 'make', 'bash', 'sh']);
const FORBIDDEN_TOKENS = /[;&|`$<>(){}\n\r]/;

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
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

function sanitizeText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength || 120);
}

function isLocalHost(host) {
  return LOCAL_HOSTS.has(String(host || '').toLowerCase());
}

function validateCommand(command) {
  const text = String(command || '').trim();
  if (!text) return DEFAULT_TEST_COMMAND;

  if (FORBIDDEN_TOKENS.test(text)) {
    throw httpError('comando contém caracteres não permitidos', 400);
  }

  const binary = text.split(/\s+/)[0];
  if (!ALLOWED_BINARIES.has(binary)) {
    throw httpError(
      `comando deve começar com um destes: ${[...ALLOWED_BINARIES].join(', ')}`,
      400
    );
  }

  return text.slice(0, 200);
}

function normalizeMachine(input, existing) {
  const source = input || {};
  const base = existing || {};

  const name = sanitizeText(source.name || base.name, 60);
  if (!name) throw httpError('nome da máquina é obrigatório', 400);

  const host = sanitizeText(source.host || base.host, 120);
  if (!host) throw httpError('host da máquina é obrigatório', 400);
  if (!/^[A-Za-z0-9._:-]+$/.test(host)) throw httpError('host inválido', 400);

  const role = (source.role || base.role || 'runner').toLowerCase();
  if (!['runner', 'llm', 'both'].includes(role)) {
    throw httpError('papel deve ser runner, llm ou both', 400);
  }

  const port = Number(source.port || base.port || 22);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw httpError('porta SSH inválida', 400);
  }

  const user = sanitizeText(source.user || base.user, 60);
  if (user && !/^[A-Za-z0-9._-]+$/.test(user)) throw httpError('usuário SSH inválido', 400);

  const llmUrl = sanitizeText(source.llmUrl || base.llmUrl, 200).replace(/\/$/, '');
  const llmModel = sanitizeText(source.llmModel || base.llmModel, 120);

  if (role === 'llm' || role === 'both') {
    if (!llmUrl) throw httpError('máquina com papel llm precisa de llmUrl', 400);
    if (!/^https?:\/\/[A-Za-z0-9._:-]+(:\d+)?(\/[A-Za-z0-9._-]+)*$/.test(llmUrl)) {
      throw httpError('llmUrl inválida', 400);
    }
  }

  const testCommand = validateCommand(source.testCommand || base.testCommand);

  return {
    id: base.id || crypto.randomBytes(6).toString('hex'),
    name,
    host,
    port,
    user,
    role,
    llmUrl,
    llmModel,
    testCommand,
    createdAt: base.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function listMachines() {
  const data = readJsonFile(MACHINES_FILE, { machines: [] });
  return Array.isArray(data.machines) ? data.machines : [];
}

async function saveMachines(machines) {
  await writeJsonFile(MACHINES_FILE, { machines });
}

async function addMachine(input) {
  const machines = listMachines();
  const machine = normalizeMachine(input);

  if (machines.some((item) => item.name.toLowerCase() === machine.name.toLowerCase())) {
    throw httpError('já existe uma máquina com esse nome', 409);
  }

  machines.push(machine);
  await saveMachines(machines);
  return machine;
}

async function removeMachine(id) {
  const machines = listMachines();
  const index = machines.findIndex((item) => item.id === id);
  if (index === -1) throw httpError('máquina não encontrada', 404);

  const [removed] = machines.splice(index, 1);
  await saveMachines(machines);
  return removed;
}

function getMachine(id) {
  return listMachines().find((item) => item.id === id) || null;
}

function execCaptured(file, args, timeout) {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout, maxBuffer: 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          code: error && typeof error.code === 'number' ? error.code : error ? 1 : 0,
          timedOut: Boolean(error && error.killed),
          stdout: String(stdout || ''),
          stderr: String(stderr || '') || (error && !error.killed ? error.message : ''),
        });
      }
    );
  });
}

function sshArgs(machine, remoteCommand) {
  const target = machine.user ? `${machine.user}@${machine.host}` : machine.host;
  return [
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=5',
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-p',
    String(machine.port || 22),
    target,
    remoteCommand,
  ];
}

function runCommand(machine, command, timeout) {
  if (isLocalHost(machine.host)) {
    const parts = command.split(/\s+/);
    return execCaptured(parts[0], parts.slice(1), timeout);
  }
  return execCaptured('ssh', sshArgs(machine, command), timeout);
}

function trimOutput(text) {
  const value = String(text || '');
  return value.length > 4000 ? `${value.slice(0, 4000)}\n… (saída truncada)` : value;
}

async function probeLlm(machine) {
  try {
    const response = await fetchUrl(`${machine.llmUrl}/models`, { timeout: PROBE_TIMEOUT_MS });
    if (!response.ok) {
      return { ok: false, kind: 'llm', error: `HTTP ${response.status}` };
    }
    const data = await response.json().catch(() => ({}));
    const models = Array.isArray(data.data) ? data.data.map((item) => item.id).filter(Boolean) : [];
    return { ok: true, kind: 'llm', models };
  } catch (error) {
    return { ok: false, kind: 'llm', error: `sem resposta em ${PROBE_TIMEOUT_MS}ms` };
  }
}

async function probeRunner(machine) {
  const result = await runCommand(machine, 'docker version --format {{.Server.Version}}', 5000);
  const version = result.stdout.trim();

  return {
    ok: result.ok && Boolean(version),
    kind: 'runner',
    dockerVersion: version || null,
    error: result.ok ? null : trimOutput(result.stderr) || 'docker indisponível',
    hint: result.ok ? null : 'Instale o Docker na máquina e libere o acesso SSH (BatchMode)',
  };
}

async function probeMachine(id) {
  const machine = getMachine(id);
  if (!machine) throw httpError('máquina não encontrada', 404);

  const results = {};
  if (machine.role === 'llm' || machine.role === 'both') results.llm = await probeLlm(machine);
  if (machine.role === 'runner' || machine.role === 'both') results.runner = await probeRunner(machine);

  return { id: machine.id, name: machine.name, results };
}

function readHistory() {
  const data = readJsonFile(HISTORY_FILE, { runs: [] });
  return Array.isArray(data.runs) ? data.runs : [];
}

async function appendHistory(entry) {
  const runs = readHistory();
  runs.unshift(entry);
  await writeJsonFile(HISTORY_FILE, { runs: runs.slice(0, HISTORY_LIMIT) });
  return entry;
}

async function runTests(id) {
  const machine = getMachine(id);
  if (!machine) throw httpError('máquina não encontrada', 404);
  if (machine.role === 'llm') throw httpError('esta máquina não executa testes', 400);

  const startedAt = Date.now();
  const result = await runCommand(machine, machine.testCommand, RUN_TIMEOUT_MS);
  const durationMs = Date.now() - startedAt;

  const entry = {
    id: crypto.randomBytes(4).toString('hex'),
    machineId: machine.id,
    machineName: machine.name,
    command: machine.testCommand,
    mode: isLocalHost(machine.host) ? 'local' : 'ssh',
    ok: result.ok,
    code: result.code,
    timedOut: result.timedOut,
    durationMs,
    stdout: trimOutput(result.stdout),
    stderr: trimOutput(result.stderr),
    ranAt: new Date().toISOString(),
  };

  await appendHistory(entry);
  return entry;
}

function llmProvidersFromMachines(machines) {
  return (machines || [])
    .filter((machine) => (machine.role === 'llm' || machine.role === 'both') && machine.llmUrl)
    .map((machine) => ({
      id: `machine:${machine.id}`,
      name: `${machine.name} (rede)`,
      endpoint: machine.llmUrl,
      kind: 'machine',
      machineId: machine.id,
      installHint: `Verifique se ${machine.llmUrl} está acessível na rede local`,
    }));
}

module.exports = {
  DEFAULT_TEST_COMMAND,
  listMachines,
  addMachine,
  removeMachine,
  getMachine,
  probeMachine,
  runTests,
  readHistory,
  llmProvidersFromMachines,
  isLocalHost,
};
