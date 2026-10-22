'use strict';

/** Sobe o binário gerado, espera /api/health e encerra. Uso: node scripts/smoke-binary.js <arquivo> */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const BINARY = process.argv[2];
const TIMEOUT_MS = 45000;

function request(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: pathname, timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHealth(port) {
  const started = Date.now();
  let lastError = null;

  while (Date.now() - started < TIMEOUT_MS) {
    try {
      const response = await request(port, '/api/health');
      if (response.status === 200 && response.body.indexOf('"ok"') !== -1) return response.body;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(400);
  }

  throw new Error(`health não respondeu em ${TIMEOUT_MS}ms: ${lastError && lastError.message}`);
}

async function main() {
  if (!BINARY) {
    console.error('uso: node scripts/smoke-binary.js <caminho-do-binario>');
    process.exit(2);
    return;
  }
  if (!fs.existsSync(BINARY)) {
    console.error(`binário não encontrado: ${BINARY}`);
    process.exit(1);
    return;
  }

  const port = 3400 + Math.floor(Math.random() * 200);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-smoke-'));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-smoke-ws-'));

  fs.writeFileSync(path.join(workspace, 'ola.txt'), 'smoke\n');

  const child = spawn(BINARY, ['--port', String(port), '--data', dataDir, '--workspace', workspace, '--no-open'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });

  try {
    const health = await waitForHealth(port);
    const index = await request(port, '/');
    const info = await request(port, '/api/fs/info');

    if (index.status !== 200 || index.body.indexOf('Duck Hermes Studio') === -1) {
      throw new Error('index.html não foi servido pelo binário');
    }
    if (info.status !== 200 || info.body.indexOf('ola.txt') !== -1 || info.body.indexOf('"root"') === -1) {
      throw new Error('/api/fs/info inesperado');
    }

    console.log(`ok  binário respondeu (${health})`);
    console.log(`ok  index.html e /api/fs/info servidos`);
  } catch (error) {
    console.error(output.slice(-2000));
    throw error;
  } finally {
    child.kill();
    await sleep(300);
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`smoke-binary: ${error.message}`);
  process.exit(1);
});
