'use strict';

/**
 * Contexto do editor exposto ao agente: arquivo ativo, seleção, cursor, abas e
 * estado de salvamento. A UI empurra o estado (POST /api/editor/context) e o
 * agente lê pela ferramenta `get_editor_context` — sem polling.
 */

const EMPTY_CONTEXT = Object.freeze({
  activeFile: null,
  selection: null,
  cursor: { line: 1, column: 1 },
  openFiles: [],
  languageId: null,
  dirty: false,
  updatedAt: null,
});

const EXTENSION_LANGUAGE = {
  ts: 'typescript',
  tsx: 'typescriptreact',
  js: 'javascript',
  jsx: 'javascriptreact',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  md: 'markdown',
  css: 'css',
  html: 'html',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  rb: 'ruby',
  php: 'php',
  sh: 'shell',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  sql: 'sql',
};

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function languageIdForPath(filePath) {
  const ext = String(filePath || '').split('.').pop().toLowerCase();
  return EXTENSION_LANGUAGE[ext] || 'plaintext';
}

function normalizePosition(value, fallback) {
  if (!value || typeof value !== 'object') return fallback;
  const line = Number(value.line);
  const column = Number(value.column);
  return {
    line: Number.isFinite(line) && line >= 1 ? Math.floor(line) : fallback.line,
    column: Number.isFinite(column) && column >= 1 ? Math.floor(column) : fallback.column,
  };
}

function normalizeSelection(value) {
  if (value === null) return null;
  if (!value || typeof value !== 'object') return undefined;
  const start = normalizePosition(value.start, { line: 1, column: 1 });
  const end = normalizePosition(value.end, start);
  return { start, end };
}

class EditorContextStore {
  constructor() {
    this.context = EMPTY_CONTEXT;
    this.listeners = new Set();
  }

  get() {
    return this.context;
  }

  set(next) {
    this.context = Object.freeze({ ...next, updatedAt: Date.now() });
    for (const listener of this.listeners) listener(this.context);
    return this.context;
  }

  /** Atualização parcial: campo omitido mantém o valor anterior. */
  update(patch) {
    const body = patch || {};
    const merged = { ...this.context };

    if (body.activeFile !== undefined) {
      if (body.activeFile !== null && typeof body.activeFile !== 'string') {
        throw httpError('activeFile deve ser texto ou null', 400);
      }
      merged.activeFile = body.activeFile;
    }
    if (body.selection !== undefined) {
      const selection = normalizeSelection(body.selection);
      merged.selection = selection === undefined ? merged.selection : selection;
    }
    if (body.cursor !== undefined) {
      merged.cursor = normalizePosition(body.cursor, merged.cursor);
    }
    if (body.openFiles !== undefined) {
      if (!Array.isArray(body.openFiles)) throw httpError('openFiles deve ser lista', 400);
      merged.openFiles = body.openFiles.filter((item) => typeof item === 'string').slice(0, 50);
    }
    if (body.dirty !== undefined) merged.dirty = Boolean(body.dirty);
    if (body.languageId !== undefined) {
      merged.languageId = body.languageId === null ? null : String(body.languageId);
    } else if (body.activeFile !== undefined) {
      merged.languageId = body.activeFile === null ? null : languageIdForPath(body.activeFile);
    }

    return this.set(merged);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

const store = new EditorContextStore();

module.exports = { EditorContextStore, store, EMPTY_CONTEXT, languageIdForPath };
