'use strict';

/** Gera binários autocontidos com @yao-pkg/pkg. Sem argumentos, usa o alvo atual. */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const NODE_RANGE = 'node22';
const PKG_VERSION = process.env.PKG_VERSION || '6.23.0';

const PLATFORM_NAMES = { linux: 'linux', win32: 'win', darwin: 'macos' };
const ARCH_NAMES = { x64: 'x64', arm64: 'arm64' };

function currentTargets() {
  const platform = PLATFORM_NAMES[process.platform];
  const arch = ARCH_NAMES[process.arch];
  if (!platform || !arch) throw new Error(`plataforma não suportada: ${process.platform}/${process.arch}`);
  return [`${NODE_RANGE}-${platform}-${arch}`];
}

function outputName(target) {
  return `duck-hermes-studio-${target.replace(NODE_RANGE + '-', '')}${target.includes('win') ? '.exe' : ''}`;
}

/** Prefere a instalação local; sem ela usa npx (pkg exige Node 22 e não é dependência do projeto). */
function resolvePkg() {
  const candidates = [
    path.join(ROOT, 'node_modules', '@yao-pkg', 'pkg', 'lib-es5', 'bin.js'),
    path.join(ROOT, 'node_modules', '@yao-pkg', 'pkg', 'lib', 'bin.js'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return { mode: 'local', bin: candidate };
  }
  return { mode: 'npx', bin: null };
}

function runPkg(pkg, target) {
  const output = path.join(DIST, outputName(target));
  const pkgArgs = ['.', '--targets', target, '--output', output, '--compress', 'GZip'];
  const command = pkg.mode === 'local' ? process.execPath : process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const args =
    pkg.mode === 'local'
      ? [pkg.bin, ...pkgArgs]
      : ['--yes', `@yao-pkg/pkg@${PKG_VERSION}`, ...pkgArgs];

  console.log(`\n> pkg ${target}`);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`pkg falhou para ${target} (código ${code})`));
        return;
      }
      const size = fs.existsSync(output) ? fs.statSync(output).size : 0;
      console.log(`ok  ${path.relative(ROOT, output)}  ${(size / (1024 * 1024)).toFixed(1)} MB`);
      resolve(output);
    });
  });
}

async function main() {
  const targets = process.argv.slice(2).length ? process.argv.slice(2) : currentTargets();
  const pkg = resolvePkg();

  if (pkg.mode === 'npx') {
    console.log(`@yao-pkg/pkg não está instalado; usando npx @yao-pkg/pkg@${PKG_VERSION}`);
  }

  if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });

  const outputs = [];
  for (const target of targets) {
    outputs.push(await runPkg(pkg, target));
  }

  console.log(`\n${outputs.length} binário(s) em dist/`);
}

main().catch((error) => {
  console.error(`build-app: ${error.message}`);
  process.exit(1);
});
