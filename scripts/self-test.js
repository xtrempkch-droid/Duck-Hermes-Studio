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

  await check('diff calcula adicoes e remocoes', () => {
    const { diffLines, createDiff } = require('../services/diff');

    const ops = diffLines('a\nb\nc', 'a\nx\nc');
    const shape = ops.map((op) => `${op.type[0]}:${op.text}`).join('|');
    assert.strictEqual(shape, 'c:a|d:b|a:x|c:c');

    const { stats } = createDiff('1\n2\n3', '1\n9\n3\n4');
    assert.deepStrictEqual(stats, { added: 2, removed: 1, changed: true });
  });

  await check('diff nao altera texto igual', () => {
    const { createDiff } = require('../services/diff');
    const { stats } = createDiff('igual\ntexto', 'igual\ntexto');
    assert.deepStrictEqual(stats, { added: 0, removed: 0, changed: false });
  });

  await check('patch preview e reject nao gravam no disco', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-patch-'));
    process.env.HERMES_WORKSPACE = dir;

    delete require.cache[require.resolve('../services/file-store')];
    delete require.cache[require.resolve('../services/patches')];
    const patches = require('../services/patches');

    const preview = await patches.previewPatch({ path: 'novo.txt', content: 'linha 1\nlinha 2' });
    assert.strictEqual(preview.exists, false);
    assert.strictEqual(preview.changed, true);
    assert.strictEqual(fs.existsSync(path.join(dir, 'novo.txt')), false);

    const rejected = patches.rejectPatch(preview.id);
    assert.strictEqual(rejected.ok, true);
    assert.strictEqual(fs.existsSync(path.join(dir, 'novo.txt')), false);

    delete process.env.HERMES_WORKSPACE;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await check('patch apply grava somente apos aprovacao', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-patch2-'));
    process.env.HERMES_WORKSPACE = dir;
    fs.writeFileSync(path.join(dir, 'existente.txt'), 'um\ndois\ntres', 'utf8');

    delete require.cache[require.resolve('../services/file-store')];
    delete require.cache[require.resolve('../services/patches')];
    const patches = require('../services/patches');

    const preview = await patches.previewPatch({
      path: 'existente.txt',
      content: 'um\nDOIS\ntres',
    });
    assert.strictEqual(preview.exists, true);
    assert.deepStrictEqual(preview.stats, { added: 1, removed: 1, changed: true });
    assert.strictEqual(fs.readFileSync(path.join(dir, 'existente.txt'), 'utf8'), 'um\ndois\ntres');

    const applied = await patches.applyPatch(preview.id);
    assert.strictEqual(applied.ok, true);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'existente.txt'), 'utf8'), 'um\nDOIS\ntres');

    delete process.env.HERMES_WORKSPACE;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await check('patch recusa aplicar se o disco mudou', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-patch3-'));
    process.env.HERMES_WORKSPACE = dir;
    fs.writeFileSync(path.join(dir, 'alvo.txt'), 'original', 'utf8');

    delete require.cache[require.resolve('../services/file-store')];
    delete require.cache[require.resolve('../services/patches')];
    const patches = require('../services/patches');

    const preview = await patches.previewPatch({ path: 'alvo.txt', content: 'proposto' });
    fs.writeFileSync(path.join(dir, 'alvo.txt'), 'mexido por fora', 'utf8');

    await assert.rejects(() => patches.applyPatch(preview.id), /mudou no disco/);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'alvo.txt'), 'utf8'), 'mexido por fora');

    delete process.env.HERMES_WORKSPACE;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await check('tools read_file respeita range de linhas', async () => {
    const tools = require('../services/tools');
    const slice = tools.sliceLines('a\nb\nc\nd', 2, 3);
    assert.strictEqual(slice.content, 'b\nc');
    assert.strictEqual(slice.total, 4);
    assert.strictEqual(slice.truncated, true);
    assert.throws(() => tools.sliceLines('a', 3, 1), /intervalo/);
  });

  await check('tools edit_file exige trecho unico', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-tools-'));
    process.env.HERMES_WORKSPACE = dir;
    fs.writeFileSync(path.join(dir, 'a.txt'), 'um dois um', 'utf8');

    delete require.cache[require.resolve('../services/file-store')];
    delete require.cache[require.resolve('../services/patches')];
    delete require.cache[require.resolve('../services/tools')];
    const tools = require('../services/tools');

    await assert.rejects(
      () => tools.execute('edit_file', { path: 'a.txt', old: 'um', new: 'x' }),
      /aparece 2 vezes/
    );
    await assert.rejects(
      () => tools.execute('edit_file', { path: 'a.txt', old: 'nao existe', new: 'x' }),
      /não encontrado/
    );
    await assert.rejects(
      () => tools.execute('read_file', { path: '../../etc/passwd' }),
      /fora do workspace/
    );

    delete process.env.HERMES_WORKSPACE;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await check('tools write_file devolve patch pendente', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-tools2-'));
    process.env.HERMES_WORKSPACE = dir;

    delete require.cache[require.resolve('../services/file-store')];
    delete require.cache[require.resolve('../services/patches')];
    delete require.cache[require.resolve('../services/tools')];
    const tools = require('../services/tools');

    const result = await tools.execute('write_file', { path: 'novo.txt', content: 'oi' });
    assert.strictEqual(result.requiresApproval, true);
    assert.strictEqual(result.changed, true);
    assert.ok(result.patchId);
    assert.strictEqual(fs.existsSync(path.join(dir, 'novo.txt')), false);

    await assert.rejects(() => tools.execute('exec', {}), /ferramenta desconhecida/);
    await assert.rejects(() => tools.execute('run_preview', {}), /no navegador/);

    delete process.env.HERMES_WORKSPACE;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await check('agents cria AGENTS.md com 7 secoes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-agents-'));
    process.env.HERMES_WORKSPACE = dir;

    for (const module of ['../services/file-store', '../services/patches', '../services/tools', '../services/agents']) {
      delete require.cache[require.resolve(module)];
    }
    const agents = require('../services/agents');

    const doc = await agents.readAgents();
    assert.strictEqual(doc.sections.length, 7);
    assert.strictEqual(doc.path, 'AGENTS.md');
    assert.ok(fs.existsSync(path.join(dir, 'AGENTS.md')));

    const numbers = doc.sections.map((section) => section.number);
    assert.deepStrictEqual(numbers, [1, 2, 3, 4, 5, 6, 7]);
    assert.deepStrictEqual(
      doc.sections.filter((section) => section.editable).map((section) => section.number),
      [1, 5]
    );

    delete process.env.HERMES_WORKSPACE;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await check('agents so aceita editar secoes 1 e 5', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-agents2-'));
    process.env.HERMES_WORKSPACE = dir;

    for (const module of ['../services/file-store', '../services/patches', '../services/tools', '../services/agents']) {
      delete require.cache[require.resolve(module)];
    }
    const agents = require('../services/agents');

    const updated = await agents.updateSection(1, ['- runner: máquina local', '- estado: fase 5'].join(String.fromCharCode(10)));
    assert.strictEqual(updated.sections[0].content, '- runner: máquina local\n- estado: fase 5');

    await assert.rejects(() => agents.updateSection(6, 'x'), /somente leitura/);
    await assert.rejects(() => agents.updateSection(99, 'x'), /inexistente/);
    await assert.rejects(() => agents.updateSection(5, 42), /texto/);

    delete process.env.HERMES_WORKSPACE;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await check('agents mantem decisoes recentes limitadas', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-agents3-'));
    process.env.HERMES_WORKSPACE = dir;

    for (const module of ['../services/file-store', '../services/patches', '../services/tools', '../services/agents']) {
      delete require.cache[require.resolve(module)];
    }
    const agents = require('../services/agents');

    for (let i = 0; i < 20; i += 1) {
      await agents.appendDecision(`decisão ${i}`);
    }

    const doc = await agents.readAgents();
    const recent = doc.sections.find((section) => section.number === 5).content;
    const lines = recent.split('\n').filter(Boolean);
    assert.strictEqual(lines.length, 12);
    assert.ok(lines[lines.length - 1].includes('decisão 19'));
    assert.ok(!recent.includes('decisão 7'));

    delete process.env.HERMES_WORKSPACE;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await check('agents injeta contexto truncado', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-agents4-'));
    process.env.HERMES_WORKSPACE = dir;

    for (const module of ['../services/file-store', '../services/patches', '../services/tools', '../services/agents']) {
      delete require.cache[require.resolve(module)];
    }
    const agents = require('../services/agents');

    await agents.updateSection(5, 'x'.repeat(3900));
    const context = await agents.buildContext();
    assert.ok(context.prompt.includes('AGENTS.md'));
    assert.ok(context.prompt.length > 0);

    delete process.env.HERMES_WORKSPACE;
    fs.rmSync(dir, { recursive: true, force: true });
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
