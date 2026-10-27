'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { dataDir } = require('./paths');

const HISTORY_LIMIT = 1000;
const STDOUT_LIMIT = 4000;
const MAX_HISTORY_BYTES = 2 * 1024 * 1024;
const TRIM_KEEP_LINES = 500;

function historyFile() {
  return path.join(dataDir(), 'activity.jsonl');
}

function nowId() {
  return crypto.randomBytes(12).toString('hex');
}

/* ---------- diagnósticos ("hints") ---------- */

/**
 * Store observável de diagnósticos presos a arquivo e linha. Produzido pelo
 * parser de compilador e pelo LSP, consumido pela UI. Cada hint é imutável; a
 * origem (`source`) permite limpar só o que uma execução anterior gerou.
 */
class InlineHintManager {
  constructor() {
    this.hints = new Map();
    this.listeners = new Set();
  }

  add(hint) {
    const stored = Object.freeze({
      id: hint.id || nowId(),
      filePath: String(hint.filePath || ''),
      line: Math.max(1, Math.floor(Number(hint.line) || 1)),
      column: hint.column ? Math.max(1, Math.floor(Number(hint.column))) : null,
      message: String(hint.message || ''),
      severity: ['error', 'warning', 'info'].includes(hint.severity) ? hint.severity : 'info',
      code: hint.code || null,
      source: hint.source || null,
    });

    this.hints.set(stored.id, stored);
    this.emit();
    return stored;
  }

  remove(id) {
    const removed = this.hints.delete(String(id || ''));
    if (removed) this.emit();
    return removed;
  }

  clearFile(filePath) {
    let removed = 0;
    for (const [id, hint] of this.hints) {
      if (hint.filePath === filePath) {
        this.hints.delete(id);
        removed += 1;
      }
    }
    if (removed > 0) this.emit();
    return removed;
  }

  clearSource(source) {
    let removed = 0;
    for (const [id, hint] of this.hints) {
      if (hint.source === source) {
        this.hints.delete(id);
        removed += 1;
      }
    }
    if (removed > 0) this.emit();
    return removed;
  }

  /** Remove só o que uma origem gerou para um arquivo (não apaga erros de compilador). */
  clearFileSource(filePath, source) {
    let removed = 0;
    for (const [id, hint] of this.hints) {
      if (hint.filePath === filePath && hint.source === source) {
        this.hints.delete(id);
        removed += 1;
      }
    }
    if (removed > 0) this.emit();
    return removed;
  }

  clear() {
    if (this.hints.size === 0) return;
    this.hints.clear();
    this.emit();
  }

  getForFile(filePath) {
    return this.all().filter((hint) => hint.filePath === filePath);
  }

  all() {
    return [...this.hints.values()].sort(
      (a, b) => a.filePath.localeCompare(b.filePath, 'pt-BR') || a.line - b.line
    );
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() {
    const snapshot = this.all();
    for (const listener of this.listeners) listener(snapshot);
  }
}

/* ---------- log de execução (event sourcing) ---------- */

function readHistory() {
  try {
    const raw = fs.readFileSync(historyFile(), 'utf8');
    const entries = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed === 'object') entries.push(parsed);
      } catch (error) {
        /* linha corrompida é ignorada, não derruba o boot */
      }
    }
    return entries.slice(-HISTORY_LIMIT);
  } catch (error) {
    return [];
  }
}

function appendHistory(event) {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    const file = historyFile();

    // O log é append-only em memória; no disco, um teto evita crescer sem fim.
    try {
      const stats = fs.statSync(file);
      if (stats.size > MAX_HISTORY_BYTES) {
        const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
        fs.writeFileSync(file, lines.slice(-TRIM_KEEP_LINES).join('\n') + '\n', { mode: 0o600 });
      }
    } catch (error) {
      /* arquivo ainda não existe */
    }

    fs.appendFileSync(file, JSON.stringify(event) + '\n', { mode: 0o600 });
  } catch (error) {
    /* histórico é conveniência: sem permissão, o app continua */
  }
}

