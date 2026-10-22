'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const express = require('express');

const { detectProviders, invalidateCache } = require('./services/detect-providers');
const { proxyChat } = require('./services/llm-proxy');
const { fetch: fetchUrl } = require('./services/http-client');
const fileStore = require('./services/file-store');
const machines = require('./services/machines');
const patches = require('./services/patches');
const tools = require('./services/tools');
const agents = require('./services/agents');
const execService = require('./services/exec');

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  let content;
  try {
    content = fs.readFileSync(envPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Não foi possível ler ${envPath}: ${error.message}`);
    }
    return;
  }

  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[match[1]] === undefined) {
      process.env[match[1]] = value;
    }
  }
}

loadEnv();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DEVDOCS_DIR = path.join(__dirname, 'data', 'devdocs');
const DEVDOCS_MANIFEST_URL = 'https://devdocs.io/docs.json';
const DEVDOCS_FILES_URL = 'https://documents.devdocs.io';
const DEMO_MESSAGE = 'Nenhum provedor de IA disponível. Configure um em ⚙️ → Celeiro de IAs.';

app.use(express.json({ limit: '2mb' }));
app.use(express.static(PUBLIC_DIR));

function isValidSlug(slug) {
  return typeof slug === 'string' && /^[a-z0-9][a-z0-9._~-]*$/i.test(slug);
}

function docsetDir(slug) {
  return path.join(DEVDOCS_DIR, slug);
}

function isDocsetDownloaded(slug) {
  try {
    return (
      fs.existsSync(path.join(docsetDir(slug), 'index.json')) &&
      fs.existsSync(path.join(docsetDir(slug), 'db.json'))
    );
  } catch (error) {
    return false;
  }
}

const docsetCache = new Map();
const DOCSET_CACHE_LIMIT = 2;

async function loadDocset(slug) {
  if (docsetCache.has(slug)) return docsetCache.get(slug);

  const dir = docsetDir(slug);
  const [index, db] = await Promise.all([
    fsp.readFile(path.join(dir, 'index.json'), 'utf8'),
    fsp.readFile(path.join(dir, 'db.json'), 'utf8'),
  ]);

  const parsed = { index: JSON.parse(index), db: JSON.parse(db) };
  docsetCache.set(slug, parsed);
  if (docsetCache.size > DOCSET_CACHE_LIMIT) {
    docsetCache.delete(docsetCache.keys().next().value);
  }
  return parsed;
}

function sendSseText(res, text) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

async function pipeSse(upstream, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const reader =
    typeof upstream.body.getReader === 'function' ? upstream.body.getReader() : upstream.body;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  } finally {
    res.end();
  }
}

app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

async function buildFarm(options) {
  const settings = options || {};
  const farm = await detectProviders({ refresh: settings.refresh, preferredProvider: settings.preferredProvider });
  const machineList = machines.listMachines();
  const machineProviders = machines.llmProvidersFromMachines(machineList);

  const probed = await Promise.all(
    machineProviders.map(async (provider) => {
      try {
        const response = await fetchUrl(`${provider.endpoint}/models`, { timeout: 800 });
        if (!response.ok) {
          return { ...provider, available: false, reason: `HTTP ${response.status}` };
        }
        const data = await response.json().catch(() => ({}));
        const list = Array.isArray(data.data) ? data.data.map((item) => item.id).filter(Boolean) : [];
        return { ...provider, available: true, models: list };
      } catch (error) {
        return { ...provider, available: false, reason: 'sem resposta na rede local' };
      }
    })
  );

  const providers = farm.providers
    .filter((provider) => provider.id !== 'demo')
    .concat(probed)
    .concat(farm.providers.filter((provider) => provider.id === 'demo'));

  const usable = providers.filter((provider) => provider.available);
  const realAvailable = usable.filter((provider) => provider.id !== 'demo').length;
  const preferred = settings.preferredProvider
    ? usable.find((provider) => provider.id === settings.preferredProvider)
    : null;

  return {
    providers,
    activeProvider: preferred ? preferred.id : usable[0] ? usable[0].id : 'demo',
    summary: {
      total: providers.length,
      available: realAvailable,
      unavailable: providers.length - realAvailable - 1,
      demo: true,
    },
    docker: farm.docker,
    machines: machineList.map((machine) => ({
      id: machine.id,
      name: machine.name,
      host: machine.host,
      port: machine.port,
      user: machine.user,
      role: machine.role,
      llmUrl: machine.llmUrl,
      llmModel: machine.llmModel,
      testCommand: machine.testCommand,
    })),
    detectedAt: farm.detectedAt,
  };
}

app.get('/api/farm', async (req, res) => {
  try {
    res.json(await buildFarm({ preferredProvider: req.query.provider }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/farm/refresh', async (req, res) => {
  try {
    invalidateCache();
    res.json(await buildFarm({ refresh: true, preferredProvider: (req.body || {}).provider }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/machines', (req, res) => {
  res.json({ machines: machines.listMachines(), defaultCommand: machines.DEFAULT_TEST_COMMAND });
});

app.post('/api/machines', async (req, res) => {
  try {
    res.status(201).json({ machine: await machines.addMachine(req.body || {}) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.delete('/api/machines/:id', async (req, res) => {
  try {
    res.json({ removed: await machines.removeMachine(req.params.id) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.post('/api/machines/:id/probe', async (req, res) => {
  try {
    res.json(await machines.probeMachine(req.params.id));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.post('/api/machines/:id/run-tests', async (req, res) => {
  try {
    res.json(await machines.runTests(req.params.id));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.get('/api/runner/history', (req, res) => {
  res.json({ runs: machines.readHistory() });
});

app.post('/api/llm', async (req, res) => {
  const {
    provider = 'demo',
    model,
    messages,
    stream = false,
    tools: requestTools,
    toolChoice,
  } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'messages deve ser uma lista não vazia' });
    return;
  }

  if (!provider || provider === 'demo') {
    if (stream) {
      sendSseText(res, DEMO_MESSAGE);
    } else {
      res.json({ provider: 'demo', model: 'demo', content: DEMO_MESSAGE });
    }
    return;
  }

  let upstream;
  try {
    let baseUrl = null;
    let fallbackModel = null;

    if (String(provider).startsWith('machine:')) {
      const machineId = String(provider).slice('machine:'.length);
      const machine = machines.getMachine(machineId);
      if (!machine || !machine.llmUrl) {
        throw Object.assign(new Error('máquina de IA não encontrada'), { status: 404 });
      }
      baseUrl = machine.llmUrl;
      fallbackModel = machine.llmModel || null;
    }

    upstream = await proxyChat({
      provider,
      model: model || fallbackModel,
      messages,
      stream,
      baseUrl,
      tools: requestTools,
      toolChoice,
    });
  } catch (error) {
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.flushHeaders();
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      res.status(error.status || 502).json({ error: error.message });
    }
    return;
  }

  if (stream) {
    try {
      await pipeSse(upstream, res);
    } catch (error) {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      }
    }
    return;
  }

  try {
    const data = await upstream.json();
    const message = data?.choices?.[0]?.message || {};
    const content = typeof message.content === 'string' ? message.content : '';
    const toolCalls = Array.isArray(message.tool_calls)
      ? message.tool_calls.map((call) => ({
          id: call.id || null,
          type: 'function',
          function: {
            name: call.function && call.function.name ? call.function.name : '',
            arguments: call.function && call.function.arguments ? call.function.arguments : '{}',
          },
        }))
      : [];

    res.json({
      provider,
      model: data?.model || model || null,
      content,
      toolCalls,
      finishReason: data?.choices?.[0]?.finish_reason || null,
    });
  } catch (error) {
    res.status(502).json({ error: `Resposta inválida do provedor: ${error.message}` });
  }
});

function handleFsError(res, error, fallback) {
  if (error.status) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  res.status(500).json({ error: fallback });
}

app.get('/api/fs/info', (req, res) => {
  res.json(fileStore.workspaceInfo());
});

app.get('/api/fs/list', async (req, res) => {
  try {
    res.json(await fileStore.listDirectory(req.query.path));
  } catch (error) {
    handleFsError(res, error, 'Falha ao listar diretório');
  }
});

app.post('/api/fs/read', async (req, res) => {
  try {
    res.json(await fileStore.readFile((req.body || {}).path));
  } catch (error) {
    handleFsError(res, error, 'Falha ao ler arquivo');
  }
});

app.post('/api/fs/write', async (req, res) => {
  const { path: targetPath, content } = req.body || {};
  try {
    res.json(await fileStore.writeFile(targetPath, content));
  } catch (error) {
    handleFsError(res, error, 'Falha ao gravar arquivo');
  }
});

app.post('/api/patch/preview', async (req, res) => {
  try {
    res.json(await patches.previewPatch(req.body || {}));
  } catch (error) {
    handleFsError(res, error, 'Falha ao gerar o diff');
  }
});

app.post('/api/patch/apply', async (req, res) => {
  try {
    res.json(await patches.applyPatch((req.body || {}).id));
  } catch (error) {
    handleFsError(res, error, 'Falha ao aplicar o patch');
  }
});

app.post('/api/patch/reject', (req, res) => {
  try {
    res.json(patches.rejectPatch((req.body || {}).id));
  } catch (error) {
    handleFsError(res, error, 'Falha ao descartar o patch');
  }
});

app.get('/api/patch/pending', (req, res) => {
  res.json({ pending: patches.pendingCount() });
});

app.get('/api/tools', (req, res) => {
  res.json({
    tools: tools.listDefinitions(),
    serverTools: [...tools.SERVER_TOOLS],
    clientTools: [...tools.CLIENT_TOOLS],
  });
});

app.post('/api/tools/execute', async (req, res) => {
  const { name, arguments: args } = req.body || {};

  try {
    res.json(await tools.execute(String(name || ''), args || {}));
  } catch (error) {
    handleFsError(res, error, 'Falha ao executar a ferramenta');
  }
});

app.get('/api/agents', async (req, res) => {
  try {
    res.json(await agents.readAgents());
  } catch (error) {
    handleFsError(res, error, 'Falha ao ler AGENTS.md');
  }
});

app.post('/api/agents', async (req, res) => {
  const { section, content } = req.body || {};

  try {
    res.json(await agents.updateSection(section, content));
  } catch (error) {
    handleFsError(res, error, 'Falha ao atualizar AGENTS.md');
  }
});

app.post('/api/agents/log', async (req, res) => {
  try {
    res.json(await agents.appendDecision((req.body || {}).summary));
  } catch (error) {
    handleFsError(res, error, 'Falha ao registrar decisão');
  }
});

app.get('/api/agents/context', async (req, res) => {
  res.json(await agents.buildContext());
});

function sendExecError(res, error, fallback) {
  if (error.payload) {
    res.status(error.status).json(error.payload);
    return;
  }
  handleFsError(res, error, fallback);
}

app.post('/api/exec', async (req, res) => {
  try {
    res.json(await execService.execute(req.body || {}));
  } catch (error) {
    sendExecError(res, error, 'Falha ao executar o comando');
  }
});

app.post('/api/exec/approve', async (req, res) => {
  try {
    res.json(await execService.approveAndRun((req.body || {}).approvalId));
  } catch (error) {
    sendExecError(res, error, 'Falha ao executar o comando aprovado');
  }
});

app.get('/api/exec/history', (req, res) => {
  res.json({ runs: execService.readHistory() });
});

app.get('/api/exec/status', (req, res) => {
  res.json(execService.status());
});

app.post('/api/exec/network', (req, res) => {
  res.json({ networkEnabled: execService.setNetworkEnabled((req.body || {}).enabled) });
});

app.get('/api/devdocs/available', async (req, res) => {
  try {
    const response = await fetchUrl(DEVDOCS_MANIFEST_URL, { timeout: 15000 });
    if (!response.ok) {
      throw new Error(`DevDocs respondeu HTTP ${response.status}`);
    }

    const manifest = await response.json();
    const filter = String(req.query.q || '').trim().toLowerCase();

    const docsets = (Array.isArray(manifest) ? manifest : [])
      .filter((doc) => isValidSlug(doc.slug))
      .filter(
        (doc) =>
          !filter ||
          String(doc.name || '').toLowerCase().includes(filter) ||
          String(doc.slug || '').toLowerCase().includes(filter)
      )
      .map((doc) => ({
        slug: doc.slug,
        name: doc.name,
        version: doc.version || '',
        size: typeof doc.db_size === 'number' ? doc.db_size : null,
        downloaded: isDocsetDownloaded(doc.slug),
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

    res.json({ docsets });
  } catch (error) {
    res.status(502).json({ error: `Falha ao carregar docsets: ${error.message}` });
  }
});

app.post('/api/devdocs/download', async (req, res) => {
  const { slug } = req.body || {};

  if (!isValidSlug(slug)) {
    res.status(400).json({ ok: false, error: 'slug inválido' });
    return;
  }

  const targetDir = docsetDir(slug);

  try {
    await fsp.mkdir(targetDir, { recursive: true });

    for (const fileName of ['index.json', 'db.json']) {
      const url = `${DEVDOCS_FILES_URL}/${encodeURIComponent(slug)}/${fileName}`;
      const response = await fetchUrl(url, { timeout: 300000 });
      if (!response.ok) {
        throw new Error(`${fileName}: HTTP ${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      await fsp.writeFile(path.join(targetDir, fileName), buffer);
    }

    res.json({ ok: true, slug });
  } catch (error) {
    res.status(502).json({ ok: false, error: `Falha ao baixar ${slug}: ${error.message}` });
  }
});

