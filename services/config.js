'use strict';

const fs = require('fs');
const path = require('path');

const { dataDir } = require('./paths');
const { fetch: fetchUrl } = require('./http-client');

const CONFIG_FILE = () => path.join(dataDir(), 'config.json');
const GITHUB_API = (process.env.HERMES_GITHUB_API || 'https://api.github.com').replace(/\/$/, '');
const VERIFY_TIMEOUT_MS = 12000;

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function readRaw() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
}

function writeRaw(config) {
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = CONFIG_FILE();
  fs.writeFileSync(file, JSON.stringify(config, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch (error) {
    /* Windows ignora chmod; o arquivo fica só no perfil do usuário */
  }
  return file;
}

function githubRaw() {
  const config = readRaw();
  return config.github && typeof config.github === 'object' ? config.github : {};
}

function maskToken(token) {
  if (typeof token !== 'string' || token.length < 8) return token ? '••••' : null;
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

function publicGithub() {
  const github = githubRaw();
  return {
    configured: Boolean(github.token),
    login: github.login || null,
    name: github.name || null,
    email: github.email || null,
    hasToken: Boolean(github.token),
    tokenHint: maskToken(github.token),
    verifiedAt: github.verifiedAt || null,
    api: GITHUB_API,
  };
}

/* ---------- chaves de API dos provedores de nuvem ---------- */

const KEY_PROVIDERS = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    env: 'DEEPSEEK_API_KEY',
    docs: 'https://platform.deepseek.com/api_keys',
    prefix: 'sk-',
    hint: 'Modelos DeepSeek na nuvem (deepseek-flash).',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    env: 'OPENROUTER_API_KEY',
    docs: 'https://openrouter.ai/keys',
    prefix: 'sk-or-',
    hint: 'Vários modelos de terceiros por uma única chave.',
  },
  {
    id: 'gemini',
    name: 'Gemini (Google)',
    env: 'GEMINI_API_KEY',
    docs: 'https://aistudio.google.com/app/apikey',
    prefix: 'AIza',
    hint: 'Modelos Gemini do Google AI Studio.',
  },
];

/** env aplicado por esta sessão: id → { env, previous } para poder desfazer. */
const appliedEnv = new Map();

function keyProvider(id) {
  const provider = KEY_PROVIDERS.find((item) => item.id === id);
  if (!provider) throw httpError('provedor de chave desconhecido: ' + id, 404);
  return provider;
}

function keysRaw() {
  const config = readRaw();
  return config.keys && typeof config.keys === 'object' ? config.keys : {};
}

function storedKey(id) {
  const entry = keysRaw()[id];
  if (!entry) return null;
  if (typeof entry === 'string') return entry || null;
  return typeof entry.value === 'string' && entry.value ? entry.value : null;
}

/** Normaliza a colagem: tira espaços, aspas, prefixo Bearer e quebras de linha. */
function normalizeApiKey(rawValue) {
  if (typeof rawValue !== 'string') throw httpError('cole a chave como texto', 400);

  let value = rawValue.trim().replace(/\r?\n+/g, '');
  value = value.replace(/^Bearer\s+/i, '');
  value = value.replace(/^["']|["']$/g, '').trim();

  if (!value) throw httpError('cole a chave antes de salvar', 400);
  if (/\s/.test(value)) throw httpError('a chave não pode ter espaços no meio', 400);
  if (value.length < 16) throw httpError('chave curta demais — confira se copiou completa', 400);
  if (value.length > 400) throw httpError('chave longa demais (máximo 400 caracteres)', 400);

  return value;
}

function applyEnvFor(provider, value) {
  if (!appliedEnv.has(provider.id)) {
    appliedEnv.set(provider.id, { env: provider.env, previous: process.env[provider.env] });
  }
  process.env[provider.env] = value;
}

/**
 * No boot, as chaves salvas pelo app entram em process.env para que a detecção,
 * o proxy e o relay as vejam. Uma chave salva tem prioridade sobre o .env —
 * remover volta para o valor do ambiente, se existir.
 */
function applyStoredKeys() {
  const applied = [];

  for (const provider of KEY_PROVIDERS) {
    const value = storedKey(provider.id);
    if (!value) continue;
    applyEnvFor(provider, value);
    applied.push(provider.id);
  }

  return applied;
}

function publicKeys() {
  const stored = keysRaw();

  return KEY_PROVIDERS.map((provider) => {
    const fromApp = Boolean(storedKey(provider.id));
    const fromEnv = !fromApp && Boolean(process.env[provider.env]);
    const value = fromApp ? storedKey(provider.id) : fromEnv ? process.env[provider.env] : null;

    return {
      id: provider.id,
      name: provider.name,
      env: provider.env,
      docs: provider.docs,
      hint: provider.hint,
      configured: Boolean(value),
      source: fromApp ? 'app' : fromEnv ? 'ambiente' : null,
      hintValue: maskToken(value),
      canRemove: fromApp,
      savedAt: fromApp && stored[provider.id] && stored[provider.id].savedAt
        ? stored[provider.id].savedAt
        : null,
    };
  });
}

function saveApiKey(id, rawValue) {
  const provider = keyProvider(id);
  const value = normalizeApiKey(rawValue);
  const config = readRaw();

  config.keys = Object.assign({}, config.keys);
  config.keys[provider.id] = { value, savedAt: new Date().toISOString() };
  config.updatedAt = new Date().toISOString();

  writeRaw(config);
  applyEnvFor(provider, value);

  return publicConfig();
}

function removeApiKey(id) {
  const provider = keyProvider(id);
  const config = readRaw();

  if (config.keys && config.keys[provider.id]) {
    delete config.keys[provider.id];
    if (Object.keys(config.keys).length === 0) delete config.keys;
  }

  config.updatedAt = new Date().toISOString();
  writeRaw(config);

  const applied = appliedEnv.get(provider.id);
  if (applied) {
    if (applied.previous === undefined) delete process.env[provider.env];
    else process.env[provider.env] = applied.previous;
    appliedEnv.delete(provider.id);
  }

  return publicConfig();
}

/* ---------- acesso do agente à internet ---------- */

function publicWeb() {
  const config = readRaw();
  const web = config.web && typeof config.web === 'object' ? config.web : {};
  const searchUrl = process.env.HERMES_SEARCH_URL || null;

  return {
    enabled: web.enabled !== false,
    engine: searchUrl ? 'searxng' : 'duckduckgo',
    searchUrl,
    limits: {
      maxBytes: 2 * 1024 * 1024,
      maxChars: 20000,
      timeoutSeconds: 15,
      maxResults: 8,
    },
  };
}

function saveWebSettings(input) {
  const payload = input || {};
  const config = readRaw();

  if (payload.enabled === undefined) {
    throw httpError('informe enabled (true/false)', 400);
  }

  config.web = { enabled: payload.enabled === true, updatedAt: new Date().toISOString() };
  config.updatedAt = new Date().toISOString();
  writeRaw(config);

  return publicWeb();
}

function publicConfig() {
  return {
    github: publicGithub(),
    keys: publicKeys(),
    web: publicWeb(),
    file: CONFIG_FILE(),
    plaintext: true,
  };
}

function tokenForGit() {
  const github = githubRaw();
  return typeof github.token === 'string' && github.token ? github.token : null;
}

/**
 * Autor do commit: usa o que estiver configurado; se não houver, deixa o git
 * resolver pelo config global (comportamento anterior).
 */
function commitIdentity() {
  const github = githubRaw();
  const name = (github.name || github.login || '').trim();
  const email = (github.email || '').trim();
  if (!name || !email) return null;
  return { name, email };
}

async function verifyToken(token) {
  let response;
  try {
    response = await fetchUrl(`${GITHUB_API}/user`, {
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'duck-hermes-studio',
      },
      timeout: VERIFY_TIMEOUT_MS,
    });
  } catch (error) {
    throw httpError('não foi possível falar com o GitHub: ' + error.message, 502);
  }

  if (response.status === 401) {
    throw httpError('token recusado pelo GitHub (401). Confira se foi copiado completo e não expirou.', 401);
  }
  if (response.status === 403) {
    throw httpError('GitHub recusou o token (403). Verifique os escopos do token.', 403);
  }
  if (!response.ok) {
    throw httpError(`GitHub respondeu HTTP ${response.status} ao validar o token`, 502);
  }

  const data = await response.json().catch(() => ({}));
  return {
    login: data.login || null,
    name: typeof data.name === 'string' ? data.name : null,
    email: typeof data.email === 'string' ? data.email : null,
  };
}

async function saveGithub(input) {
  const payload = input || {};
  const config = readRaw();
  const github = Object.assign({}, githubRaw());

  if (typeof payload.token === 'string' && payload.token.trim()) {
    const token = payload.token.trim();
    if (token.length < 20) throw httpError('token curto demais para ser válido', 400);

    const verified = await verifyToken(token);
    github.token = token;
    github.login = verified.login || github.login || null;
    github.verifiedAt = new Date().toISOString();

    if (typeof payload.name !== 'string' && verified.name) github.name = verified.name;
    if (typeof payload.email !== 'string' && verified.email) github.email = verified.email;
  }

  if (payload.name !== undefined) {
    github.name = typeof payload.name === 'string' ? payload.name.trim() || null : null;
  }
  if (payload.email !== undefined) {
    const email = typeof payload.email === 'string' ? payload.email.trim() : '';
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw httpError('e-mail inválido', 400);
    }
    github.email = email || null;
  }

  if (!github.token && !github.name && !github.email) {
    delete config.github;
  } else {
    config.github = github;
  }
  config.updatedAt = new Date().toISOString();

  writeRaw(config);
  return publicConfig();
}

function clearToken() {
  const config = readRaw();
  if (config.github) {
    delete config.github.token;
    delete config.github.tokenHint;
    delete config.github.verifiedAt;
    if (!config.github.name && !config.github.email) delete config.github;
  }
  config.updatedAt = new Date().toISOString();
  writeRaw(config);
  return publicConfig();
}

/** Credencial para git via HTTPS sem gravar nada no .git/config do projeto. */
function gitAuthEnv() {
  const token = tokenForGit();
  if (!token) return {};

  const basic = Buffer.from('x-access-token:' + token, 'utf8').toString('base64');
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.extraHeader',
    GIT_CONFIG_VALUE_0: 'Authorization: Basic ' + basic,
  };
}

module.exports = {
  KEY_PROVIDERS,
  publicWeb,
  saveWebSettings,
  publicConfig,
  publicKeys,
  saveApiKey,
  removeApiKey,
  applyStoredKeys,
  normalizeApiKey,
  storedKey,
  keyProvider,
  publicGithub,
  saveGithub,
  clearToken,
  verifyToken,
  gitAuthEnv,
  commitIdentity,
  tokenForGit,
  CONFIG_FILE,
};
