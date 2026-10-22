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

  await check('exec bloqueia sudo e comandos compostos', () => {
    const exec = require('../services/exec');
    assert.throws(() => exec.normalizeCommand('sudo rm -rf /'), /bloqueado/);
    assert.throws(() => exec.normalizeCommand('npm test; rm -rf /'), /não permitidos/);
    assert.throws(() => exec.normalizeCommand('curl http://x'), /deve começar com/);
    assert.strictEqual(exec.normalizeCommand('node --version'), 'node --version');
  });

  await check('exec exige aprovacao na primeira vez', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-exec-'));
    process.env.HERMES_WORKSPACE = dir;

    for (const module of ['../services/file-store', '../services/exec']) {
      delete require.cache[require.resolve(module)];
    }
    const exec = require('../services/exec');

    const preview = exec.requestExecution({ command: 'node -e "console.log(1)"' });
    assert.strictEqual(preview.requiresApproval, true);
    assert.ok(preview.approvalId);
    assert.strictEqual(exec.status().pendingApprovals, 1);

    const run = await exec.approveAndRun(preview.approvalId);
    assert.strictEqual(run.ok, true);
    assert.ok(run.stdout.includes('1'));

    const again = exec.requestExecution({ command: 'node -e "console.log(1)"' });
    assert.strictEqual(again.requiresApproval, false);

    delete process.env.HERMES_WORKSPACE;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await check('exec restringe cwd ao workspace e aplica timeout', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-exec2-'));
    process.env.HERMES_WORKSPACE = dir;

    for (const module of ['../services/file-store', '../services/exec']) {
      delete require.cache[require.resolve(module)];
    }
    const exec = require('../services/exec');

    assert.throws(() => exec.normalizeCwd('../../etc'), /fora do workspace/);
    assert.strictEqual(exec.normalizeTimeout(undefined), 30000);
    assert.strictEqual(exec.normalizeTimeout(999999), 120000);
    assert.throws(() => exec.normalizeTimeout(-5), /positivo/);

    fs.writeFileSync(path.join(dir, 'slow.js'), 'setTimeout(function () {}, 5000);', 'utf8');
    const slow = exec.requestExecution({ command: 'node slow.js', timeout: 1000 });
    const run = await exec.approveAndRun(slow.approvalId);
    assert.strictEqual(run.timedOut, true);

    delete process.env.HERMES_WORKSPACE;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await check('exec bloqueia rede quando desabilitada', () => {
    const exec = require('../services/exec');
    exec.setNetworkEnabled(false);
    assert.throws(() => exec.requestExecution({ command: 'npm install', network: true }), /rede desabilitada/);
  });

  await check('farm inclui modo demo sempre disponivel', async () => {
    const { detectProviders } = require('../services/detect-providers');
    const farm = await detectProviders({ refresh: true });

    const demo = farm.providers.find((provider) => provider.id === 'demo');
    assert.ok(demo, 'provedor demo ausente');
    assert.strictEqual(demo.available, true);
    assert.strictEqual(demo.alwaysAvailable, true);
    assert.strictEqual(demo.kind, 'demo');
    assert.ok(demo.description && demo.description.length > 10, 'demo sem descricao');

    const real = farm.providers.filter((provider) => provider.id !== 'demo' && provider.available);
    assert.strictEqual(farm.summary.available, real.length);
    assert.strictEqual(farm.summary.total, farm.providers.length);
    assert.strictEqual(farm.summary.demo, true);

    if (real.length > 0) assert.notStrictEqual(farm.activeProvider, 'demo');
    else assert.strictEqual(farm.activeProvider, 'demo');
  });

  await check('candidatos indisponiveis trazem motivo e dica', async () => {
    const { detectProviders } = require('../services/detect-providers');
    const farm = await detectProviders({ refresh: true });

    for (const provider of farm.providers) {
      if (provider.available || provider.id === 'demo') continue;
      assert.ok(provider.reason, `sem motivo: ${provider.id}`);
      assert.ok(provider.installHint, `sem dica: ${provider.id}`);
    }

    const ollama = farm.providers.find((provider) => provider.id === 'ollama');
    assert.strictEqual(ollama.setupCommand, 'ollama serve');

    const docker = farm.providers.find((provider) => provider.id === 'docker-test');
    assert.ok(docker.setupCommand.indexOf('docker compose') === 0);
  });

  await check('painel de diagnostico existe no html', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    for (const id of [
      'setup-modal',
      'setup-summary',
      'setup-providers',
      'setup-capabilities',
      'btn-setup-refresh',
      'btn-setup-demo',
      'chat-demo-hint',
    ]) {
      assert.ok(html.includes('id="' + id + '"'), `elemento ausente: ${id}`);
    }
  });

  await check('primeira execucao abre o diagnostico uma vez', () => {
    const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    assert.ok(app.includes("const ONBOARD_STORAGE_KEY = 'duck-hermes-onboarded'"));
    assert.ok(app.includes('openSetupModal()'));
    assert.ok(app.includes("localStorage.setItem(ONBOARD_STORAGE_KEY, '1')"));
    assert.ok(app.includes('explicitPreferredProvider'));
  });

  await check('git interpreta status porcelain com branch e ahead', () => {
    const git = require('../services/git');
    const parsed = git.parseStatus(
      [
        '## main...origin/main [ahead 2, behind 1]',
        ' M public/app.js',
        'M  server.js',
        'A  services/git.js',
        '?? notes.md',
        'UU conflito.txt',
      ].join(String.fromCharCode(10))
    );

    assert.strictEqual(parsed.branch, 'main');
    assert.strictEqual(parsed.upstream, 'origin/main');
    assert.strictEqual(parsed.ahead, 2);
    assert.strictEqual(parsed.behind, 1);
    assert.strictEqual(parsed.files.length, 5);

    const mod = parsed.files[0];
    assert.strictEqual(mod.path, 'public/app.js');
    assert.strictEqual(mod.staged, false);
    assert.strictEqual(mod.unstaged, true);

    const stagedFile = parsed.files[1];
    assert.strictEqual(stagedFile.path, 'server.js');
    assert.strictEqual(stagedFile.staged, true);
    assert.strictEqual(stagedFile.unstaged, false);

    const untracked = parsed.files[3];
    assert.strictEqual(untracked.untracked, true);
    assert.strictEqual(untracked.status, 'não rastreado');

    assert.strictEqual(parsed.files[4].conflict, true);
  });

  await check('git interpreta repositorio sem commits', () => {
    const git = require('../services/git');
    const header = git.parseBranchLine('## No commits yet on master');
    assert.strictEqual(header.branch, 'master');
    assert.strictEqual(header.unborn, true);
    assert.strictEqual(header.upstream, null);
  });

  await check('git valida mensagem de commit', () => {
    const git = require('../services/git');
    assert.strictEqual(git.normalizeMessage('  conserta bug  '), 'conserta bug');
    assert.throws(() => git.normalizeMessage('oi'), /pelo menos 4/);
    assert.throws(() => git.normalizeMessage('-trap'), /começar com/);
    assert.throws(() => git.normalizeMessage('x'.repeat(600)), /limitada a/);
    assert.throws(() => git.normalizeMessage(42), /obrigatória/);
  });

  await check('git bloqueia caminhos fora do workspace e com traco', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-git-path-'));
    process.env.HERMES_WORKSPACE = dir;
    delete require.cache[require.resolve('../services/file-store')];
    delete require.cache[require.resolve('../services/git')];
    const git = require('../services/git');

    assert.throws(() => git.normalizePaths(['../etc/passwd']), /fora do workspace/);
    assert.throws(() => git.normalizePaths(['-x']), /começar com/);
    assert.throws(() => git.normalizePaths(['.']), /raiz do workspace/);
    assert.throws(() => git.normalizePaths([]), /lista de arquivos/);
    assert.deepStrictEqual(git.normalizePaths(['a.js', 'a.js']), ['a.js']);

    delete process.env.HERMES_WORKSPACE;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await check('git commit exige confirmacao explicita', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-git-confirm-'));
    process.env.HERMES_WORKSPACE = dir;
    delete require.cache[require.resolve('../services/file-store')];
    delete require.cache[require.resolve('../services/git')];
    const git = require('../services/git');

    await assert.rejects(() => git.commit({ message: 'mensagem valida' }), (error) => error.status === 428);

    delete process.env.HERMES_WORKSPACE;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await check('git reporta pasta sem repositorio', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-git-norepo-'));
    process.env.HERMES_WORKSPACE = dir;
    delete require.cache[require.resolve('../services/file-store')];
    delete require.cache[require.resolve('../services/git')];
    const git = require('../services/git');

    const status = await git.status();
    assert.strictEqual(status.isRepo, false);
    assert.ok(status.reason.indexOf('não é um repositório') !== -1);
    assert.ok(status.hint.indexOf('git init') !== -1);
    assert.deepStrictEqual(status.files, []);
    await assert.rejects(() => git.stage(['a.js']), /não é um repositório/);

    delete process.env.HERMES_WORKSPACE;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await check('relay lista openrouter e gemini', () => {
    const relay = require('../services/relay');
    const list = relay.status();
    const ids = list.map((item) => item.id);
    assert.ok(ids.indexOf('openrouter') !== -1);
    assert.ok(ids.indexOf('gemini') !== -1);

    for (const item of list) {
      assert.ok(item.keyEnv, 'sem keyEnv: ' + item.id);
      assert.ok(item.installHint, 'sem dica: ' + item.id);
      assert.strictEqual(typeof item.available, 'boolean');
    }

    assert.strictEqual(relay.isRelay('openrouter'), true);
    assert.strictEqual(relay.isRelay('gemini'), true);
    assert.strictEqual(relay.isRelay('ollama'), false);
  });

  await check('relay converte historico para o formato do gemini', () => {
    const relay = require('../services/relay');
    const contents = relay.toGeminiContents([
      { role: 'system', content: 'instruções' },
      { role: 'user', content: 'leia a.txt' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'c1', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } }],
      },
      { role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' },
    ]);

    assert.strictEqual(contents.length, 3);
    assert.strictEqual(contents[0].role, 'user');
    assert.strictEqual(contents[1].role, 'model');
    assert.strictEqual(contents[1].parts[0].functionCall.name, 'read_file');
    assert.strictEqual(contents[2].parts[0].functionResponse.name, 'read_file');
    assert.deepStrictEqual(contents[2].parts[0].functionResponse.response.result, { ok: true });

    const tools = relay.toGeminiTools([
      { type: 'function', function: { name: 'read_file', description: 'le', parameters: { type: 'object' } } },
    ]);
    assert.strictEqual(tools[0].functionDeclarations[0].name, 'read_file');
  });

  await check('relay recusa provedor desconhecido e lista vazia', async () => {
    const relay = require('../services/relay');
    await assert.rejects(() => relay.chat({ provider: 'nada', messages: [{ role: 'user', content: 'x' }] }), /desconhecido/);
    await assert.rejects(() => relay.chat({ provider: 'openrouter', messages: [] }), /lista não vazia/);
  });

  await check('ai-talk valida papel e tarefa', () => {
    const aiTalk = require('../services/ai-talk');
    assert.strictEqual(aiTalk.normalizeRole(undefined), 'any');
    assert.strictEqual(aiTalk.normalizeRole('CLOUD'), 'cloud');
    assert.throws(() => aiTalk.normalizeRole('chefe'), /papel inválido/);

    assert.strictEqual(aiTalk.normalizeTask('  fazer algo  '), 'fazer algo');
    assert.throws(() => aiTalk.normalizeTask('ab'), /curta demais/);
    assert.throws(() => aiTalk.normalizeTask('x'.repeat(9000)), /limitada a/);
    assert.throws(() => aiTalk.normalizeTask(12), /texto/);
  });

  await check('ai-talk explica quando nao ha provedor', () => {
    const aiTalk = require('../services/ai-talk');
    assert.throws(() => aiTalk.pickTarget([], 'local'), /nenhum provedor com papel/);
    assert.throws(() => aiTalk.pickTarget([], 'any'), /nenhum provedor de IA/);
    assert.throws(
      () => aiTalk.pickTarget([{ id: 'ollama', roles: ['local'] }], 'any', 'docker-test'),
      /não está disponível/
    );
    assert.strictEqual(
      aiTalk.pickTarget([{ id: 'ollama', roles: ['local'] }], 'any').id,
      'ollama'
    );
  });

  await check('tools expoe a ferramenta delegate', () => {
    const tools = require('../services/tools');
    const names = tools.listDefinitions().map((tool) => tool.function.name);
    assert.ok(names.indexOf('delegate') !== -1);
    assert.strictEqual(tools.SERVER_TOOLS.has('delegate'), true);
    assert.strictEqual(tools.CLIENT_TOOLS.has('delegate'), false);
  });

  await check('interface tem modal Git e secao ai-talk', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    for (const id of ['git-modal', 'git-files', 'git-diff', 'git-message', 'git-log', 'btn-git-commit']) {
      assert.ok(html.indexOf('id="' + id + '"') !== -1, 'elemento ausente: ' + id);
    }
    for (const id of ['ai-talk-roles', 'ai-talk-recent', 'btn-ai-talk-clear']) {
      assert.ok(html.indexOf('id="' + id + '"') !== -1, 'elemento ausente: ' + id);
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
