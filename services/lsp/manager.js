'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { pathToFileURL, fileURLToPath } = require('url');

const activity = require('../activity-log');
const fileStore = require('../file-store');
const { LspClient, createStdioTransport } = require('./client');

const DEFAULT_WAIT_MS = 2500;
const INITIALIZE_TIMEOUT_MS = 20000;
const REQUEST_TIMEOUT_MS = 10000;
const MAX_DIAGNOSTICS = 200;

/** Servidores conhecidos: só sobem se o binário existir. */
const DEFAULT_SERVERS = [
  {
    id: 'typescript',
    languages: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
    command: 'typescript-language-server',
    args: ['--stdio'],
  },
  {
    id: 'python',
    languages: ['python'],
    command: 'pyright-langserver',
    args: ['--stdio'],
  },
  {
    id: 'rust',
    languages: ['rust'],
    command: 'rust-analyzer',
    args: [],
  },
  {
    id: 'json',
    languages: ['json', 'jsonc'],
    command: 'vscode-json-language-server',
    args: ['--stdio'],
  },
];

const EXTENSION_LANGUAGE = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'typescriptreact',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascriptreact',
  py: 'python',
  pyi: 'python',
  rs: 'rust',
  json: 'json',
  jsonc: 'jsonc',
};

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function languageIdForPath(filePath) {
  const ext = String(filePath).split('.').pop().toLowerCase();
  return EXTENSION_LANGUAGE[ext] || 'plaintext';
}

/** Procura o executável no PATH sem depender de `which`. */
function commandExists(command) {
  if (!command) return false;
  if (command.includes('/') || command.includes('\\')) {
    try {
      fs.accessSync(command, fs.constants.X_OK);
      return true;
    } catch (error) {
      return false;
    }
  }

  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean)
      : [''];
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);

  for (const dir of dirs) {
    for (const extension of extensions) {
      try {
        fs.accessSync(path.join(dir, command + extension), fs.constants.X_OK);
        return true;
      } catch (error) {
        /* próximo */
      }
    }
  }
  return false;
}

const SEVERITY_BY_LSP = { 1: 'error', 2: 'warning', 3: 'info', 4: 'info' };

