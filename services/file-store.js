'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const paths = require('./paths');

const MAX_READ_BYTES = 2 * 1024 * 1024;
const MAX_WRITE_BYTES = 5 * 1024 * 1024;
const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const MAX_LIST_ENTRIES = 500;
const BLOCKED_SEGMENTS = new Set(['.git']);

/** Tipos servidos por /api/fs/raw (preview de mídia e "abrir externo"). */
const MIME_BY_EXT = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  avif: 'image/avif',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  zip: 'application/zip',
  gz: 'application/gzip',
};

function mimeForPath(filePath) {
  const ext = String(filePath).split('.').pop().toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

/** SVG é documento ativo: precisa rodar num contexto isolado, sem tocar na origem do app. */
const ACTIVE_MIME_TYPES = new Set(['image/svg+xml']);

function rawHeaders(mime) {
  const headers = { 'X-Content-Type-Options': 'nosniff' };

  if (ACTIVE_MIME_TYPES.has(mime)) {
    headers['Content-Security-Policy'] =
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox";
  }

  return headers;
}

function workspaceRoot() {
  return paths.workspaceRoot();
}

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function toRelative(absolutePath) {
  return path.relative(workspaceRoot(), absolutePath) || '.';
}

function realWorkspaceRoot() {
  try {
    return fs.realpathSync(workspaceRoot());
  } catch (error) {
    return null;
  }
}

/** `true` se `target` é a raiz ou está dentro dela (caminhos já canonizados). */
function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * O caminho textual pode estar "dentro" e mesmo assim um symlink levar para fora.
 * Valida o caminho real do alvo — ou do ancestral mais próximo que existe, quando
 * o arquivo ainda vai ser criado.
 */
function assertRealPathInsideRoot(absolutePath) {
  const realRoot = realWorkspaceRoot();
  if (!realRoot) return;

  let probe = absolutePath;

  for (;;) {
    let resolved;
    try {
      resolved = fs.realpathSync(probe);
    } catch (error) {
      if (error.code === 'EACCES' || error.code === 'EPERM') {
        throw httpError('sem permissão para acessar ' + probe, 403);
      }
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      const parent = path.dirname(probe);
      if (parent === probe) throw httpError('caminho inválido', 400);
      probe = parent;
      continue;
    }

    if (!isInside(realRoot, resolved)) {
      throw httpError('caminho fora do workspace (link simbólico)', 403);
    }
    return;
  }
}

function resolveInsideRoot(requestedPath, { allowRoot = false } = {}) {
  const root = workspaceRoot();
  const raw = typeof requestedPath === 'string' ? requestedPath.trim() : '';

  if (!raw && !allowRoot) {
    throw httpError('caminho obrigatório', 400);
  }

  if (raw.includes('\0')) {
    throw httpError('caminho inválido', 400);
  }

  const absolute = path.resolve(root, raw || '.');

  if (absolute !== root) {
    const relative = path.relative(root, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw httpError('caminho fora do workspace', 403);
    }
  }

  assertRealPathInsideRoot(absolute);

  return absolute;
}

function assertWritable(absolutePath) {
  const root = workspaceRoot();
  const relative = path.relative(root, absolutePath);

  if (!relative || relative === '.') {
    throw httpError('não é possível gravar na raiz do workspace', 400);
  }

  for (const segment of relative.split(path.sep)) {
    if (BLOCKED_SEGMENTS.has(segment)) {
      throw httpError(`escrita bloqueada em ${segment}`, 403);
    }
  }
}

async function listDirectory(requestedPath) {
  const absolute = resolveInsideRoot(requestedPath, { allowRoot: true });

  let stats;
  try {
    stats = await fsp.stat(absolute);
  } catch (error) {
    throw httpError('diretório não encontrado', 404);
  }

  if (!stats.isDirectory()) {
    throw httpError('o caminho não é um diretório', 400);
  }

  const dirents = await fsp.readdir(absolute, { withFileTypes: true });
  const entries = [];

  for (const dirent of dirents) {
    if (BLOCKED_SEGMENTS.has(dirent.name)) continue;

    const entryPath = path.join(absolute, dirent.name);
    let type = dirent.isDirectory() ? 'dir' : 'file';
    let size = null;

    if (type === 'file') {
      try {
        const stat = await fsp.stat(entryPath);
        size = stat.size;
        if (!stat.isFile()) type = 'other';
      } catch (error) {
        type = 'other';
      }
    }

    entries.push({
      name: dirent.name,
      path: toRelative(entryPath),
      type,
      size,
    });
  }

  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name, 'pt-BR');
  });

  const parentAbsolute = path.dirname(absolute);

  return {
    root: workspaceRoot(),
    path: toRelative(absolute),
    parent:
      absolute === workspaceRoot() ? null : toRelative(parentAbsolute),
    truncated: entries.length > MAX_LIST_ENTRIES,
    entries: entries.slice(0, MAX_LIST_ENTRIES),
  };
}

