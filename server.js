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
const git = require('./services/git');
const config = require('./services/config');
const paths = require('./services/paths');
const aiTalk = require('./services/ai-talk');
const relay = require('./services/relay');
const localGuard = require('./services/local-guard');
const sandbox = require('./services/sandbox');
const activity = require('./services/activity-log');
const editorContext = require('./services/editor-context');
const lsp = require('./services/lsp');
const plugins = require('./services/plugins');
const agentLoop = require('./services/agent-loop');

/**
 * Ordem: HERMES_ENV_FILE → .env da pasta atual → .env ao lado do servidor.
 * O `.env` nunca é embutido no binário; chaves continuam externas.
 */
function envCandidates() {
  const candidates = [];
  if (process.env.HERMES_ENV_FILE) candidates.push(path.resolve(process.env.HERMES_ENV_FILE));
  candidates.push(path.join(process.cwd(), '.env'));

  const mainDir = path.dirname(require.main ? require.main.filename : __filename);
  candidates.push(path.join(mainDir, '.env'));

  return candidates.filter((candidate, index) => candidates.indexOf(candidate) === index);
}

function loadEnv() {
  let content = null;

  for (const envPath of envCandidates()) {
    try {
      content = fs.readFileSync(envPath, 'utf8');
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn(`Não foi possível ler ${envPath}: ${error.message}`);
      }
    }
  }

  if (content === null) return;

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

// chaves coladas no Celeiro (data/config.json) entram no ambiente do processo
const appliedFromConfig = config.applyStoredKeys();
if (appliedFromConfig.length > 0) {
  console.log(`Chaves de API carregadas do app: ${appliedFromConfig.join(', ')}`);
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;
/** Só local por padrão: os endpoints leem/gravam arquivos e executam comandos. */
const HOST = process.env.HERMES_HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const { dataDir } = require('./services/paths');
const DEVDOCS_DIR = path.join(dataDir(), 'devdocs');
const DEVDOCS_MANIFEST_URL = 'https://devdocs.io/docs.json';
const DEVDOCS_FILES_URL = 'https://documents.devdocs.io';
const DEMO_MESSAGE = 'Nenhum provedor de IA disponível. Configure um em ⚙️ → Celeiro de IAs.';

app.disable('x-powered-by');

/**
 * Cabeçalhos de base para todas as respostas. O CSP é deliberadamente curto:
 * o visualizador roda código do usuário num iframe sandbox, então restringir
 * `script-src`/`connect-src` quebraria o produto. O que sobra são travas que
 * não custam funcionalidade: enquadramento, `<base>`, plugins e sniffing.
 */
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors 'self'; base-uri 'self'; object-src 'none'"
  );
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