app.get('/api/devdocs/entry', async (req, res) => {
  const slug = req.query.docset;
  const entryPath = String(req.query.path || '').trim();

  if (!isValidSlug(slug)) {
    res.status(400).json({ error: 'docset inválido' });
    return;
  }

  if (!entryPath || entryPath.length > 300) {
    res.status(400).json({ error: 'path inválido' });
    return;
  }

  if (!isDocsetDownloaded(slug)) {
    res.status(404).json({ error: 'docset não baixado' });
    return;
  }

  try {
    const docset = await loadDocset(slug);
    const html = docset.db[entryPath];

    if (typeof html !== 'string') {
      res.status(404).json({ error: 'entrada não encontrada no docset' });
      return;
    }

    const entries = Array.isArray(docset.index) ? docset.index : docset.index.entries || [];
    const entry = entries.find((item) => item.path === entryPath);

    res.json({
      path: entryPath,
      name: entry && entry.name ? entry.name : entryPath,
      html,
    });
  } catch (error) {
    res.status(500).json({ error: `Falha ao ler entrada: ${error.message}` });
  }
});

app.get('/api/devdocs/search', async (req, res) => {
  const slug = req.query.docset;
  const query = String(req.query.q || '').trim().toLowerCase();

  if (!isValidSlug(slug)) {
    res.status(400).json({ results: [], error: 'docset inválido' });
    return;
  }

  if (!query) {
    res.json({ results: [] });
    return;
  }

  const indexPath = path.join(docsetDir(slug), 'index.json');
  if (!fs.existsSync(indexPath)) {
    res.status(404).json({ results: [], error: 'docset não baixado' });
    return;
  }

  try {
    const docset = await loadDocset(slug);
    const index = docset.index;
    const entries = Array.isArray(index) ? index : index.entries || [];
    const matches = entries.filter(
      (entry) => typeof entry.name === 'string' && entry.name.toLowerCase().includes(query)
    );

    matches.sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(query) ? 0 : 1;
      const bStarts = b.name.toLowerCase().startsWith(query) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return a.name.length - b.name.length || a.name.localeCompare(b.name);
    });

    const results = matches.slice(0, 50).map((entry) => ({
      name: entry.name,
      path: entry.path,
      type: entry.type || '',
    }));

    res.json({ results });
  } catch (error) {
    res.status(500).json({ results: [], error: `Falha ao ler docset: ${error.message}` });
  }
});

app.listen(PORT, () => {
  console.log(`Duck Hermes Studio rodando em http://localhost:${PORT}`);
});