async function readFile(requestedPath) {
  const absolute = resolveInsideRoot(requestedPath);

  let stats;
  try {
    stats = await fsp.stat(absolute);
  } catch (error) {
    throw httpError('arquivo não encontrado', 404);
  }

  if (!stats.isFile()) {
    throw httpError('o caminho não é um arquivo', 400);
  }

  if (stats.size > MAX_READ_BYTES) {
    throw httpError(`arquivo maior que ${MAX_READ_BYTES} bytes`, 413);
  }

  const buffer = await fsp.readFile(absolute);

  if (buffer.includes(0)) {
    throw httpError('arquivo binário não suportado', 415);
  }

  return {
    path: toRelative(absolute),
    absolutePath: absolute,
    size: stats.size,
    modifiedAt: stats.mtimeMs,
    content: buffer.toString('utf8'),
  };
}

async function writeFile(requestedPath, content) {
  const absolute = resolveInsideRoot(requestedPath);

  if (typeof content !== 'string') {
    throw httpError('conteúdo deve ser texto', 400);
  }

  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_WRITE_BYTES) {
    throw httpError(`conteúdo maior que ${MAX_WRITE_BYTES} bytes`, 413);
  }

  assertWritable(absolute);

  let targetExists = false;
  try {
    const stats = await fsp.stat(absolute);
    if (stats.isDirectory()) {
      throw httpError('o caminho é um diretório', 400);
    }
    targetExists = true;
  } catch (error) {
    if (error.status) throw error;
    if (error.code !== 'ENOENT') throw error;
  }

  await fsp.mkdir(path.dirname(absolute), { recursive: true });

  const temporary = `${absolute}.${process.pid}.tmp`;
  await fsp.writeFile(temporary, content, 'utf8');
  await fsp.rename(temporary, absolute);

  return {
    ok: true,
    path: toRelative(absolute),
    absolutePath: absolute,
    bytes,
    created: !targetExists,
  };
}

async function readRaw(requestedPath) {
  const absolute = resolveInsideRoot(requestedPath);

  let stats;
  try {
    stats = await fsp.stat(absolute);
  } catch (error) {
    throw httpError('arquivo não encontrado', 404);
  }

  if (!stats.isFile()) {
    throw httpError('o caminho não é um arquivo', 400);
  }

  if (stats.size > MAX_MEDIA_BYTES) {
    throw httpError(`arquivo maior que ${MAX_MEDIA_BYTES} bytes`, 413);
  }

  return {
    path: toRelative(absolute),
    absolutePath: absolute,
    size: stats.size,
    modifiedAt: stats.mtimeMs,
    mime: mimeForPath(absolute),
  };
}

function workspaceInfo() {
  const info = paths.workspaceInfo();
  return {
    root: info.root,
    name: info.name,
    readLimitBytes: MAX_READ_BYTES,
    writeLimitBytes: MAX_WRITE_BYTES,
    mediaLimitBytes: MAX_MEDIA_BYTES,
    exists: info.exists,
    isRepo: info.isRepo,
    source: info.source,
    recent: info.recent,
  };
}

module.exports = {
  workspaceInfo,
  readRaw,
  mimeForPath,
  rawHeaders,
  MAX_MEDIA_BYTES,
  workspaceRoot,
  listDirectory,
  readFile,
  writeFile,
  resolvePath: (requestedPath) => resolveInsideRoot(requestedPath),
  relativePath: toRelative,
};