// DNS rebinding: um domínio externo que resolve para 127.0.0.1 chega com Host estranho.
app.use((req, res, next) => {
  if (localGuard.hostAllowed(req.headers.host, process.env)) {
    next();
    return;
  }
  res.status(403).json({
    error: 'Host não permitido: acesse por http://127.0.0.1 ou http://localhost',
  });
});

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

  if (relay.isRelay(provider)) {
    try {
      const data = await relay.chat({
        provider,
        model,
        messages,
        tools: requestTools,
        toolChoice,
      });

      if (stream) {
        sendSseText(res, data.content || '');
        return;
      }

      res.json({
        provider: data.provider,
        model: data.model,
        content: data.content,
        toolCalls: data.toolCalls,
        finishReason: data.finishReason,
        relay: true,
      });
      return;
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

app.get('/api/workspace', (req, res) => {
  res.json(paths.workspaceInfo());
});

app.get('/api/workspace/browse', (req, res) => {
  try {
    res.json(paths.browse(req.query.path));
  } catch (error) {
    handleFsError(res, error, 'Falha ao listar pastas');
  }
});

app.post('/api/workspace', (req, res) => {
  try {
    res.json(paths.setWorkspace((req.body || {}).path, { persist: (req.body || {}).persist !== false }));
  } catch (error) {
    handleFsError(res, error, 'Falha ao abrir a pasta');
  }
});

app.delete('/api/workspace', (req, res) => {
  res.json(paths.resetWorkspace());
});

app.get('/api/config', (req, res) => {
  res.json(config.publicConfig());
});

app.post('/api/config/github', async (req, res) => {
  try {
    res.json(await config.saveGithub(req.body || {}));
  } catch (error) {
    handleFsError(res, error, 'Falha ao salvar a conta do GitHub');
  }
});

app.delete('/api/config/github/token', (req, res) => {
  res.json(config.clearToken());
});

app.get('/api/web', (req, res) => {
  res.json(config.publicWeb());
});

app.post('/api/web', (req, res) => {
  try {
    res.json(config.saveWebSettings(req.body || {}));
  } catch (error) {
    handleFsError(res, error, 'Falha ao salvar a configuração de internet');
  }
});

app.get('/api/config/keys', (req, res) => {
  res.json({ keys: config.publicKeys(), file: config.publicConfig().file });
});

app.post('/api/config/keys', (req, res) => {
  const body = req.body || {};
  try {
    const data = config.saveApiKey(body.id, body.key);
    invalidateCache();
    res.json(data);
  } catch (error) {
    handleFsError(res, error, 'Falha ao salvar a chave');
  }
});

app.delete('/api/config/keys/:id', (req, res) => {
  try {
    const data = config.removeApiKey(req.params.id);
    invalidateCache();
    res.json(data);
  } catch (error) {
    handleFsError(res, error, 'Falha ao remover a chave');
  }
});

app.get('/api/git/remotes', async (req, res) => {
  try {
    res.json(await git.remotes());
  } catch (error) {
    handleFsError(res, error, 'Falha ao ler os remotes');
  }
});

app.post('/api/git/remote', async (req, res) => {
  try {
    res.json(await git.setRemote(req.body || {}));
  } catch (error) {
    handleFsError(res, error, 'Falha ao configurar o remote');
  }
});

app.post('/api/git/fetch', async (req, res) => {
  try {
    res.json(await git.fetchRemote(req.body || {}));
  } catch (error) {
    handleFsError(res, error, 'Falha ao buscar as novidades');
  }
});

app.post('/api/git/pull', async (req, res) => {
  try {
    res.json(await git.pullRemote(req.body || {}));
  } catch (error) {
    handleFsError(res, error, 'Falha ao atualizar');
  }
});

app.post('/api/git/push', async (req, res) => {
  try {
    res.json(await git.pushRemote(req.body || {}));
  } catch (error) {
    handleFsError(res, error, 'Falha ao enviar');
  }
});

app.get('/api/fs/info', (req, res) => {
  res.json(fileStore.workspaceInfo());
});

app.get('/api/fs/list', async (req, res) => {
  try {
    res.json(
      await fileStore.listDirectory(req.query.path, { hideIgnored: req.query.ignored === 'hide' })
    );
  } catch (error) {
    handleFsError(res, error, 'Falha ao listar diretório');
  }
});

app.get('/api/fs/raw', async (req, res) => {
  try {
    const info = await fileStore.readRaw(req.query.path);
    res.type(info.mime);
    for (const [name, value] of Object.entries(fileStore.rawHeaders(info.mime))) {
      res.setHeader(name, value);
    }
    res.setHeader('Content-Disposition', 'inline; filename="' + path.basename(info.absolutePath) + '"');
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(info.absolutePath);
  } catch (error) {
    handleFsError(res, error, 'Falha ao abrir o arquivo');
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

  let before = '';
  try {
    before = (await fileStore.readFile(targetPath)).content;
  } catch (error) {
    before = '';
  }

  try {
    const written = await fileStore.writeFile(targetPath, content);
    activity.log.record({
      filePath: written.path,
      author: 'USER',
      action: 'write_file',
      delta: { before, after: String(content) },
      metadata: { created: written.created, bytes: written.bytes },
    });
    activity.log.hints.clearFile(written.path);
    res.json(written);
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
    serverTools: tools.serverToolNames(),
    clientTools: [...tools.CLIENT_TOOLS],
    dynamicTools: tools.listDynamicTools(),
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

/* ---------- sandbox Docker ---------- */

app.get('/api/sandbox', async (req, res) => {
  try {
    const docker = await sandbox.status({ refresh: req.query.refresh === '1' });
    res.json({
      ...docker,
      defaultImage: sandbox.DEFAULT_IMAGE,
      defaults: sandbox.DEFAULTS,
      modes: ['local', 'sandbox'],
      note: 'sandbox = container descartável sem rede/capabilities; local = seu usuário, sem isolamento',
    });
  } catch (error) {
    handleFsError(res, error, 'Falha ao consultar o Docker');
  }
});

app.post('/api/sandbox/preview', (req, res) => {
  try {
    const { argv } = sandbox.buildArgv({
      image: (req.body || {}).image,
      command: (req.body || {}).command || 'echo ok',
      workspaceDir: fileStore.workspaceRoot(),
      network: (req.body || {}).network,
    });
    res.json({ argv });
  } catch (error) {
    handleFsError(res, error, 'Falha ao montar o comando do sandbox');
  }
});

/* ---------- log de execução e diagnósticos ---------- */

app.get('/api/activity', (req, res) => {
  res.json({
    entries: activity.log.entries({ limit: req.query.limit, filePath: req.query.path }),
    runs: activity.log.runs({ limit: req.query.runs }),
    hints: activity.log.hints.all(),
  });
});

app.post('/api/activity/hints/clear', (req, res) => {
  const body = req.body || {};
  if (typeof body.path === 'string' && body.path) {
    res.json({ removed: activity.log.hints.clearFile(body.path) });
    return;
  }
  if (typeof body.source === 'string' && body.source) {
    res.json({ removed: activity.log.hints.clearSource(body.source) });
    return;
  }
  activity.log.hints.clear();
  res.json({ removed: 'all' });
});

/* ---------- contexto do editor ---------- */

app.get('/api/editor/context', (req, res) => {
  res.json(editorContext.store.get());
});

app.post('/api/editor/context', (req, res) => {
  try {
    res.json(editorContext.store.update(req.body || {}));
  } catch (error) {
    handleFsError(res, error, 'Falha ao atualizar o contexto do editor');
  }
});

/* ---------- language servers (LSP) ---------- */

app.get('/api/lsp', (req, res) => {
  res.json({ servers: lsp.getManager().listServers() });
});

app.post('/api/lsp/refresh', async (req, res) => {
  try {
    const body = req.body || {};
    res.json(await lsp.getManager().refresh(body.path, { waitMs: body.waitMs }));
  } catch (error) {
    handleFsError(res, error, 'Falha ao consultar o language server');
  }
});

app.get('/api/lsp/diagnostics', (req, res) => {
  const filePath = typeof req.query.path === 'string' ? req.query.path : null;
  res.json({
    diagnostics: filePath ? activity.log.hints.getForFile(filePath) : activity.log.hints.all(),
  });
});

app.post('/api/lsp/dispose', (req, res) => {
  lsp.resetManager();
  res.json({ ok: true });
});

/* ---------- plugins ---------- */

app.get('/api/plugins', (req, res) => {
  res.json({ plugins: plugins.manager.list(), dirs: plugins.pluginDirs(), entry: plugins.ENTRY_EXTENSION });
});

app.post('/api/plugins/load', async (req, res) => {
  const body = req.body || {};
  try {
    const target = body.file || findPluginFile(body.id);
    if (!target) {
      handleFsError(res, Object.assign(new Error('plugin não encontrado'), { status: 404 }), 'Plugin não encontrado');
      return;
    }
    res.json(await plugins.manager.load(target));
  } catch (error) {
    handleFsError(res, error, 'Falha ao carregar o plugin');
  }
});

app.post('/api/plugins/unload', async (req, res) => {
  try {
    res.json(await plugins.manager.unload((req.body || {}).id));
  } catch (error) {
    handleFsError(res, error, 'Falha ao descarregar o plugin');
  }
});

/** Resolve um id descoberto (sem confiar em caminho vindo do cliente). */
function findPluginFile(id) {
  if (typeof id !== 'string' || !id) return null;
  const found = plugins.discover().find((item) => item.id === id);
  return found ? found.file : null;
}

/* ---------- loop do agente no servidor ---------- */

app.post('/api/agent/run', async (req, res) => {
  const body = req.body || {};

  try {
    const complete = agentLoop.makeCompleter({
      provider: body.provider,
      model: body.model,
      baseUrl: body.baseUrl,
      timeout: body.timeout,
    });

    const definitions = tools
      .listDefinitions()
      .filter((definition) => {
        const name = (definition.function || definition).name;
        return !tools.CLIENT_TOOLS.has(name) && name !== 'delegate';
      });

    const agentTools = agentLoop.toolsFromDefinitions(definitions, (name, args) =>
      tools.execute(name, args)
    );

    const events = [];
    const result = await agentLoop.runAgentTurn({
      prompt: body.prompt,
      tools: agentTools,
      complete,
      mode: body.mode,
      maxSteps: body.maxSteps,
      history: body.history,
      onProgress: (event) => events.push(event),
    });

    res.json({ ...result, events, provider: body.provider || 'ollama', model: body.model || null });
  } catch (error) {
    handleFsError(res, error, 'Falha ao executar o agente');
  }
});

app.get('/api/git/status', async (req, res) => {
  try {
    res.json(await git.status());
  } catch (error) {
    handleFsError(res, error, 'Falha ao ler o status do Git');
  }
});

app.post('/api/git/diff', async (req, res) => {
  try {
    res.json(await git.fileDiff(req.body || {}));
  } catch (error) {
    handleFsError(res, error, 'Falha ao gerar o diff do Git');
  }
});

app.get('/api/git/log', async (req, res) => {
  try {
    res.json(await git.log({ limit: req.query.limit }));
  } catch (error) {
    handleFsError(res, error, 'Falha ao ler o histórico do Git');
  }
});

app.post('/api/git/stage', async (req, res) => {
  try {
    res.json(await git.stage((req.body || {}).files));
  } catch (error) {
    handleFsError(res, error, 'Falha ao preparar os arquivos');
  }
});

app.post('/api/git/unstage', async (req, res) => {
  try {
    res.json(await git.unstage((req.body || {}).files));
  } catch (error) {
    handleFsError(res, error, 'Falha ao desfazer o stage');
  }
});

app.post('/api/git/discard', async (req, res) => {
  try {
    res.json(await git.discard((req.body || {}).files));
  } catch (error) {
    handleFsError(res, error, 'Falha ao descartar as alterações');
  }
});

app.post('/api/git/commit', async (req, res) => {
  try {
    res.json(await git.commit(req.body || {}));
  } catch (error) {
    handleFsError(res, error, 'Falha ao criar o commit');
  }
});

app.get('/api/ai-talk', async (req, res) => {
  try {
    res.json(await aiTalk.status());
  } catch (error) {
    handleFsError(res, error, 'Falha ao ler o ai-talk');
  }
});

app.post('/api/ai-talk/delegate', async (req, res) => {
  try {
    res.json(await aiTalk.delegate(req.body || {}));
  } catch (error) {
    handleFsError(res, error, 'Falha ao delegar a tarefa');
  }
});

app.delete('/api/ai-talk', (req, res) => {
  res.json(aiTalk.clearTranscript());
});

app.get('/api/relay', (req, res) => {
  res.json({ relays: relay.status() });
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

// Erro não tratado em rota assíncrona: responde em JSON e não derruba o processo.
app.use((error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  const status = error.status || 500;
  res.status(status).json({ error: status === 500 ? 'Erro interno do servidor' : error.message });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Duck Hermes Studio rodando em http://localhost:${PORT}`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `A porta ${PORT} já está em uso. Feche a outra instância ou rode com PORT=<outra porta>.`
    );
    process.exit(1);
  }
  if (error.code === 'EACCES') {
    console.error(`Sem permissão para abrir a porta ${PORT}. Use uma porta acima de 1024.`);
    process.exit(1);
  }
  console.error(`Falha ao iniciar o servidor: ${error.message}`);
  process.exit(1);
});

module.exports = { app, server };
