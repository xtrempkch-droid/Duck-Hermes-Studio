'use strict';

const crypto = require('crypto');
const fileStore = require('./file-store');
const { createDiff } = require('./diff');
const activity = require('./activity-log');

const TTL_MS = 15 * 60 * 1000;
const MAX_PENDING = 20;

const pending = new Map();

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function hashContent(content) {
  return crypto.createHash('sha1').update(String(content), 'utf8').digest('hex');
}

function pruneExpired() {
  const now = Date.now();
  for (const [id, patch] of pending) {
    if (now - patch.createdAt > TTL_MS) pending.delete(id);
  }
}

function trim() {
  while (pending.size > MAX_PENDING) {
    const oldest = pending.keys().next().value;
    pending.delete(oldest);
  }
}

async function readBase(targetPath) {
  try {
    const file = await fileStore.readFile(targetPath);
    return { content: file.content, exists: true };
  } catch (error) {
    if (error.status === 404) return { content: '', exists: false };
    throw error;
  }
}

async function previewPatch(input) {
  pruneExpired();

  const targetPath = input && input.path;
  const content = input && input.content;

  if (typeof content !== 'string') {
    throw httpError('conteúdo deve ser texto', 400);
  }
  if (!targetPath) {
    throw httpError('caminho obrigatório', 400);
  }

  const absolute = fileStore.resolvePath(targetPath);
  const base = await readBase(targetPath);
  const { diff, stats } = createDiff(base.content, content);
  const baseHash = hashContent(base.content);

  const patch = {
    id: crypto.randomBytes(8).toString('hex'),
    path: fileStore.relativePath(absolute),
    content,
    exists: base.exists,
    baseHash,
    diff,
    stats,
    author: input && input.author === 'AI' ? 'AI' : 'USER',
    origin: (input && input.origin) || null,
    createdAt: Date.now(),
  };

  pending.set(patch.id, patch);
  trim();

  return {
    id: patch.id,
    path: patch.path,
    exists: patch.exists,
    changed: stats.changed,
    stats,
    diff,
  };
}

function takePatch(id) {
  pruneExpired();

  const patch = pending.get(id);
  if (!patch) throw httpError('patch não encontrado ou expirado', 404);

  return patch;
}

async function applyPatch(id) {
  const patch = takePatch(id);
  const current = await readBase(patch.path);

  if (hashContent(current.content) !== patch.baseHash) {
    pending.delete(id);
    throw httpError('o arquivo mudou no disco desde a revisão; gere um novo diff', 409);
  }

  const result = await fileStore.writeFile(patch.path, patch.content);
  pending.delete(id);

  activity.log.record({
    filePath: patch.path,
    lineRange: [0, 0],
    author: patch.author,
    action: 'apply_patch',
    delta: { before: current.content, after: patch.content },
    metadata: { patchId: patch.id, exists: patch.exists, origin: patch.origin, stats: patch.stats },
  });
  activity.log.hints.clearFile(patch.path);

  return { ...result, stats: patch.stats };
}

function rejectPatch(id) {
  const patch = takePatch(id);
  pending.delete(id);

  return { ok: true, id: patch.id, path: patch.path };
}

function pendingCount() {
  pruneExpired();
  return pending.size;
}

module.exports = { previewPatch, applyPatch, rejectPatch, pendingCount, TTL_MS };
