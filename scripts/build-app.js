'use strict';

/** Gera binários autocontidos com @yao-pkg/pkg. Sem argumentos, usa o alvo atual. */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const NODE_RANGE = 'node22';
const PKG_VERSION = process.env.PKG_VERSION || '6.23.0';
const IS_WINDOWS = process.platform === 'win32';

/** Só estes alvos são aceitos — evita passar texto arbitrário para a linha de comando. */
const TARGET_PATTERN = /^node(16|18|20|22|24)-(linux|alpine|win|macos)-(x64|arm64)$/;

const PLATFORM_NAMES = { linux: 'linux', win32: 'win', darwin: 'macos' };
const ARCH_NAMES = { x64: 'x64', arm64: 'arm64' };

function currentTargets() {
  const platform = PLATFORM_NAMES[process.platform];
  const arch = ARCH_NAMES[process.arch];
  if (!platform || !arch) throw new Error(`plataforma não suportada: ${process.platform}/${process.arch}`);
  return [`${NODE_RANGE}-${platform}-${arch}`];
}

function normalizeTargets(list) {
  const raw = list.length ? list : currentTargets();

  return raw.map((value) => {
    const target = value.startsWith('node') ? value : `${NODE_RANGE}-${value}`;
    if (!TARGET_PATTERN.test(target)) {
      throw new Error(
        `alvo inválido: ${value} (use linux-x64, win-x64, macos-arm64 ou node22-linux-x64…)`
      );
    }
    return target;
  });
}

function outputName(target) {
  const suffix = target.replace(NODE_RANGE + '-', '');
  return `duck-hermes-studio-${suffix}${suffix.startsWith('win') ? '.exe' : ''}`;
}

function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Resolve como chamar o pkg, em ordem de preferência:
 *  1. PKG_BIN (caminho explícito para o bin.js)
 *  2. instalação local (node_modules/@yao-pkg/pkg)
 *  3. npx-cli.js que acompanha o Node (evita .cmd no Windows, que falha com spawn EINVAL)
 *  4. npx do PATH (com shell no Windows)
 * pkg exige Node 22, então não é dependência do projeto — os jobs de build o instalam.
 */
function resolvePkg() {
  const envBin = process.env.PKG_BIN;
  if (envBin) {
    if (!fs.existsSync(envBin)) throw new Error(`PKG_BIN não encontrado: ${envBin}`);
    return { mode: 'node', bin: envBin };
  }

  const local = firstExisting([
    path.join(ROOT, 'node_modules', '@yao-pkg', 'pkg', 'lib-es5', 'bin.js'),
    path.join(ROOT, 'node_modules', '@yao-pkg', 'pkg', 'lib', 'bin.js'),
  ]);
  if (local) return { mode: 'node', bin: local };

  const nodeDir = path.dirname(process.execPath);
  const npxCli = firstExisting([
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npx-cli.js'),
    path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
  ]);
  if (npxCli) return { mode: 'npx-cli', bin: npxCli };

  return { mode: 'npx', bin: null };
}

/** Garante que shims com `#!/usr/bin/env node` (npx/pkg) encontrem o Node atual. */
function childEnv() {
  const nodeDir = path.dirname(process.execPath);
  const currentPath = process.env.PATH || process.env.Path || '';
  return Object.assign({}, process.env, {
    PATH: currentPath ? nodeDir + path.delimiter + currentPath : nodeDir,
  });
}

function spawnPkg(pkg, pkgArgs) {
  if (pkg.mode === 'npx' && IS_WINDOWS) {
    // .cmd só roda via shell; os argumentos vão citados para sobreviver a espaços
    const quoted = ['npx', '--yes', `@yao-pkg/pkg@${PKG_VERSION}`, ...pkgArgs].map((arg) =>
      /[\s"]/.test(arg) ? JSON.stringify(arg) : arg
    );
    return spawn(quoted.join(' '), {
      cwd: ROOT,
      stdio: 'inherit',
      shell: true,
      windowsHide: true,
      env: childEnv(),
    });
  }

  if (pkg.mode === 'node') {
    return spawn(process.execPath, [pkg.bin, ...pkgArgs], {
      cwd: ROOT,
      stdio: 'inherit',
      windowsHide: true,
      env: childEnv(),
    });
  }

  if (pkg.mode === 'npx-cli') {
    return spawn(
      process.execPath,
      [pkg.bin, '--yes', `@yao-pkg/pkg@${PKG_VERSION}`, ...pkgArgs],
      { cwd: ROOT, stdio: 'inherit', windowsHide: true, env: childEnv() }
    );
  }

  return spawn('npx', ['--yes', `@yao-pkg/pkg@${PKG_VERSION}`, ...pkgArgs], {
    cwd: ROOT,
    stdio: 'inherit',
    windowsHide: true,
    env: childEnv(),
  });
}

function runPkg(pkg, target) {
  const output = path.join(DIST, outputName(target));
  const pkgArgs = ['.', '--targets', target, '--output', output, '--compress', 'GZip'];

  console.log(`\n> pkg ${target} (${pkg.mode})`);

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnPkg(pkg, pkgArgs);
    } catch (error) {
      reject(new Error(`não foi possível iniciar o pkg: ${error.message}`));
      return;
    }

    child.on('error', (error) => {
      reject(new Error(`não foi possível iniciar o pkg (${error.code || error.message})`));
    });

    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`pkg falhou para ${target} (código ${code})`));
        return;
      }
      if (!fs.existsSync(output)) {
        reject(new Error(`pkg terminou sem gerar ${path.relative(ROOT, output)}`));
        return;
      }
      const size = fs.statSync(output).size;
      console.log(`ok  ${path.relative(ROOT, output)}  ${(size / (1024 * 1024)).toFixed(1)} MB`);
      resolve(output);
    });
  });
}

async function main() {
  const targets = normalizeTargets(process.argv.slice(2));
  const pkg = resolvePkg();

  if (pkg.mode !== 'node') {
    console.log(`pkg não está instalado localmente; usando ${pkg.mode}`);
  }

  if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });

  const outputs = [];
  for (const target of targets) {
    outputs.push(await runPkg(pkg, target));
  }

  console.log(`\n${outputs.length} binário(s) em dist/`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`build-app: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { normalizeTargets, outputName, resolvePkg, currentTargets, TARGET_PATTERN };
