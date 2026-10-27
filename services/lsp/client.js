'use strict';

const { spawn } = require('child_process');
const { encode, createParser } = require('./framing');

const STDERR_LIMIT = 8000;
const KILL_GRACE_MS = 1500;

class LspRequestError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'LspRequestError';
    this.code = code;
  }
}

/**
 * Cliente JSON-RPC para language server. Independente do transporte, então roda
 * igual contra stdio ou contra um transporte de teste.
 */
class LspClient {
  constructor(options) {
    const settings = options || {};
    this.transport = settings.transport;
    this.defaultTimeoutMs = settings.timeoutMs || 30000;
    this.pending = new Map();
    this.notificationHandlers = new Map();
    this.closeHandlers = new Set();
    this.nextId = 1;
    this.closed = false;

    this.transport.onMessage((message) => this.handleMessage(message));
    this.transport.onClose(() => this.handleClose());
  }

  get isClosed() {
    return this.closed;
  }

  request(method, params, timeoutMs) {
    if (this.closed) {
      return Promise.reject(new LspRequestError(`não é possível enviar "${method}": cliente fechado`));
    }

    const id = this.nextId;
    this.nextId += 1;
    const timeout = timeoutMs === undefined ? this.defaultTimeoutMs : timeoutMs;

    return new Promise((resolve, reject) => {
      let timer = null;
      if (timeout > 0) {
        timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new LspRequestError(`"${method}" não respondeu em ${timeout} ms`));
        }, timeout);
        if (timer.unref) timer.unref();
      }

      this.pending.set(id, { method, resolve, reject, timer });
      const message = { jsonrpc: '2.0', id, method };
      if (params !== undefined) message.params = params;
      this.transport.send(message);
    });
  }

  notify(method, params) {
    if (this.closed) {
      throw new LspRequestError(`não é possível enviar "${method}": cliente fechado`);
    }
    const message = { jsonrpc: '2.0', method };
    if (params !== undefined) message.params = params;
    this.transport.send(message);
  }

  onNotification(method, handler) {
    const handlers = this.notificationHandlers.get(method) || new Set();
    handlers.add(handler);
    this.notificationHandlers.set(method, handlers);
    return () => handlers.delete(handler);
  }

  onClose(handler) {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  dispose() {
    if (this.closed) return;
    this.handleClose();
    this.transport.close();
  }

  handleMessage(message) {
    if (!message || typeof message !== 'object') return;

    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (entry.timer) clearTimeout(entry.timer);
      if (message.error) {
        entry.reject(new LspRequestError(message.error.message || 'erro do language server', message.error.code));
      } else {
        entry.resolve(message.result);
      }
      return;
    }

    if (message.id !== undefined && typeof message.method === 'string') {
      // O servidor pediu algo que não implementamos. Responder é obrigatório:
      // um servidor travado esperando resposta para de publicar diagnósticos.
      this.transport.send({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: `método não suportado: ${message.method}` },
      });
      return;
    }

    if (typeof message.method === 'string') {
      const handlers = this.notificationHandlers.get(message.method);
      if (!handlers) return;
      for (const handler of handlers) {
        try {
          handler(message.params);
        } catch (error) {
          /* handler quebrado não derruba o cliente */
        }
      }
    }
  }

  handleClose() {
    if (this.closed) return;
    this.closed = true;

    for (const [id, entry] of this.pending) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(new LspRequestError(`conexão encerrada durante "${entry.method}"`));
      this.pending.delete(id);
    }

    for (const handler of this.closeHandlers) {
      try {
        handler();
      } catch (error) {
        /* idem */
      }
    }
  }
}

/**
 * Transporte stdio: sobe o servidor, embrulha as mensagens e guarda o stderr
 * para explicar falhas de inicialização.
 */
function createStdioTransport(options) {
  const settings = options || {};
  const child = spawn(settings.command, settings.args || [], {
    cwd: settings.cwd,
    env: { ...process.env, ...(settings.env || {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const messageListeners = new Set();
  const closeListeners = new Set();
  let stderr = '';
  let closed = false;

  const parser = createParser(
    (message) => {
      for (const listener of messageListeners) listener(message);
    },
    (error) => {
      stderr = (stderr + `\n[parser] ${error.message}`).slice(-STDERR_LIMIT);
    }
  );

  child.stdout.on('data', (chunk) => parser.feed(chunk));
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk.toString('utf8')).slice(-STDERR_LIMIT);
  });

  function handleClose() {
    if (closed) return;
    closed = true;
    for (const listener of closeListeners) listener();
  }

  child.on('error', (error) => {
    stderr = (stderr + '\n' + error.message).slice(-STDERR_LIMIT);
    handleClose();
  });
  child.on('close', handleClose);

  return {
    send(message) {
      if (closed || !child.stdin.writable) throw new LspRequestError('language server encerrou');
      child.stdin.write(encode(message));
    },
    onMessage(listener) {
      messageListeners.add(listener);
    },
    onClose(listener) {
      closeListeners.add(listener);
    },
    close() {
      closed = true;
      try {
        child.stdin.end();
      } catch (error) {
        /* já fechado */
      }
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch (error) {
          /* morto */
        }
      }, KILL_GRACE_MS);
      if (timer.unref) timer.unref();
    },
    get stderr() {
      return stderr;
    },
    get pid() {
      return child.pid;
    },
  };
}

module.exports = { LspClient, LspRequestError, createStdioTransport };
