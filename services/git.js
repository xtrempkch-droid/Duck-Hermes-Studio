'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const fileStore = require('./file-store');

const GIT_TIMEOUT_MS = 10000;
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_DIFF_BYTES = 200 * 1024;
const MAX_COMMIT_MESSAGE = 500;
const MIN_COMMIT_MESSAGE = 4;
const MAX_PATHS = 200;

/** Subcomandos que o plugin pode executar. push/pull/fetch/config ficam de fora. */
const READ_COMMANDS = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'branch']);
const WRITE_COMMANDS = new Set(['add', 'restore', 'commit']);

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function runGit(args, options) {
  const settings = options || {};
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      {
        cwd: settings.cwd || fileStore.workspaceRoot(),
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: MAX_OUTPUT_BYTES * 4,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_OPTIONAL_LOCKS: '0',
          LC_ALL: 'C',
        },
      },
      (error, stdout, stderr) => {
        const out = String(stdout || '');
        const err = String(stderr || '');

        if (error && error.code === 'ENOENT') {
          resolve({ ok: false, missing: true, code: 127, stdout: out, stderr: 'git não encontrado' });
          return;
        }

        resolve({
          ok: !error,
          missing: false,
          code: error && typeof error.code === 'number' ? error.code : error ? 1 : 0,
          timedOut: Boolean(error && error.killed),
          stdout: out.slice(0, MAX_OUTPUT_BYTES),
          stderr: err.slice(0, MAX_OUTPUT_BYTES),
          command: 'git ' + args.join(' '),
        });
      }
    );
  });
}

function normalizePaths(input) {
  if (!Array.isArray(input) || input.length === 0) {
    throw httpError('informe a lista de arquivos', 400);
  }
  if (input.length > MAX_PATHS) {
    throw httpError('no máximo ' + MAX_PATHS + ' arquivos por vez', 400);
  }

  const seen = new Set();
  const result = [];

  for (const raw of input) {
    if (typeof raw !== 'string' || raw.trim() === '') {
      throw httpError('caminho inválido na lista', 400);
    }
    if (raw.startsWith('-')) {
      throw httpError('caminho não pode começar com "-"', 400);
    }

    const absolute = fileStore.resolvePath(raw);
    const relative = path.relative(fileStore.workspaceRoot(), absolute) || '.';

    if (relative === '.') throw httpError('a raiz do workspace não entra na lista', 400);
    if (!seen.has(relative)) {
      seen.add(relative);
      result.push(relative);
    }
  }

  return result;
}

function normalizeMessage(value) {
  if (typeof value !== 'string') throw httpError('mensagem do commit é obrigatória', 400);

  const message = value.replace(/\r\n?/g, '\n').trim();
  if (message.length < MIN_COMMIT_MESSAGE) {
    throw httpError('mensagem precisa de pelo menos ' + MIN_COMMIT_MESSAGE + ' caracteres', 400);
  }
  if (message.length > MAX_COMMIT_MESSAGE) {
    throw httpError('mensagem limitada a ' + MAX_COMMIT_MESSAGE + ' caracteres', 400);
  }
  if (message.startsWith('-')) {
    throw httpError('mensagem não pode começar com "-"', 400);
  }

  return message;
}

function parseBranchLine(line) {
  const raw = line.replace(/^##\s*/, '').trim();
  if (!raw) return { branch: null, upstream: null, ahead: 0, behind: 0, unborn: false };

  const unborn = raw.indexOf('No commits yet on ') === 0;
  const withoutState = raw.replace(/\s*\[[^\]]*\]\s*$/, '');
  const stateMatch = raw.match(/\[([^\]]*)\]/);
  const upstreamParts = withoutState.split('...');
  const branch = upstreamParts[0].replace(/^No commits yet on\s+/, '').trim() || null;
  const upstream = upstreamParts[1] ? upstreamParts[1].trim() : null;

  let ahead = 0;
  let behind = 0;
  if (stateMatch) {
    const aheadMatch = stateMatch[1].match(/ahead\s+(\d+)/);
    const behindMatch = stateMatch[1].match(/behind\s+(\d+)/);
    if (aheadMatch) ahead = Number(aheadMatch[1]);
    if (behindMatch) behind = Number(behindMatch[1]);
  }

  return { branch, upstream, ahead, behind, unborn };
}

function describeCode(code) {
  const chart = {
    M: 'modificado',
    A: 'adicionado',
    D: 'removido',
    R: 'renomeado',
    C: 'copiado',
    U: 'conflito',
    '?': 'não rastreado',
    '!': 'ignorado',
  };
  return chart[code] || code;
}

