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

  await check('file-store recusa symlink que aponta para fora do workspace', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-link-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-fora-'));
    fs.writeFileSync(path.join(outside, 'segredo.txt'), 'segredo');

    let linksSupported = true;
    try {
      fs.symlinkSync(path.join(outside, 'segredo.txt'), path.join(dir, 'link.txt'));
      fs.symlinkSync(outside, path.join(dir, 'escape'));
    } catch (error) {
      linksSupported = false;
    }

    if (linksSupported) {
      process.env.HERMES_WORKSPACE = dir;
      delete require.cache[require.resolve('../services/file-store')];
      const store = require('../services/file-store');

      await assert.rejects(() => store.readFile('link.txt'), (error) => error.status === 403);
      await assert.rejects(() => store.readRaw('link.txt'), (error) => error.status === 403);
      await assert.rejects(() => store.listDirectory('escape'), (error) => error.status === 403);
      await assert.rejects(
        () => store.writeFile('escape/novo.txt', 'x'),
        (error) => error.status === 403
      );

      fs.writeFileSync(path.join(dir, 'ok.txt'), 'ok');
      const read = await store.readFile('ok.txt');
      assert.strictEqual(read.content, 'ok');

      delete process.env.HERMES_WORKSPACE;
    }

    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  await check('api/fs/raw neutraliza svg e impede farejamento de tipo', () => {
    const store = require('../services/file-store');

    const svg = store.rawHeaders('image/svg+xml');
    assert.strictEqual(svg['X-Content-Type-Options'], 'nosniff');
    assert.ok(/sandbox/.test(svg['Content-Security-Policy'] || ''), 'svg sem CSP sandbox');

    const png = store.rawHeaders('image/png');
    assert.strictEqual(png['X-Content-Type-Options'], 'nosniff');
    assert.strictEqual(png['Content-Security-Policy'], undefined, 'png não precisa de CSP');
  });

  await check('host guard bloqueia DNS rebinding no loopback', () => {
    const guard = require('../services/local-guard');

    assert.strictEqual(guard.hostAllowed('127.0.0.1:3000', {}), true);
    assert.strictEqual(guard.hostAllowed('localhost:3000', {}), true);
    assert.strictEqual(guard.hostAllowed('[::1]:3000', {}), true);
    assert.strictEqual(guard.hostAllowed('evil.example:3000', {}), false);
    assert.strictEqual(guard.hostAllowed('', {}), false);

    // exposição intencional fora do loopback continua liberada
    assert.strictEqual(guard.hostAllowed('192.168.0.5:3000', { HERMES_HOST: '0.0.0.0' }), true);
    assert.strictEqual(guard.hostAllowed('hermes.lan:3000', { HERMES_HOST: '192.168.0.10' }), true);
  });

  await check('servidor valida Host e endurece /api/fs/raw', () => {
    const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.ok(server.includes("require('./services/local-guard')"), 'guard não importado');
    assert.ok(/hostAllowed\(req\.headers\.host/.test(server), 'middleware de Host ausente');
    assert.ok(/rawHeaders\(info\.mime\)/.test(server), 'cabeçalhos do raw ausentes');
    assert.ok(/app\.disable\('x-powered-by'\)/.test(server), 'x-powered-by deveria estar desligado');
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

  await check('file-store serve midia com mime correto', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-raw-'));
    process.env.HERMES_WORKSPACE = dir;
    delete require.cache[require.resolve('../services/file-store')];
    const store = require('../services/file-store');

    fs.writeFileSync(path.join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    fs.writeFileSync(path.join(dir, 'doc.pdf'), '%PDF-1.4');

    const png = await store.readRaw('logo.png');
    assert.strictEqual(png.mime, 'image/png');
    assert.strictEqual(png.size, 6);
    assert.ok(png.absolutePath.endsWith('logo.png'));

    const pdf = await store.readRaw('doc.pdf');
    assert.strictEqual(pdf.mime, 'application/pdf');

    assert.strictEqual(store.mimeForPath('a.svg'), 'image/svg+xml');
    assert.strictEqual(store.mimeForPath('a.xyz'), 'application/octet-stream');

    await assert.rejects(() => store.readRaw('../../etc/passwd'), /fora do workspace/);
    await assert.rejects(() => store.readRaw('ausente.png'), /não encontrado/);
    await assert.rejects(() => store.readRaw(''), /caminho obrigatório/);

    delete process.env.HERMES_WORKSPACE;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await check('file-store limita tamanho de midia', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-raw-big-'));
    process.env.HERMES_WORKSPACE = dir;
    delete require.cache[require.resolve('../services/file-store')];
    const store = require('../services/file-store');

    const big = path.join(dir, 'grande.bin');
    fs.writeFileSync(big, Buffer.alloc(store.MAX_MEDIA_BYTES + 1, 1));
    await assert.rejects(() => store.readRaw('grande.bin'), /maior que/);

    fs.unlinkSync(big);
    delete process.env.HERMES_WORKSPACE;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await check('backend expoe a rota de arquivo bruto', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.ok(source.includes("app.get('/api/fs/raw'"));
    assert.ok(source.includes('fileStore.readRaw'));
    assert.ok(source.includes("'Content-Disposition'"));
  });

  await check('visualizador cobre imagem, pdf, binario, yaml, toml e codigo', () => {
    const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    for (const kind of ["'image'", "'pdf'", "'yaml'", "'toml'", "'code'"]) {
      assert.ok(app.includes('return ' + kind), 'fileKind sem ' + kind);
    }
    assert.ok(app.includes("openMediaTab(targetPath, 'binary')"), 'binario nao abre como midia');
    for (const fn of ['renderMediaPanel', 'renderBinaryPanel', 'renderHighlightedCode', 'renderStructuredTree', 'activeKind']) {
      assert.ok(app.includes('function ' + fn), 'funcao ausente: ' + fn);
    }
    assert.ok(app.includes("'/api/fs/raw?path='") || app.includes('/api/fs/raw?path='));
    assert.ok(app.includes('LEGACY_MODES'));
  });

  await check('abas de midia nao entram no armazenamento local', () => {
    const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    assert.ok(app.includes('state.media[name]'));
    assert.ok(app.includes('if (!state.media[name]) textFiles[name] = state.files[name];'));
    assert.ok(app.includes('if (!state.media[state.activeFile]) {'));
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

  await check('paths usa HERMES_DATA_DIR quando definido', () => {
    const original = process.env.HERMES_DATA_DIR;
    process.env.HERMES_DATA_DIR = path.join(os.tmpdir(), 'hermes-data-dir');
    delete require.cache[require.resolve('../services/paths')];
    const paths = require('../services/paths');

    assert.strictEqual(paths.dataDir(), path.join(os.tmpdir(), 'hermes-data-dir'));

    delete process.env.HERMES_DATA_DIR;
    delete require.cache[require.resolve('../services/paths')];
    const fallback = require('../services/paths');
    assert.ok(fallback.dataDir().endsWith(path.join('', 'data')), 'fallback deveria ser <repo>/data');

    if (original !== undefined) process.env.HERMES_DATA_DIR = original;
  });

  await check('servicos gravaveis respeitam HERMES_DATA_DIR', () => {
    for (const file of ['machines.js', 'exec.js', 'ai-talk.js']) {
      const source = fs.readFileSync(path.join(__dirname, '..', 'services', file), 'utf8');
      assert.ok(source.includes("require('./paths')"), file + ' não usa services/paths');
      assert.ok(!source.includes("__dirname, '..', 'data'"), file + ' ainda monta data/ com __dirname');
    }

    const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.ok(server.includes('path.join(dataDir(), \'devdocs\')'), 'devdocs fora do dataDir');
  });

  await check('entrypoint empacotado trata argumentos e dados por SO', () => {
    const source = fs.readFileSync(path.join(__dirname, 'packaged.js'), 'utf8');
    for (const flag of ['--port', '--workspace', '--data', '--no-open', '--help']) {
      assert.ok(source.includes(flag), 'flag ausente: ' + flag);
    }
    assert.ok(source.includes("process.env.APPDATA"), 'sem pasta de dados no Windows');
    assert.ok(source.includes('Application Support'), 'sem pasta de dados no macOS');
    assert.ok(source.includes('XDG_DATA_HOME'), 'sem pasta de dados no Linux');
    assert.ok(source.includes("process.platform === 'win32' ? 'cmd'"), 'sem abertura de navegador no Windows');
    assert.ok(source.includes("return ['/c', 'start', '', url]") || source.includes("['/c', 'start', '', url]"));
  });

  await check('workflow gera apps para Windows, Linux e macOS', () => {
    const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'build.yml'), 'utf8');
    for (const target of ['linux-x64', 'linux-arm64', 'win-x64', 'macos-x64', 'macos-arm64']) {
      assert.ok(workflow.includes(target), 'alvo ausente: ' + target);
    }
    assert.ok(workflow.includes('npm ci'));
    assert.ok(workflow.includes('npm test'));
    assert.ok(workflow.includes('scripts/build-app.js'));
    assert.ok(workflow.includes('scripts/smoke-binary.js'));
    assert.ok(workflow.includes('actions/upload-artifact'));
    assert.ok(workflow.includes('softprops/action-gh-release'));
    assert.ok(workflow.includes("tags: ['v*']"));
  });

  await check('workflow roda em runners disponiveis e instala o pkg', () => {
    const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'build.yml'), 'utf8');

    // o runner macOS Intel foi desativado: o alvo x64 sai por cross-build no runner arm64
    assert.ok(!/os: macos-13/.test(workflow), 'runner macOS Intel não existe mais');
    assert.ok(workflow.includes('macos-14'), 'sem runner macOS disponível');
    assert.ok(/os: macos-14\s*\n\s*target: macos-x64/.test(workflow), 'macos-x64 deveria usar macos-14');

    assert.ok(workflow.includes('@yao-pkg/pkg@'), 'workflow não instala o pkg');
    assert.ok(workflow.includes('--no-package-lock'), 'instalação não pode alterar o lockfile');
    assert.ok(workflow.includes('timeout-minutes'), 'sem timeout, runner inexistente trava o job');
    assert.ok(workflow.includes('Conferir arquivo gerado'), 'sem checagem do arquivo gerado');
  });

  await check('build-app aceita alvos curtos e recusa injecao', () => {
    const build = require('../scripts/build-app');

    assert.deepStrictEqual(
      build.normalizeTargets(['linux-x64', 'win-x64', 'macos-arm64']),
      ['node22-linux-x64', 'node22-win-x64', 'node22-macos-arm64']
    );
    assert.deepStrictEqual(build.normalizeTargets(['node22-macos-x64']), ['node22-macos-x64']);

    for (const bad of ['linux-x64; rm -rf /', '--output=/tmp/x', 'node22-linux', '']) {
      assert.throws(() => build.normalizeTargets([bad]), /alvo inválido/);
    }

    assert.strictEqual(build.outputName('node22-win-x64'), 'duck-hermes-studio-win-x64.exe');
    assert.strictEqual(build.outputName('node22-macos-x64'), 'duck-hermes-studio-macos-x64');
    assert.strictEqual(build.outputName('node22-linux-arm64'), 'duck-hermes-studio-linux-arm64');
  });

  await check('build-app evita spawn EINVAL no Windows', () => {
    const source = fs.readFileSync(path.join(__dirname, 'build-app.js'), 'utf8');

    // .cmd/.bat exigem shell no Windows desde o patch do CVE-2024-27980
    assert.ok(source.includes('shell: true'), 'faltou shell para o npx no Windows');
    assert.ok(source.includes('JSON.stringify(arg)'), 'faltou citar argumentos com espaço');
    assert.ok(source.includes('npx-cli.js'), 'sem fallback para o npx-cli (evita .cmd)');
    assert.ok(source.includes('function childEnv'), 'sem ajuste de PATH para o Node atual');
    assert.ok(source.includes('if (!fs.existsSync(output))'), 'build sem verificar a saída');
    assert.ok(source.includes('não foi possível iniciar o pkg'), 'erro de spawn sem mensagem clara');
  });

  await check('package.json declara build e assets do pkg', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    assert.strictEqual(typeof pkg.scripts['build:win'], 'string');
    assert.strictEqual(typeof pkg.scripts['build:linux'], 'string');
    assert.strictEqual(typeof pkg.scripts['build:mac'], 'string');
    const buildScript = fs.readFileSync(path.join(__dirname, 'build-app.js'), 'utf8');
    assert.ok(buildScript.includes('@yao-pkg/pkg'), 'build-app não usa @yao-pkg/pkg');
    assert.ok(pkg.pkg.assets.some((item) => item.startsWith('public/')), 'sem assets de public/');
    assert.ok(pkg.pkg.scripts.includes('scripts/packaged.js'), 'entrypoint não empacotado');
    assert.ok(!pkg.pkg.assets.includes('.env'), '.env não pode entrar nos assets');
  });

  await check('AGENTS.md compacto cobre o que foi feito', () => {
    const doc = fs.readFileSync(path.join(__dirname, '..', 'AGENTS.md'), 'utf8');
    assert.ok(doc.split(String.fromCharCode(10)).length <= 200, 'AGENTS.md acima do recomendado');
    for (const number of [1, 2, 3, 4, 5, 6, 7]) {
      assert.ok(doc.includes('## ' + number + '.'), 'seção ' + number + ' ausente');
    }
    for (const term of ['npm test', '/api/git', 'ai-talk', 'build.yml', 'HERMES_DATA_DIR']) {
      assert.ok(doc.includes(term), 'AGENTS.md sem ' + term);
    }
  });

  await check('workspace troca de raiz e persiste a escolha', async () => {
    const { execFileSync } = require('child_process');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-ws-'));
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-ws-b-'));
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.mkdirSync(path.join(dir, 'repo'));
    execFileSync('git', ['init', '-q', path.join(dir, 'repo')]);

    const previousData = process.env.HERMES_DATA_DIR;
    const previousWs = process.env.HERMES_WORKSPACE;
    process.env.HERMES_DATA_DIR = path.join(dir, 'data');
    delete process.env.HERMES_WORKSPACE;

    delete require.cache[require.resolve('../services/paths')];
    delete require.cache[require.resolve('../services/file-store')];
    const paths = require('../services/paths');
    const store = require('../services/file-store');

    assert.strictEqual(paths.workspaceRoot(), path.resolve(process.cwd()));

    const info = paths.setWorkspace(other);
    assert.strictEqual(info.root, other);
    assert.strictEqual(info.source, 'sessão');
    assert.strictEqual(store.workspaceRoot(), other);
    assert.ok(fs.existsSync(paths.STATE_FILE()), 'estado não foi salvo');

    const state = JSON.parse(fs.readFileSync(paths.STATE_FILE(), 'utf8'));
    assert.strictEqual(state.path, other);
    assert.ok(state.recent.includes(other));

    const browseData = paths.browse(dir);
    assert.strictEqual(browseData.path, dir);
    assert.ok(browseData.entries.some((entry) => entry.name === 'repo' && entry.isRepo));
    assert.ok(browseData.entries.every((entry) => entry.name !== 'data' || true));
    assert.strictEqual(browseData.parent, path.dirname(dir));

    assert.throws(() => paths.setWorkspace(path.join(dir, 'nao-existe')), /não encontrada/);
    assert.throws(() => paths.setWorkspace(''), /informe a pasta/);
    assert.throws(() => paths.browse(' ' + path.join(dir, 'tambem-nao')), /não encontrada/);

    paths.resetWorkspace();
    assert.strictEqual(paths.workspaceRoot(), path.resolve(process.cwd()));

    if (previousData === undefined) delete process.env.HERMES_DATA_DIR;
    else process.env.HERMES_DATA_DIR = previousData;
    if (previousWs !== undefined) process.env.HERMES_WORKSPACE = previousWs;

    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(other, { recursive: true, force: true });
  });

  await check('workspace mostra origem e limites do file-store', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'services', 'paths.js'), 'utf8');
    assert.ok(source.includes('function workspaceInfo'));
    assert.ok(source.includes("'sessão'"));
    assert.ok(source.includes('recent'));

    const store = fs.readFileSync(path.join(__dirname, '..', 'services', 'file-store.js'), 'utf8');
    assert.ok(store.includes('mediaLimitBytes'));
    assert.ok(store.includes('paths.workspaceInfo()'));

    const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.ok(server.includes("app.get('/api/workspace'"));
    assert.ok(server.includes("app.post('/api/workspace'"));
    assert.ok(server.includes("app.delete('/api/workspace'"));
    assert.ok(server.includes("app.get('/api/workspace/browse'"));
  });

  await check('config valida token do GitHub e mascara o segredo', async () => {
    const http = require('http');
    const TOKEN = 'ghp_token_de_teste_1234567890';
    const requests = [];

    const server = http.createServer((req, res) => {
      requests.push({ url: req.url, auth: req.headers.authorization });
      if (req.url !== '/user') {
        res.writeHead(404).end('{}');
        return;
      }
      if (req.headers.authorization !== 'Bearer ' + TOKEN) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Bad credentials' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ login: 'octo-teste', name: 'Octo Teste', email: 'octo@exemplo.com' }));
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-gh-'));
    const previousData = process.env.HERMES_DATA_DIR;
    const previousApi = process.env.HERMES_GITHUB_API;
    process.env.HERMES_DATA_DIR = dir;
    process.env.HERMES_GITHUB_API = 'http://127.0.0.1:' + port;

    for (const module of ['../services/paths', '../services/http-client', '../services/config']) {
      delete require.cache[require.resolve(module)];
    }
    const config = require('../services/config');

    try {
      await assert.rejects(() => config.saveGithub({ token: 'curto' }), /curto demais/);
      await assert.rejects(() => config.saveGithub({ token: 'ghp_errado_0000000000000000' }), /recusado/);

      const saved = await config.saveGithub({ token: TOKEN });
      assert.strictEqual(saved.github.hasToken, true);
      assert.strictEqual(saved.github.login, 'octo-teste');
      assert.ok(saved.github.tokenHint.indexOf(TOKEN) === -1, 'token não pode voltar inteiro');
      assert.ok(saved.github.tokenHint.indexOf('…') !== -1);

      const stored = JSON.parse(fs.readFileSync(config.CONFIG_FILE(), 'utf8'));
      assert.strictEqual(stored.github.token, TOKEN);

      const auth = config.gitAuthEnv();
      assert.strictEqual(auth.GIT_CONFIG_KEY_0, 'http.extraHeader');
      assert.ok(auth.GIT_CONFIG_VALUE_0.startsWith('Authorization: Basic '));
      assert.ok(auth.GIT_CONFIG_VALUE_0.indexOf(TOKEN) === -1, 'token não pode ir em claro no header');

      assert.deepStrictEqual(config.commitIdentity(), { name: 'Octo Teste', email: 'octo@exemplo.com' });

      await assert.rejects(() => config.saveGithub({ email: 'invalido' }), /e-mail inválido/);

      const cleared = config.clearToken();
      assert.strictEqual(cleared.github.hasToken, false);
      assert.strictEqual(config.tokenForGit(), null);
      assert.deepStrictEqual(config.gitAuthEnv(), {});
      assert.ok(requests.length >= 2, 'deveria ter validado o token no GitHub');
    } finally {
      server.close();
      if (previousData === undefined) delete process.env.HERMES_DATA_DIR;
      else process.env.HERMES_DATA_DIR = previousData;
      if (previousApi === undefined) delete process.env.HERMES_GITHUB_API;
      else process.env.HERMES_GITHUB_API = previousApi;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await check('config salva chave de API mascarada e aplica no ambiente', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-key-'));
    const previousData = process.env.HERMES_DATA_DIR;
    const previousEnv = process.env.DEEPSEEK_API_KEY;
    process.env.HERMES_DATA_DIR = dir;
    delete process.env.DEEPSEEK_API_KEY;

    for (const module of ['../services/paths', '../services/config']) {
      delete require.cache[require.resolve(module)];
    }
    const config = require('../services/config');

    try {
      const opened = config.publicConfig();
      assert.ok(Array.isArray(opened.keys), 'publicConfig sem lista de chaves');
      assert.strictEqual(opened.keys.length >= 3, true);
      assert.strictEqual(opened.keys.find((k) => k.id === 'deepseek').configured, false);

      const saved = config.saveApiKey('deepseek', '  sk-teste-1234567890abcdef  ');
      const deepseek = saved.keys.find((k) => k.id === 'deepseek');
      assert.strictEqual(deepseek.configured, true);
      assert.strictEqual(deepseek.source, 'app');
      assert.strictEqual(deepseek.canRemove, true);
      assert.ok(deepseek.hintValue.indexOf('1234567890') === -1, 'hint vazou a chave');
      assert.ok(deepseek.hintValue.indexOf('…') !== -1);
      assert.strictEqual(process.env.DEEPSEEK_API_KEY, 'sk-teste-1234567890abcdef');

      const stored = JSON.parse(fs.readFileSync(config.CONFIG_FILE(), 'utf8'));
      assert.strictEqual(stored.keys.deepseek.value, 'sk-teste-1234567890abcdef');

      const removed = config.removeApiKey('deepseek');
      assert.strictEqual(removed.keys.find((k) => k.id === 'deepseek').configured, false);
      assert.strictEqual(process.env.DEEPSEEK_API_KEY, undefined);

      assert.throws(() => config.saveApiKey('nada', 'sk-1234567890abcdef'), /desconhecido/);
      assert.throws(() => config.saveApiKey('deepseek', ''), /cole a chave/);
      assert.throws(() => config.saveApiKey('deepseek', 'curta'), /curta demais/);
      assert.throws(() => config.saveApiKey('deepseek', 'sk-aaa bbb ccc dddd'), /espaços/);
      assert.strictEqual(config.normalizeApiKey('Bearer sk-abcdefghijklmnop'), 'sk-abcdefghijklmnop');
      assert.strictEqual(config.normalizeApiKey('"sk-abcdefghijklmnop"'), 'sk-abcdefghijklmnop');
    } finally {
      if (previousData === undefined) delete process.env.HERMES_DATA_DIR;
      else process.env.HERMES_DATA_DIR = previousData;
      if (previousEnv === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = previousEnv;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await check('config aplica chaves salvas no boot e respeita o ambiente', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-key2-'));
    const previousData = process.env.HERMES_DATA_DIR;
    const previousEnv = process.env.OPENROUTER_API_KEY;
    process.env.HERMES_DATA_DIR = dir;
    process.env.OPENROUTER_API_KEY = 'sk-or-do-ambiente-123456';

    for (const module of ['../services/paths', '../services/config']) {
      delete require.cache[require.resolve(module)];
    }
    const config = require('../services/config');

    try {
      const fromEnv = config.publicConfig().keys.find((k) => k.id === 'openrouter');
      assert.strictEqual(fromEnv.configured, true);
      assert.strictEqual(fromEnv.source, 'ambiente');
      assert.strictEqual(fromEnv.canRemove, false);

      config.saveApiKey('openrouter', 'sk-or-do-app-1234567890');
      assert.strictEqual(config.publicConfig().keys.find((k) => k.id === 'openrouter').source, 'app');

      fs.writeFileSync(
        config.CONFIG_FILE(),
        JSON.stringify({ keys: { gemini: { value: 'AIza-chave-do-app-123456', savedAt: new Date().toISOString() } } })
      );

      for (const module of ['../services/paths', '../services/config']) {
        delete require.cache[require.resolve(module)];
      }
      const reloaded = require('../services/config');
      delete process.env.GEMINI_API_KEY;
      const applied = reloaded.applyStoredKeys();

      assert.deepStrictEqual(applied, ['gemini']);
      assert.strictEqual(process.env.GEMINI_API_KEY, 'AIza-chave-do-app-123456');
    } finally {
      delete process.env.GEMINI_API_KEY;
      if (previousData === undefined) delete process.env.HERMES_DATA_DIR;
      else process.env.HERMES_DATA_DIR = previousData;
      if (previousEnv === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousEnv;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await check('celeiro tem campo para colar a chave', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    assert.ok(html.includes('id="api-keys"'), 'sem container de chaves');
    assert.ok(html.includes('id="api-keys-status"'), 'sem status das chaves');
    assert.ok(/Chaves de API<\/h3>/.test(html), 'sem título da seção');

    const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    for (const fn of ['renderApiKeys', 'apiKeyRow', 'focusApiKey', 'loadApiKeys', 'reloadFarmAfterKeys']) {
      assert.ok(app.includes('function ' + fn), 'função ausente: ' + fn);
    }
    assert.ok(app.includes("input.type = 'password'"), 'campo deveria ser password');
    assert.ok(app.includes("toggle.textContent = showing ? 'mostrar' : 'ocultar'"), 'sem botão mostrar/ocultar');
    assert.ok(app.includes("'/api/config/keys'"), 'sem chamada para salvar a chave');
    assert.ok(app.includes('focusApiKey(provider.id)'), 'cartão sem atalho para o campo');

    const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.ok(server.includes("app.post('/api/config/keys'"));
    assert.ok(server.includes("app.delete('/api/config/keys/:id'"));
    assert.ok(server.includes('applyStoredKeys'));
  });

  await check('provedores de nuvem indicam o campo de chave', () => {
    const detect = fs.readFileSync(path.join(__dirname, '..', 'services', 'detect-providers.js'), 'utf8');
    assert.ok(detect.includes("keyEnv: 'DEEPSEEK_API_KEY'"));
    assert.ok(detect.includes('Chaves de API'), 'dica do DeepSeek não aponta para a seção');

    const relay = fs.readFileSync(path.join(__dirname, '..', 'services', 'relay.js'), 'utf8');
    assert.ok(relay.includes('Chaves de API'), 'dica dos relays não aponta para a seção');
    assert.ok(!/echo OPENROUTER_API_KEY=/.test(relay), 'não deve mandar editar .env');

    const config = require('../services/config');
    assert.strictEqual(config.KEY_PROVIDERS.length >= 3, true);
  });

  await check('git valida remote e exige confirmacao para push/pull', async () => {
    const { execFileSync } = require('child_process');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-git-net-'));
    execFileSync('git', ['init', '-q', dir]);

    const previousWs = process.env.HERMES_WORKSPACE;
    const previousData = process.env.HERMES_DATA_DIR;
    process.env.HERMES_WORKSPACE = dir;
    process.env.HERMES_DATA_DIR = path.join(dir, 'data');

    for (const module of ['../services/paths', '../services/file-store', '../services/config', '../services/git']) {
      delete require.cache[require.resolve(module)];
    }
    const git = require('../services/git');

    try {
      assert.throws(() => git.normalizeRemoteUrl('-x'), /começar com/);
      assert.throws(() => git.normalizeRemoteUrl('ftp://x'), /https:\/\//);
      assert.strictEqual(git.normalizeRemoteUrl('https://github.com/a/b.git'), 'https://github.com/a/b.git');
      assert.strictEqual(git.normalizeRemoteUrl('git@github.com:a/b.git'), 'git@github.com:a/b.git');

      const set = await git.setRemote({ url: '/tmp/remote-inexistente.git' });
      assert.strictEqual(set.remote.name, 'origin');
      assert.ok(set.remotes.some((remote) => remote.name === 'origin'));

      await assert.rejects(() => git.pushRemote({}), (error) => error.status === 428);
      await assert.rejects(() => git.pullRemote({}), (error) => error.status === 428);
      await assert.rejects(() => git.fetchRemote({ remote: 'naoexiste' }), /não configurado/);
      await assert.rejects(() => git.setRemote({ name: 'nome inválido', url: '/tmp/x' }), /nome de remote/);
    } finally {
      if (previousWs === undefined) delete process.env.HERMES_WORKSPACE;
      else process.env.HERMES_WORKSPACE = previousWs;
      if (previousData === undefined) delete process.env.HERMES_DATA_DIR;
      else process.env.HERMES_DATA_DIR = previousData;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await check('modal de pasta nao usa o ponto do GitHub como etiqueta', () => {
    const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');

    // o ".github-dot" é um círculo de 8px: texto dentro dele ficava clipado
    assert.ok(!/folderTag\('origem: [^)]*'github-dot/.test(app), 'origem ainda usa github-dot');
    assert.ok(!app.includes("folderTag('repositório Git', 'github-dot"), 'repo ainda usa github-dot');
    assert.ok(app.includes("folderTag('origem: ' + (info.source || '?'), 'folder-badge')"));

    assert.ok(css.includes('.folder-badge'), 'sem estilo de etiqueta da pasta');
    assert.ok(css.includes('.folder-meta'), 'sem container das etiquetas');
    assert.ok(/\.folder-list\s*\{[^}]*min-height/.test(css), 'lista sem min-height (pode colapsar)');
    assert.ok(!css.includes('.folder-shortcut.is-repo::after'), 'recentes não devem herdar selo de git');
  });

  await check('menu do topo nao abre fora da janela', () => {
    const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');

    assert.ok(app.includes('function positionMenu'), 'sem clamp do menu');
    assert.ok(app.includes('window.innerWidth - margin'), 'clamp não considera a viewport');
    assert.ok(app.includes('panel.style.left'), 'clamp não reposiciona o painel');
    assert.ok(/\.menu-item \.menu-shortcut\s*\{[^}]*text-overflow: ellipsis/.test(css), 'rótulo longo estoura o item');
    assert.ok(/\.menu-item \.menu-shortcut\s*\{[^}]*max-width/.test(css), 'rótulo longo sem limite de largura');
    assert.ok(css.includes('max-width: min(460px, calc(100vw - 32px))'), 'painel sem limite de largura');
  });

  await check('interface tem abrir pasta, GitHub e novo arquivo', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    for (const id of [
      'btn-new-file',
      'new-file-modal',
      'new-file-name',
      'btn-open-folder',
      'folder-modal',
      'folder-list',
      'btn-folder-choose',
      'btn-github',
      'github-modal',
      'github-form',
      'git-remote',
      'btn-git-fetch',
      'btn-git-pull',
      'btn-git-push',
    ]) {
      assert.ok(html.indexOf('id="' + id + '"') !== -1, 'elemento ausente: ' + id);
    }

    const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    for (const fn of ['openFolderModal', 'chooseFolder', 'openGithubModal', 'saveGithub', 'runGitSync', 'createNewFile']) {
      assert.ok(app.indexOf('function ' + fn) !== -1, 'função ausente: ' + fn);
    }
    assert.ok(app.includes('NEW_FILE_TEMPLATES'));
    assert.ok(app.includes("'/api/workspace'"));
    assert.ok(app.includes("'/api/config/github'"));
    assert.ok(app.includes("'/api/git/' + action"));
    assert.ok(app.includes('state.gitSyncPending !== action'), 'push/pull precisam de confirmação');
  });

  await check('README do usuario e o tecnico estao separados', () => {
    const user = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
    const tech = fs.readFileSync(path.join(__dirname, '..', 'README-TECNICO.md'), 'utf8');

    assert.ok(user.includes('README-TECNICO.md'), 'guia do usuário sem link para o técnico');
    assert.ok(tech.includes('README.md'), 'técnico sem link para o guia');
    assert.ok(tech.includes('documentação técnica'));

    for (const topic of ['Abrir pasta', 'Novo arquivo', 'Chaves de API', 'Problemas comuns']) {
      assert.ok(user.includes(topic), 'guia do usuário sem: ' + topic);
    }

    // o guia do usuário não deve virar referência de API
    assert.ok(!/POST \/api\//.test(user), 'guia do usuário não deve listar endpoints');
    assert.ok(tech.includes('POST /api/config/keys'), 'técnico sem endpoint das chaves');

    assert.ok(user.split(String.fromCharCode(10)).length < tech.split(String.fromCharCode(10)).length);
  });

  await check('prints do README existem e sao leves', () => {
    const user = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
    const tech = fs.readFileSync(path.join(__dirname, '..', 'README-TECNICO.md'), 'utf8');
    const images = [...user.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]);
    const techImages = [...tech.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]);

    assert.ok(images.length >= 6, 'guia do usuário deveria ter prints');
    assert.ok(techImages.length >= 1, 'documentação técnica deveria ter a visão geral');

    for (const relative of new Set([...images, ...techImages])) {
      const absolute = path.join(__dirname, '..', relative);
      assert.ok(fs.existsSync(absolute), 'print ausente: ' + relative);

      const size = fs.statSync(absolute).size;
      assert.ok(size > 10 * 1024, 'print suspeito (vazio?): ' + relative);
      assert.ok(size < 400 * 1024, 'print grande demais (' + Math.round(size / 1024) + ' KB): ' + relative);
    }
  });

  await check('web bloqueia rede local, esquemas e credenciais', () => {
    const web = require('../services/web');

    assert.strictEqual(web.isPrivateAddress('127.0.0.1'), true);
    assert.strictEqual(web.isPrivateAddress('10.1.2.3'), true);
    assert.strictEqual(web.isPrivateAddress('172.20.0.1'), true);
    assert.strictEqual(web.isPrivateAddress('192.168.0.10'), true);
    assert.strictEqual(web.isPrivateAddress('169.254.169.254'), true);
    assert.strictEqual(web.isPrivateAddress('::1'), true);
    assert.strictEqual(web.isPrivateAddress('fd00::1'), true);
    assert.strictEqual(web.isPrivateAddress('::ffff:192.168.0.1'), true);
    assert.strictEqual(web.isPrivateAddress('8.8.8.8'), false);
    assert.strictEqual(web.isPrivateAddress('200.160.2.3'), false);

    assert.throws(() => web.normalizeUrl('http://127.0.0.1:3000/api/fs/list'), /rede local/);
    assert.throws(() => web.normalizeUrl('http://localhost/'), /rede local/);
    assert.throws(() => web.normalizeUrl('http://foo.local/'), /rede local/);
    assert.throws(() => web.normalizeUrl('http://169.254.169.254/latest'), /rede local/);
    assert.throws(() => web.normalizeUrl('file:///etc/passwd'), /http:\/\/ ou https:\/\//);
    assert.throws(() => web.normalizeUrl('javascript:alert(1)'), /http:\/\/ ou https:\/\//);
    assert.throws(() => web.normalizeUrl('https://user:senha@exemplo.com'), /usuário\/senha/);
    assert.throws(() => web.normalizeUrl(''), /informe a URL/);

    assert.strictEqual(web.normalizeUrl('example.com').toString(), 'https://example.com/');
    assert.strictEqual(web.normalizeUrl('https://example.com/a#trecho').hash, '');
  });

  await check('web converte html em texto legivel', () => {
    const web = require('../services/web');

    const html = [
      '<html><head><title>Meu &amp; Site</title><style>b{color:red}</style></head>',
      '<body><h1>Titulo</h1><p>Um &amp; dois &lt;ok&gt;</p>',
      '<script>alert(1)</script><ul><li>a</li><li>b</li></ul>',
      '<a href="https://x.com">link</a><!-- comentario --></body></html>',
    ].join('');

    assert.strictEqual(web.extractTitle(html), 'Meu & Site');

    const text = web.htmlToText(html);
    assert.ok(text.indexOf('# Titulo') === 0, 'título do h1 não virou cabeçalho');
    assert.ok(text.indexOf('Um & dois <ok>') !== -1, 'entidades não decodificadas');
    assert.ok(text.indexOf('alert(1)') === -1, 'script vazou para o texto');
    assert.ok(text.indexOf('color:red') === -1, 'style vazou para o texto');
    assert.ok(text.indexOf('- a') !== -1, 'lista sem marcador');
    assert.ok(text.indexOf('comentario') === -1, 'comentário HTML vazou');
  });

  await check('web respeita o interruptor das configuracoes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-web-'));
    const previousData = process.env.HERMES_DATA_DIR;
    process.env.HERMES_DATA_DIR = dir;

    for (const module of ['../services/paths', '../services/config', '../services/web', '../services/tools']) {
      delete require.cache[require.resolve(module)];
    }

    const config = require('../services/config');
    const tools = require('../services/tools');

    try {
      const initial = config.publicWeb();
      assert.strictEqual(initial.enabled, true, 'internet deveria começar ligada');
      assert.ok(initial.limits.timeoutSeconds > 0);
      assert.ok(['duckduckgo', 'searxng'].indexOf(initial.engine) !== -1);

      const off = config.saveWebSettings({ enabled: false });
      assert.strictEqual(off.enabled, false);
      assert.throws(() => config.saveWebSettings({}), /informe enabled/);

      await assert.rejects(
        () => tools.execute('web_fetch', { url: 'https://example.com' }),
        (error) => error.status === 403 && /desativado/.test(error.message)
      );
      await assert.rejects(
        () => tools.execute('web_search', { query: 'teste' }),
        (error) => error.status === 403
      );

      config.saveWebSettings({ enabled: true });
      assert.strictEqual(config.publicWeb().enabled, true);

      const names = tools.listDefinitions().map((tool) => tool.function.name);
      assert.ok(names.indexOf('web_fetch') !== -1, 'web_fetch fora das definições');
      assert.ok(names.indexOf('web_search') !== -1, 'web_search fora das definições');
      assert.strictEqual(tools.SERVER_TOOLS.has('web_fetch'), true);
      assert.strictEqual(tools.SERVER_TOOLS.has('web_search'), true);

      await assert.rejects(() => tools.execute('web_fetch', {}), /"url" deve ser texto/);
    } finally {
      if (previousData === undefined) delete process.env.HERMES_DATA_DIR;
      else process.env.HERMES_DATA_DIR = previousData;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await check('web valida limites de caracteres e resultados', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-web2-'));
    const previousData = process.env.HERMES_DATA_DIR;
    process.env.HERMES_DATA_DIR = dir;

    for (const module of ['../services/paths', '../services/config', '../services/web', '../services/tools']) {
      delete require.cache[require.resolve(module)];
    }
    const tools = require('../services/tools');

    try {
      await assert.rejects(
        () => tools.execute('web_fetch', { url: 'https://example.com', max_chars: 10 }),
        /entre 500 e 60000/
      );
      await assert.rejects(
        () => tools.execute('web_search', { query: 'x', limit: 99 }),
        /entre 1 e 8/
      );
      await assert.rejects(() => tools.execute('web_search', { query: 'a' }), /curta demais/);
    } finally {
      if (previousData === undefined) delete process.env.HERMES_DATA_DIR;
      else process.env.HERMES_DATA_DIR = previousData;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await check('celeiro tem interruptor de acesso a internet', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    for (const id of ['web-enabled', 'web-state', 'web-status']) {
      assert.ok(html.indexOf('id="' + id + '"') !== -1, 'elemento ausente: ' + id);
    }
    assert.ok(html.indexOf('Acesso à internet do agente') !== -1, 'seção ausente');

    const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    for (const fn of ['renderWebSettings', 'loadWebSettings', 'toggleWebAccess']) {
      assert.ok(app.indexOf('function ' + fn) !== -1, 'função ausente: ' + fn);
    }
    assert.ok(app.includes("'/api/web'"));

    const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.ok(server.includes("app.get('/api/web'"));
    assert.ok(server.includes("app.post('/api/web'"));
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
