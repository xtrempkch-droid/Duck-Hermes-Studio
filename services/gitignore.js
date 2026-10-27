'use strict';

/**
 * Subconjunto de `.gitignore` suficiente para a árvore de arquivos: comentários,
 * linhas em branco, globs `*`/`?`/`**`/`[...]`, `/` final (só diretórios), `/`
 * inicial (ancorado), `!` para re-incluir e "último match vence".
 *
 * O que não é implementado (documentado, não silencioso): `\` como separador no
 * Windows e as aspas genéricas do git. Linha que não compila é descartada em vez
 * de derrubar a listagem.
 */

function escapeRegex(text) {
  return text.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

function globToRegex(glob) {
  let out = '';
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character === '*') {
      if (glob[index + 1] === '*') {
        if (glob[index + 2] === '/') {
          out += '(?:.*/)?';
          index += 2;
        } else {
          out += '.*';
          index += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if (character === '?') {
      out += '[^/]';
    } else if (character === '[') {
      const end = glob.indexOf(']', index);
      if (end === -1) {
        out += '\\[';
      } else {
        let klass = glob.slice(index, end + 1);
        if (klass.startsWith('[!')) klass = `[^${klass.slice(2)}`;
        out += klass;
        index = end;
      }
    } else {
      out += escapeRegex(character);
    }
  }
  return out;
}

/** Compila as linhas de um `.gitignore` preservando a ordem (negação depende dela). */
function parseGitignore(content) {
  const patterns = [];

  for (const raw of String(content).split(/\r?\n/)) {
    let line = raw.replace(/(?<!\\)[ \t]+$/, '');
    if (line === '' || line.startsWith('#')) continue;

    let negated = false;
    if (line.startsWith('!')) {
      negated = true;
      line = line.slice(1);
    }

    if (line.startsWith('\\#') || line.startsWith('\\!')) line = line.slice(1);

    let directoryOnly = false;
    if (line.endsWith('/')) {
      directoryOnly = true;
      line = line.slice(0, -1);
    }

    let anchored = false;
    if (line.startsWith('/')) {
      anchored = true;
      line = line.slice(1);
    } else if (line.includes('/')) {
      anchored = true;
    }

    line = line.replace(/\\#/g, '#').replace(/\\!/g, '!').replace(/\\ /g, ' ');

    if (line === '') continue;

    patterns.push({
      source: raw,
      negated,
      directoryOnly,
      anchored,
      regex: new RegExp(`^${globToRegex(line)}$`),
    });
  }

  return patterns;
}

function basenameOf(relativePath) {
  const slash = relativePath.lastIndexOf('/');
  return slash === -1 ? relativePath : relativePath.slice(slash + 1);
}

function relativeToBase(baseDir, relativePath) {
  if (baseDir === '' || baseDir === '.') return relativePath;
  const prefix = `${baseDir}/`;
  return relativePath.startsWith(prefix) ? relativePath.slice(prefix.length) : relativePath;
}

/** `true` quando o caminho (relativo ao workspace, sempre com `/`) está ignorado. */
function isPathIgnored(sources, relativePath, isDirectory) {
  const segments = String(relativePath).split('/').filter(Boolean);
  const candidates = [];

  // O próprio caminho e cada ancestral: ignorar um diretório ignora o conteúdo.
  for (let index = 1; index <= segments.length; index += 1) {
    candidates.push({
      path: segments.slice(0, index).join('/'),
      isDirectory: index < segments.length || isDirectory,
    });
  }

  let ignored = false;

  for (const source of sources) {
    for (const candidate of candidates) {
      const relative = relativeToBase(source.baseDir, candidate.path);
      for (const pattern of source.patterns) {
        if (pattern.directoryOnly && !candidate.isDirectory) continue;
        const target = pattern.anchored ? relative : basenameOf(candidate.path);
        if (pattern.regex.test(target)) ignored = !pattern.negated;
      }
    }
  }

  return ignored;
}

/** Diretórios que nenhuma listagem recursiva deve percorrer por padrão. */
const DEFAULT_EXCLUDED_DIRECTORIES = [
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'bower_components',
  '__pycache__',
  '.venv',
  'venv',
  '.mypy_cache',
  '.pytest_cache',
];

module.exports = {
  parseGitignore,
  isPathIgnored,
  globToRegex,
  DEFAULT_EXCLUDED_DIRECTORIES,
};
