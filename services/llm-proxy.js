'use strict';

const { fetch: fetchUrl } = require('./http-client');

const PROVIDERS = {
  deepseek: {
    name: 'DeepSeek (API)',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-flash',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
  },
  ollama: {
    name: 'Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: 'qwen2.5-coder:7b',
  },
  'deep-rock-local': {
    name: 'Deep Rock IA (local)',
    baseUrl: 'http://127.0.0.1:8080/v1',
    defaultModel: 'default',
  },
  'llamacpp-local': {
    name: 'llama.cpp (local)',
    baseUrl: 'http://127.0.0.1:8081/v1',
    defaultModel: 'default',
  },
  'lm-studio': {
    name: 'LM Studio',
    baseUrl: 'http://127.0.0.1:1234/v1',
    defaultModel: 'default',
  },
  'docker-test': {
    name: 'Docker (teste)',
    baseUrl: (process.env.HERMES_DOCKER_LLM_URL || 'http://127.0.0.1:8090/v1').replace(/\/$/, ''),
    defaultModel: process.env.HERMES_DOCKER_LLM_MODEL || 'docker-test',
  },
};

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function proxyChat({ provider, model, messages, stream = false, baseUrl }) {
  const known = PROVIDERS[provider];
  const config = known || (baseUrl
    ? { name: provider, baseUrl, defaultModel: model || 'default' }
    : null);

  if (!config) {
    throw httpError(`Provedor desconhecido: ${provider}`, 400);
  }

  const headers = { 'Content-Type': 'application/json' };

  if (config.apiKeyEnv) {
    const apiKey = process.env[config.apiKeyEnv];
    if (!apiKey) {
      throw httpError(`chave não configurada (${config.apiKeyEnv})`, 400);
    }
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetchUrl(`${(baseUrl || config.baseUrl).replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: model || config.defaultModel,
      messages,
      stream: Boolean(stream),
    }),
    timeout: 180000,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw httpError(`Provedor ${config.name} respondeu HTTP ${response.status}: ${body.slice(0, 300)}`, 502);
  }

  return response;
}

module.exports = { PROVIDERS, proxyChat };