function parseStatus(stdout) {
  const lines = String(stdout || '').split('\n').filter((line) => line !== '');
  let header = { branch: null, upstream: null, ahead: 0, behind: 0, unborn: false };
  const files = [];

  for (const line of lines) {
    if (line.indexOf('##') === 0) {
      header = parseBranchLine(line);
      continue;
    }

    const index = line[0] || ' ';
    const worktree = line[1] || ' ';
    let filePath = line.slice(3);

    const renameIndex = filePath.indexOf(' -> ');
    if (renameIndex !== -1) filePath = filePath.slice(renameIndex + 4);

    const untracked = index === '?';
    const conflict = index === 'U' || worktree === 'U' || (index === 'A' && worktree === 'A');

    files.push({
      path: filePath,
      index,
      worktree,
      staged: !untracked && index !== ' ' && index !== '?' && !conflict,
      unstaged: untracked || worktree !== ' ',
      untracked,
      conflict,
      status: describeCode(conflict ? 'U' : untracked ? '?' : index !== ' ' ? index : worktree),
    });
  }

  return Object.assign({}, header, { files });
}

async function repoInfo() {
  const inside = await runGit(['rev-parse', '--is-inside-work-tree']);

  if (inside.missing) {
    return {
      isRepo: false,
      gitAvailable: false,
      reason: 'git não está instalado nesta máquina',
      hint: 'Instale o Git e recarregue o painel',
      root: fileStore.workspaceRoot(),
    };
  }

  if (!inside.ok || inside.stdout.trim() !== 'true') {
    return {
      isRepo: false,
      gitAvailable: true,
      reason: 'a pasta do workspace não é um repositório Git',
      hint: 'Execute "git init" na raiz do workspace para começar a versionar',
      root: fileStore.workspaceRoot(),
    };
  }

  const topLevel = await runGit(['rev-parse', '--show-toplevel']);
  const repoRoot = topLevel.ok ? topLevel.stdout.trim() : fileStore.workspaceRoot();
  const workspace = fileStore.workspaceRoot();
  const head = await runGit(['rev-parse', '--short', 'HEAD']);

  return {
    isRepo: true,
    gitAvailable: true,
    root: repoRoot,
    workspace,
    rootIsWorkspace: path.resolve(repoRoot) === path.resolve(workspace),
    head: head.ok ? head.stdout.trim() : null,
  };
}

async function status() {
  const info = await repoInfo();
  if (!info.isRepo) return Object.assign({}, info, { branch: null, files: [] });

  const result = await runGit(['status', '--porcelain=v1', '--branch', '--untracked-files=normal']);
  if (!result.ok) {
    throw httpError('git status falhou: ' + (result.stderr.trim() || result.code), 502);
  }

  const parsed = parseStatus(result.stdout);
  return Object.assign({}, info, parsed, {
    counts: {
      total: parsed.files.length,
      staged: parsed.files.filter((file) => file.staged).length,
      unstaged: parsed.files.filter((file) => file.unstaged).length,
      untracked: parsed.files.filter((file) => file.untracked).length,
      conflicts: parsed.files.filter((file) => file.conflict).length,
    },
  });
}

function resolveDiffPath(value) {
  if (typeof value !== 'string' || value.startsWith('-')) {
    throw httpError('caminho inválido para o diff', 400);
  }
  const absolute = fileStore.resolvePath(value);
  return path.relative(fileStore.workspaceRoot(), absolute) || '.';
}

async function diff(options) {
  const settings = options || {};
  const info = await repoInfo();
  if (!info.isRepo) throw httpError(info.reason, 409);

  const args = ['diff', '--no-color', '--no-ext-diff', '--unified=3'];

  if (settings.staged) args.push('--cached');
  if (settings.path !== undefined && settings.path !== null && settings.path !== '') {
    args.push('--', resolveDiffPath(settings.path));
  }

  const result = await runGit(args);
  if (!result.ok) {
    throw httpError('git diff falhou: ' + (result.stderr.trim() || result.code), 502);
  }

  let text = result.stdout;
  let truncated = false;
  if (text.length > MAX_DIFF_BYTES) {
    text = text.slice(0, MAX_DIFF_BYTES);
    truncated = true;
  }

  return {
    path: settings.path || null,
    staged: Boolean(settings.staged),
    empty: text.trim() === '',
    truncated,
    diff: text,
  };
}

async function numstat() {
  const result = await runGit(['diff', '--numstat', 'HEAD']);
  if (!result.ok) return { added: 0, removed: 0 };

  let added = 0;
  let removed = 0;
  for (const line of result.stdout.split('\n')) {
    const match = line.match(/^(\d+)\s+(\d+)\s+/);
    if (!match) continue;
    added += Number(match[1]);
    removed += Number(match[2]);
  }
  return { added, removed };
}

async function log(options) {
  const settings = options || {};
  const limit = Math.min(Math.max(Number(settings.limit) || 10, 1), 50);
  const info = await repoInfo();
  if (!info.isRepo) throw httpError(info.reason, 409);

  const result = await runGit(['log', '-n' + limit, '--pretty=format:%H%x1f%an%x1f%ar%x1f%s']);
  if (!result.ok) {
    if (info.head === null) return { commits: [], empty: true };
    throw httpError('git log falhou: ' + (result.stderr.trim() || result.code), 502);
  }

  const commits = result.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\x1f');
      return {
        hash: parts[0],
        short: (parts[0] || '').slice(0, 7),
        author: parts[1],
        when: parts[2],
        subject: parts[3],
      };
    });

  return { commits, empty: commits.length === 0 };
}