function normalizeUriPath(uri, workspaceRoot) {
  try {
    const absolute = fileURLToPath(uri);
    const relative = path.relative(workspaceRoot, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return relative.split(path.sep).join('/');
  } catch (error) {
    return null;
  }
}

class LanguageServerManager {
  constructor(options) {
    const settings = options || {};
    this.workspaceRoot = path.resolve(settings.workspaceRoot || fileStore.workspaceRoot());
    this.defaultWaitMs = settings.defaultWaitMs || DEFAULT_WAIT_MS;
    this.transportFactory = settings.transportFactory || createStdioTransport;
    this.hasCommand = settings.commandExists || commandExists;
    this.configs = new Map();
    this.services = new Map();
    this.starting = new Map();
    this.opened = new Set();
    this.waiters = new Map();

    for (const config of settings.configs || DEFAULT_SERVERS) {
      this.configs.set(config.id, config);
    }
  }

  listServers() {
    return [...this.configs.values()]
      .map((config) => ({
        id: config.id,
        languages: config.languages,
        command: config.command,
        args: config.args || [],
        available: this.hasCommand(config.command),
        running: this.services.has(config.id),
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  configFor(filePath) {
    const languageId = languageIdForPath(filePath);
    for (const config of this.configs.values()) {
      if (config.languages.includes(languageId)) return config;
    }
    return null;
  }

  /**
   * Abre/atualiza um arquivo no servidor certo e espera os diagnósticos daquele
   * arquivo. Sem servidor para a linguagem, devolve `server: null` em vez de erro.
   */
  async refresh(requestedPath, options) {
    const settings = options || {};
    const absolute = fileStore.resolvePath(requestedPath);
    const relative = fileStore.relativePath(absolute).split(path.sep).join('/');
    const config = this.configFor(relative);

    if (!config) {
      return { path: relative, server: null, diagnostics: [], reason: 'sem language server para esta linguagem' };
    }
    if (!this.hasCommand(config.command)) {
      throw httpError(
        `language server não instalado: ${config.command}. Instale e tente de novo (o app não baixa binários).`,
        409
      );
    }

    const service = await this.ensureService(config);
    const content = await fsp.readFile(absolute, 'utf8');
    const uri = pathToFileURL(absolute).toString();
    const waitMs = settings.waitMs || this.defaultWaitMs;

    const waited = this.waitFor(uri, waitMs);

    if (this.opened.has(uri)) {
      service.client.notify('textDocument/didChange', {
        textDocument: { uri, version: service.version += 1 },
        contentChanges: [{ text: content }],
      });
    } else {
      service.client.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: languageIdForPath(relative), version: service.version, text: content },
      });
      this.opened.add(uri);
    }

    await waited;

    const source = `lsp:${config.id}`;
    const found = activity.log.hints
      .getForFile(relative)
      .filter((hint) => hint.source === source);

    return {
      path: relative,
      server: config.id,
      waitedMs: waitMs,
      diagnostics: found,
    };
  }

  diagnosticsFor(filePath) {
    return activity.log.hints.getForFile(filePath);
  }

  ensureService(config) {
    const existing = this.starting.get(config.id);
    if (existing) return existing;

    const promise = this.startService(config).catch((error) => {
      this.starting.delete(config.id);
      throw error;
    });
    this.starting.set(config.id, promise);
    return promise;
  }

  async startService(config) {
    const transport = this.transportFactory({
      command: config.command,
      args: config.args || [],
      cwd: this.workspaceRoot,
      env: config.env || {},
    });

    const client = new LspClient({ transport, timeoutMs: REQUEST_TIMEOUT_MS });
    const service = { client, transport, version: 1, config };

    client.onNotification('textDocument/publishDiagnostics', (params) => {
      this.handleDiagnostics(config.id, params);
    });

    let closedReason = null;
    client.onClose(() => {
      closedReason = (transport.stderr || '').trim().slice(-500);
      this.services.delete(config.id);
      this.starting.delete(config.id);
    });

    try {
      await client.request(
        'initialize',
        {
          processId: process.pid,
          rootUri: pathToFileURL(this.workspaceRoot).toString(),
          workspaceFolders: [
            { uri: pathToFileURL(this.workspaceRoot).toString(), name: path.basename(this.workspaceRoot) },
          ],
          capabilities: {
            textDocument: {
              synchronization: { dynamicRegistration: false, didSave: false },
              publishDiagnostics: { relatedInformation: false },
            },
            workspace: { workspaceFolders: true },
          },
          clientInfo: { name: 'duck-hermes-studio', version: '0.1.0' },
        },
        INITIALIZE_TIMEOUT_MS
      );
    } catch (error) {
      client.dispose();
      const detail = closedReason || (transport.stderr || '').trim();
      throw httpError(
        `não foi possível iniciar ${config.command}: ${error.message}${detail ? ` — ${detail.slice(-300)}` : ''}`,
        502
      );
    }

    client.notify('initialized', {});
    this.services.set(config.id, service);
    return service;
  }

  handleDiagnostics(serverId, params) {
    if (!params || typeof params.uri !== 'string') return;

    const filePath = normalizeUriPath(params.uri, this.workspaceRoot);
    if (!filePath) return;

    const source = `lsp:${serverId}`;
    activity.log.hints.clearFileSource(filePath, source);

    const list = Array.isArray(params.diagnostics) ? params.diagnostics.slice(0, MAX_DIAGNOSTICS) : [];
    for (const diagnostic of list) {
      const start = (diagnostic.range && diagnostic.range.start) || {};
      activity.log.hints.add({
        filePath,
        line: Number(start.line || 0) + 1,
        column: start.character === undefined ? null : Number(start.character) + 1,
        message: String(diagnostic.message || '').slice(0, 500),
        severity: SEVERITY_BY_LSP[diagnostic.severity] || 'info',
        code: diagnostic.code === undefined ? null : String(diagnostic.code),
        source,
      });
    }

    this.notifyWaiters(params.uri);
  }

  notifyWaiters(uri) {
    const set = this.waiters.get(uri);
    if (!set) return;
    for (const resolve of [...set]) resolve();
  }

  waitFor(uri, timeoutMs) {
    return new Promise((resolve) => {
      const set = this.waiters.get(uri) || new Set();
      const timer = setTimeout(done, timeoutMs);
      if (timer.unref) timer.unref();

      function done() {
        clearTimeout(timer);
        set.delete(done);
        resolve();
      }

      set.add(done);
      this.waiters.set(uri, set);
    });
  }

  dispose() {
    for (const service of this.services.values()) service.client.dispose();
    this.services.clear();
    this.starting.clear();
    this.opened.clear();
    this.waiters.clear();
  }
}

module.exports = {
  DEFAULT_SERVERS,
  LanguageServerManager,
  commandExists,
  languageIdForPath,
  normalizeUriPath,
  DEFAULT_WAIT_MS,
};
