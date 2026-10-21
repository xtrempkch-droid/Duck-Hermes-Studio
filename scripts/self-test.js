'use strict';

const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

const results = [];

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
  }
}

async function main() {
  await check('file-store bloqueia caminho fora da raiz', async () => {
    const original = process.env.HERMES_WORKSPACE;
    process.env.HERMES_WORKSPACE = path.join(os.tmpdir(), 'hermes-self-test');
    delete require.cache[require.resolve('../services/file-store')];
    const store = require('../services/file-store');

    await assert.rejects(() => store.readFile('../../etc/passwd'), /fora do workspace/);

    if (original === undefined) delete process.env.HERMES_WORKSPACE;
    else process.env.HERMES_WORKSPACE = original;
  });

  await check('file-store grava e lê dentro do workspace', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-fs-'));
    process.env.HERMES_WORKSPACE = dir;
    delete require.cache[require.resolve('../services/file-store')];
    const store = require('../services/file-store');

    const written = await store.writeFile('sub/arquivo.txt', 'conteúdo');
    assert.strictEqual(written.path, path.join('sub', 'arquivo.txt'));

    const read = await store.readFile('sub/arquivo.txt');
    assert.strictEqual(read.content, 'conteúdo');

    delete process.env.HERMES_WORKSPACE;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await check('machines valida papel e comando', async () => {
    const machines = require('../services/machines');
    assert.strictEqual(typeof machines.addMachine, 'function');
    assert.strictEqual(typeof machines.runTests, 'function');
    assert.strictEqual(machines.DEFAULT_TEST_COMMAND, 'npm test');
  });

  await check('detect-providers lista os candidatos esperados', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'services', 'detect-providers.js'), 'utf8');
    for (const id of ['deep-rock-local', 'ollama', 'llamacpp-local', 'lm-studio', 'docker-test']) {
      assert.ok(source.includes(`id: '${id}'`), `candidato ausente: ${id}`);
    }
  });

  await check('docker de teste define a porta 8090', () => {
    const compose = fs.readFileSync(
      path.join(__dirname, '..', 'docker', 'test-llm', 'docker-compose.yml'),
      'utf8'
    );
    assert.ok(compose.includes('8090:8090'));
  });

  const failures = results.filter((item) => !item.ok);

  for (const item of results) {
    console.log(`${item.ok ? 'ok' : 'FAIL'}  ${item.name}${item.ok ? '' : ` — ${item.error}`}`);
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} teste(s) falharam.`);
    process.exit(1);
  }

  console.log(`\n${results.length} testes passaram.`);
}

main();
