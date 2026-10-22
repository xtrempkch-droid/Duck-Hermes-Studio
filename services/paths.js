'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Destino dos dados graváveis (histórico, máquinas, devdocs, ai-talk, config).
 * Em execução normal é <repo>/data; no binário empacotado o entrypoint
 * aponta HERMES_DATA_DIR para uma pasta do usuário (o snapshot é somente leitura).
 */
function dataDir() {
  const configured = process.env.HERMES_DATA_DIR;
  if (configured && String(configured).trim()) return path.resolve(String(configured).trim());
  return path.join(__dirname, '..', 'data');
}

const STATE_FILE = () => path.join(dataDir(), 'workspace.json');
const MAX_RECENT = 8;
const MAX_BROWSE_ENTRIES = 300;

let runtimeRoot = null;

function readState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8'));
    return {
      path: typeof parsed.path === 'string' ? parsed.path : null,
      recent: Array.isArray(parsed.recent)
        ? parsed.recent.filter((item) => typeof item === 'string').slice(0, MAX_RECENT)
        : [],
    };
  } catch (error) {
    return { path: null, recent: [] };
  }
}

function writeState(state) {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(
      STATE_FILE(),
      JSON.stringify({ path: state.path, recent: state.recent.slice(0, MAX_RECENT) }, null, 2)
    );
  } catch (error) {
    /* pasta persistent é opcional: sem ela a escolha dura só a sessão */
  }
}

function isDirectory(candidate) {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch (error) {
    return false;
  }
}

function envRoot() {
  const configured = process.env.HERMES_WORKSPACE;
  return configured && String(configured).trim() ? path.resolve(String(configured).trim()) : null;
}

function persistedRoot() {
  const state = readState();
  return state.path && isDirectory(state.path) ? state.path : null;
}

/**
 * Precedência: "Abrir pasta" desta sessão > HERMES_WORKSPACE (ambiente ou
 * --workspace do binário) > pasta salva em data/workspace.json > cwd.
 */
function workspaceRoot() {
  if (runtimeRoot) return runtimeRoot;

  const env = envRoot();
  if (env) return env;

  const persisted = persistedRoot();
  if (persisted) return persisted;

  return path.resolve(process.cwd());
}

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function setWorkspace(requestedPath, options) {
  const settings = options || {};
  const raw = typeof requestedPath === 'string' ? requestedPath.trim() : '';
  if (!raw) throw httpError('informe a pasta', 400);
  if (raw.includes('\0')) throw httpError('caminho inválido', 400);

  const expanded = raw.startsWith('~') ? path.join(os.homedir(), raw.slice(1)) : raw;
  const absolute = path.resolve(expanded);

  if (!isDirectory(absolute)) throw httpError('pasta não encontrada: ' + absolute, 404);

  runtimeRoot = absolute;

  if (settings.persist !== false) {
    const state = readState();
    const recent = [absolute, ...state.recent.filter((item) => item !== absolute)];
    writeState({ path: absolute, recent });
  }

  return workspaceInfo();
}

function resetWorkspace() {
  runtimeRoot = null;
  const state = readState();
  writeState({ path: null, recent: state.recent });
  return workspaceInfo();
}

function driveRoots() {
  if (process.platform !== 'win32') return [];
  const roots = [];
  for (let code = 65; code <= 90; code += 1) {
    const letter = String.fromCharCode(code) + ':\\';
    if (isDirectory(letter)) roots.push(letter);
  }
  return roots;
}

function shortcutRoots() {
  const candidates = [
    { label: 'Pasta atual do workspace', path: workspaceRoot() },
    { label: 'Início', path: os.homedir() },
    { label: 'Área de trabalho', path: path.join(os.homedir(), 'Desktop') },
    { label: 'Documentos', path: path.join(os.homedir(), 'Documents') },
  ];

  const seen = new Set();
  return candidates.filter((item) => {
    if (!item.path || seen.has(item.path) || !isDirectory(item.path)) return false;
    seen.add(item.path);
    return true;
  });
}

function browse(requestedPath) {
  const raw = typeof requestedPath === 'string' ? requestedPath.trim() : '';
  const target = raw
    ? path.resolve(raw.startsWith('~') ? path.join(os.homedir(), raw.slice(1)) : raw)
    : workspaceRoot();

  if (!isDirectory(target)) throw httpError('pasta não encontrada: ' + target, 404);

  let dirents = [];
  try {
    dirents = fs.readdirSync(target, { withFileTypes: true });
  } catch (error) {
    throw httpError('sem permissão para listar ' + target, 403);
  }

  const entries = dirents
    .filter((entry) => {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) return false;
      return !entry.name.startsWith('.') || entry.name === '.github';
    })
    .filter((entry) => isDirectory(path.join(target, entry.name)))
    .map((entry) => {
      const full = path.join(target, entry.name);
      return {
        name: entry.name,
        path: full,
        isRepo: fs.existsSync(path.join(full, '.git')),
      };
    })
    .sort((a, b) => {
      if (a.isRepo !== b.isRepo) return a.isRepo ? -1 : 1;
      return a.name.localeCompare(b.name, 'pt-BR');
    })
    .slice(0, MAX_BROWSE_ENTRIES);

  const parent = path.dirname(target);
  const atRoot = parent === target;

  return {
    path: target,
    parent: atRoot ? null : parent,
    atRoot,
    isRepo: fs.existsSync(path.join(target, '.git')),
    roots: driveRoots(),
    shortcuts: shortcutRoots(),
    truncated: dirents.length > MAX_BROWSE_ENTRIES,
    entries,
  };
}

function workspaceInfo() {
  const root = workspaceRoot();
  const state = readState();
  const env = envRoot();

  return {
    root,
    name: path.basename(root) || root,
    exists: isDirectory(root),
    isRepo: fs.existsSync(path.join(root, '.git')),
    source: runtimeRoot
      ? 'sessão'
      : env
        ? 'ambiente'
        : state.path === root
          ? 'salvo'
          : 'atual',
    recent: state.recent,
    dataDir: dataDir(),
  };
}

module.exports = {
  dataDir,
  workspaceRoot,
  workspaceInfo,
  setWorkspace,
  resetWorkspace,
  browse,
  STATE_FILE,
};