/**
 * Log append-only do que o editor, o usuário e a IA fizeram. Nada é alterado
 * nem apagado; assinantes (console, inspetor de diff, UI) leem daqui.
 */
class ExecutionLogger {
  constructor(options) {
    const settings = options || {};
    this.entriesList = [];
    this.runsList = [];
    this.listeners = new Set();
    this.hints = new InlineHintManager();
    this.persist = settings.persist !== false;
    this.loaded = false;
  }

  ensureLoaded() {
    if (this.loaded) return;
    this.loaded = true;
    for (const event of readHistory()) {
      if (event.type === 'entry' && event.entry) this.entriesList.push(event.entry);
      else if (event.type === 'run' && event.run) this.runsList.push(event.run);
    }
  }

  emit(event) {
    for (const listener of this.listeners) listener(event);
  }

  record(input) {
    this.ensureLoaded();

    const entry = Object.freeze({
      id: input.id || nowId(),
      timestamp: input.timestamp || Date.now(),
      filePath: String(input.filePath || ''),
      lineRange: Array.isArray(input.lineRange) ? [input.lineRange[0] || 0, input.lineRange[1] || 0] : [0, 0],
      author: ['USER', 'AI', 'SYSTEM'].includes(input.author) ? input.author : 'SYSTEM',
      action: String(input.action || 'change'),
      delta: Object.freeze({
        before: String((input.delta && input.delta.before) || ''),
        after: String((input.delta && input.delta.after) || ''),
      }),
      metadata: Object.freeze({ ...(input.metadata || {}) }),
    });

    this.entriesList.push(entry);
    if (this.entriesList.length > HISTORY_LIMIT) this.entriesList.shift();
    if (this.persist) appendHistory({ type: 'entry', entry });
    this.emit({ type: 'entry', entry });
    return entry;
  }

  /**
   * Registra uma execução. `image` diz como rodou — 'local (sem isolamento)'
   * quando não houve container — para o log nunca sugerir isolamento falso.
   */
  recordRun(input) {
    this.ensureLoaded();

    const run = Object.freeze({
      id: input.id || nowId(),
      timestamp: input.timestamp || Date.now(),
      kind: input.kind === 'sandbox' ? 'sandbox' : 'local',
      image: input.image || 'local (sem isolamento)',
      command: String(input.command || ''),
      exitCode: Number.isInteger(input.exitCode) ? input.exitCode : null,
      durationMs: Number(input.durationMs) || 0,
      timedOut: input.timedOut === true,
      stdout: String(input.stdout || '').slice(0, STDOUT_LIMIT),
      stderr: String(input.stderr || '').slice(0, STDOUT_LIMIT),
      metadata: Object.freeze({ ...(input.metadata || {}) }),
    });

    this.runsList.push(run);
    if (this.runsList.length > HISTORY_LIMIT) this.runsList.shift();
    if (this.persist) appendHistory({ type: 'run', run });
    this.emit({ type: 'run', run });
    return run;
  }

  entries(options) {
    this.ensureLoaded();
    const settings = options || {};
    const limit = Math.min(Math.max(Number(settings.limit) || 100, 1), HISTORY_LIMIT);
    const filtered = settings.filePath
      ? this.entriesList.filter((entry) => entry.filePath === settings.filePath)
      : this.entriesList;
    return filtered.slice(-limit);
  }

  runs(options) {
    this.ensureLoaded();
    const settings = options || {};
    const limit = Math.min(Math.max(Number(settings.limit) || 20, 1), HISTORY_LIMIT);
    return this.runsList.slice(-limit);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  toJSON() {
    this.ensureLoaded();
    return {
      entries: this.entriesList,
      runs: this.runsList,
      hints: this.hints.all(),
    };
  }
}

const log = new ExecutionLogger();

module.exports = {
  ExecutionLogger,
  InlineHintManager,
  log,
  historyFile,
  HISTORY_LIMIT,
};
