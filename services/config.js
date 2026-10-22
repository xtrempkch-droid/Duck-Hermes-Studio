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

function publicConfig() {
  return {
    github: publicGithub(),
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
  publicConfig,
  publicGithub,
  saveGithub,
  clearToken,
  verifyToken,
  gitAuthEnv,
  commitIdentity,
  tokenForGit,
  CONFIG_FILE,
};
