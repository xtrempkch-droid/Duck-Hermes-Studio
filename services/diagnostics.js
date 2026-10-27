'use strict';

/**
 * Parser de saída de compilador/interpretador para diagnósticos estruturados.
 *
 * Formatos cobertos:
 * - GCC / Clang: `path/file.c:12:5: error: mensagem` (coluna opcional)
 * - TypeScript: `path/file.ts(12,5): error TS1234: mensagem`
 * - Rustc: `error[E0123]: mensagem` seguido de ` --> path/file.rs:12:5`
 * - Python: `  File "path/file.py", line 12` seguido de `SyntaxError: ...`
 *
 * O parser nunca lança: linha que não casa é simplesmente ignorada.
 */

const GCC_LIKE = /^(?<file>.+?):(?<line>\d+):(?<col>\d+):\s*(?<sev>fatal error|error|warning|note):\s*(?<msg>.+)$/;
const GCC_NO_COL = /^(?<file>.+?):(?<line>\d+):\s*(?<sev>error|warning):\s*(?<msg>.+)$/;
const TSC_LIKE = /^(?<file>.+?)\((?<line>\d+),(?<col>\d+)\):\s*(?<sev>error|warning)\s+(?<code>TS\d+):\s*(?<msg>.+)$/;
const RUST_HEADER = /^(?<sev>error|warning)(?:\[(?<code>E\d+)\])?:\s*(?<msg>.+)$/;
const RUST_LOCATION = /^\s*-->\s*(?<file>.+?):(?<line>\d+):(?<col>\d+)\s*$/;
const PY_LOCATION = /^\s*File "(?<file>.+?)", line (?<line>\d+)/;
const PY_ERROR = /^(?<type>[A-Za-z_][A-Za-z0-9_]*(?:Error|Exception|Warning)):\s*(?<msg>.+)$/;

const SEVERITY_MAP = {
  error: 'error',
  'fatal error': 'error',
  warning: 'warning',
  note: 'info',
};

function toSeverity(raw) {
  return SEVERITY_MAP[raw || ''] || 'info';
}

function detectToolchain(filePath) {
  if (/\.rs$/.test(filePath)) return 'rustc';
  if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(filePath)) return 'typescript';
  if (/\.(c|cc|cpp|cxx|h|hpp)$/.test(filePath)) return 'gcc';
  if (/\.py$/.test(filePath)) return 'python';
  return 'unknown';
}

/** Converte a saída de erro em diagnósticos, na ordem em que apareceram. */
function parseDiagnostics(stderr) {
  const diagnostics = [];
  const lines = String(stderr || '').split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;

    const tsc = TSC_LIKE.exec(line);
    if (tsc && tsc.groups) {
      diagnostics.push({
        filePath: tsc.groups.file || '',
        line: Number(tsc.groups.line),
        column: Number(tsc.groups.col),
        message: tsc.groups.msg || '',
        severity: toSeverity(tsc.groups.sev),
        code: tsc.groups.code || null,
        toolchain: 'typescript',
      });
      continue;
    }

    const gcc = GCC_LIKE.exec(line);
    if (gcc && gcc.groups) {
      diagnostics.push({
        filePath: gcc.groups.file || '',
        line: Number(gcc.groups.line),
        column: Number(gcc.groups.col),
        message: gcc.groups.msg || '',
        severity: toSeverity(gcc.groups.sev),
        code: null,
        toolchain: /clang/.test(line) ? 'clang' : 'gcc',
      });
      continue;
    }

    const rust = RUST_HEADER.exec(line);
    if (rust && rust.groups) {
      const location = lines
        .slice(index + 1, index + 4)
        .map((candidate) => RUST_LOCATION.exec(candidate))
        .find((match) => match !== null);

      diagnostics.push({
        filePath: location && location.groups ? location.groups.file || '' : '<desconhecido>',
        line: location && location.groups ? Number(location.groups.line) : 1,
        column: location && location.groups ? Number(location.groups.col) : null,
        message: rust.groups.msg || '',
        severity: toSeverity(rust.groups.sev),
        code: rust.groups.code || null,
        toolchain: 'rustc',
      });
      continue;
    }

    const pyLocation = PY_LOCATION.exec(line);
    if (pyLocation && pyLocation.groups) {
      // a mensagem vem algumas linhas abaixo ("SyntaxError: ...")
      let severity = 'error';
      let message = '';
      let code = null;

      for (let next = index + 1; next < Math.min(index + 8, lines.length); next += 1) {
        const match = PY_ERROR.exec(lines[next].trim());
        if (match && match.groups) {
          code = match.groups.type;
          message = match.groups.msg;
          severity = /Warning$/.test(match.groups.type) ? 'warning' : 'error';
          break;
        }
      }

      diagnostics.push({
        filePath: pyLocation.groups.file || '',
        line: Number(pyLocation.groups.line),
        column: null,
        message: message || 'erro de Python',
        severity,
        code,
        toolchain: 'python',
      });
      continue;
    }

    const gccNoCol = GCC_NO_COL.exec(line);
    if (gccNoCol && gccNoCol.groups) {
      const filePath = gccNoCol.groups.file || '';
      diagnostics.push({
        filePath,
        line: Number(gccNoCol.groups.line),
        column: null,
        message: gccNoCol.groups.msg || '',
        severity: toSeverity(gccNoCol.groups.sev),
        code: null,
        toolchain: detectToolchain(filePath),
      });
    }
  }

  return diagnostics;
}

/** Normaliza o caminho relatado (absoluto ou com ./) para relativo ao workspace. */
function normalizeDiagnosticPath(filePath, workspaceRoot, mountPoint) {
  const path = require('path');
  const cleaned = String(filePath).replace(/^\.\//, '');

  if (mountPoint && cleaned.startsWith(mountPoint)) {
    return cleaned
      .slice(mountPoint.length)
      .replace(/^[/\\]/, '')
      .split(/[\\/]/)
      .join('/');
  }

  if (path.isAbsolute(cleaned)) {
    const relative = path.relative(path.resolve(workspaceRoot), path.resolve(cleaned));
    if (!relative.startsWith('..')) return relative.split(path.sep).join('/');
  }

  return cleaned.split(/[\\/]/).join('/');
}

function formatDiagnostic(diagnostic) {
  const location =
    diagnostic.column == null
      ? `${diagnostic.filePath}:${diagnostic.line}`
      : `${diagnostic.filePath}:${diagnostic.line}:${diagnostic.column}`;
  const code = diagnostic.code ? ` [${diagnostic.code}]` : '';
  return `${location}: ${diagnostic.severity}${code}: ${diagnostic.message}`;
}

module.exports = {
  parseDiagnostics,
  normalizeDiagnosticPath,
  formatDiagnostic,
  detectToolchain,
};