async function stage(input) {
  const paths = normalizePaths(input);
  const info = await repoInfo();
  if (!info.isRepo) throw httpError(info.reason, 409);

  const result = await runGit(['add', '--', ...paths]);
  if (!result.ok) {
    throw httpError('git add falhou: ' + (result.stderr.trim() || result.code), 502);
  }
  return { ok: true, staged: paths, status: await status() };
}

async function unstage(input) {
  const paths = normalizePaths(input);
  const info = await repoInfo();
  if (!info.isRepo) throw httpError(info.reason, 409);

  const restore = await runGit(['restore', '--staged', '--', ...paths]);
  const result = restore.ok ? restore : await runGit(['reset', '--', ...paths]);

  if (!result.ok) {
    throw httpError('não foi possível desfazer o stage: ' + (result.stderr.trim() || result.code), 502);
  }
  return { ok: true, unstaged: paths, status: await status() };
}

async function discard(input) {
  const paths = normalizePaths(input);
  const info = await repoInfo();
  if (!info.isRepo) throw httpError(info.reason, 409);

  const tracked = [];
  for (const relative of paths) {
    const absolute = path.resolve(fileStore.workspaceRoot(), relative);
    const listed = await runGit(['ls-files', '--error-unmatch', '--', relative]);
    if (listed.ok) {
      tracked.push(relative);
    } else if (fs.existsSync(absolute)) {
      fs.unlinkSync(absolute);
    }
  }

  if (tracked.length > 0) {
    const result = await runGit(['restore', '--worktree', '--', ...tracked]);
    if (!result.ok) {
      throw httpError('não foi possível descartar: ' + (result.stderr.trim() || result.code), 502);
    }
  }

  return { ok: true, discarded: paths, status: await status() };
}

async function fileDiff(input) {
  const settings = input || {};
  const info = await repoInfo();
  if (!info.isRepo) throw httpError(info.reason, 409);

  const statusData = await status();
  const target = settings.path ? String(settings.path) : null;
  const entry = target ? statusData.files.find((file) => file.path === target) : null;

  if (entry && entry.untracked) {
    const absolute = fileStore.resolvePath(entry.path);
    const stats = fs.statSync(absolute);
    if (stats.size > MAX_DIFF_BYTES) throw httpError('arquivo grande demais para diff', 413);
    const content = fs.readFileSync(absolute, 'utf8');
    const lines = content.split('\n');
    const body = lines.map((line) => '+' + line).join('\n');
    return {
      path: entry.path,
      staged: false,
      untracked: true,
      empty: content === '',
      truncated: false,
      diff: '--- /dev/null\n+++ b/' + entry.path + '\n@@ -0,0 +1,' + lines.length + ' @@\n' + body,
    };
  }

  return diff({ path: target, staged: Boolean(settings.staged) });
}

async function commit(body) {
  const payload = body || {};
  if (payload.confirm !== true) {
    throw httpError('commit exige confirmação explícita (confirm: true)', 428);
  }

  const message = normalizeMessage(payload.message);
  const info = await repoInfo();
  if (!info.isRepo) throw httpError(info.reason, 409);

  if (Array.isArray(payload.files) && payload.files.length > 0) {
    const paths = normalizePaths(payload.files);
    const add = await runGit(['add', '--', ...paths]);
    if (!add.ok) throw httpError('git add falhou: ' + (add.stderr.trim() || add.code), 502);
  }

  const current = await status();
  const staged = current.files.filter((file) => file.staged && !file.conflict);

  if (staged.length === 0) {
    throw httpError('nada preparado para commit (use "Preparar" nos arquivos)', 409);
  }
  if (current.files.some((file) => file.conflict)) {
    throw httpError('existem conflitos não resolvidos no repositório', 409);
  }

  const result = await runGit(['commit', '-m', message]);
  if (!result.ok) {
    const detail = (result.stderr || result.stdout).trim();
    throw httpError('git commit falhou: ' + (detail || result.code), 502);
  }

  const head = await runGit(['rev-parse', '--short', 'HEAD']);
  const summary = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3);

  return {
    ok: true,
    hash: head.ok ? head.stdout.trim() : null,
    message,
    files: staged.map((file) => file.path),
    summary,
    stats: await numstat(),
    status: await status(),
  };
}

module.exports = {
  repoInfo,
  status,
  diff,
  fileDiff,
  log,
  stage,
  unstage,
  discard,
  commit,
  numstat,
  normalizeMessage,
  normalizePaths,
  parseStatus,
  parseBranchLine,
  runGit,
  READ_COMMANDS,
  WRITE_COMMANDS,
  MAX_COMMIT_MESSAGE,
};
