'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const express = require('express');

const { detectProviders } = require('./services/detect-providers');
const { proxyChat } = require('./services/llm-proxy');
const { fetch: fetchUrl } = require('./services/http-client');
const fileStore = require('./services/file-store');

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
    return fs.existsSync(path.join(docsetDir(slug), 'index.json'));
  } catch (error) {
    return false;
  }
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

app.get('/api/farm', async (req, res) => {
  try {
    res.json(await detectProviders());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/llm', async (req, res) => {
  const {
    provider = 'demo',
    model,
    messages,
    stream = false,
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
    upstream = await proxyChat({ provider, model, messages, stream });
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
    const content = data?.choices?.[0]?.message?.content ?? '';
    res.json({ provider, model: model || null, content });
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

app.get('/api/devdocs/available', async (req, res) => {
  try {
    const response = await fetchUrl(DEVDOCS_MANIFEST_URL, { timeout: 15000 });
    if (!response.ok) {
      throw new Error(`DevDocs respondeu HTTP ${response.status}`);
    }

    const manifest = await response.json();
    const docsets = (Array.isArray(manifest) ? manifest : [])
      .filter((doc) => isValidSlug(doc.slug))
      .map((doc) => ({
        slug: doc.slug,
        name: doc.name,
        version: doc.version || '',
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
    const index = JSON.parse(await fsp.readFile(indexPath, 'utf8'));
    const entries = Array.isArray(index) ? index : index.entries || [];
    const results = entries
      .filter((entry) => typeof entry.name === 'string' && entry.name.toLowerCase().includes(query))
      .slice(0, 50)
      .map((entry) => ({ name: entry.name, path: entry.path }));

    res.json({ results });
  } catch (error) {
    res.status(500).json({ results: [], error: `Falha ao ler docset: ${error.message}` });
  }
});

app.listen(PORT, () => {
  console.log(`Duck Hermes Studio rodando em http://localhost:${PORT}`);
});
