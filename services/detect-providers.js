'use strict';

const { fetch: fetchUrl } = require('./http-client');

const HEALTH_TIMEOUT_MS = 500;

const CANDIDATES = [
  {
    id: 'deep-rock-local',
    name: 'Deep Rock IA (local)',
    endpoint: 'http://127.0.0.1:8080/v1',
    healthUrl: 'http://127.0.0.1:8080/health',
    modelsUrl: 'http://127.0.0.1:8080/v1/models',
    installHint: 'Inicie o Deep Rock IA em http://127.0.0.1:8080',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    endpoint: 'http://127.0.0.1:11434/v1',
    healthUrl: 'http://127.0.0.1:11434/api/tags',
    modelsFromTags: true,
    installHint: 'Instale o Ollama e execute: ollama serve',
  },
  {
    id: 'llamacpp-local',
    name: 'llama.cpp (local)',
    endpoint: 'http://127.0.0.1:8081/v1',
    healthUrl: 'http://127.0.0.1:8081/v1/models',
    installHint: 'Inicie o llama.cpp com o servidor OpenAI em http://127.0.0.1:8081',
  },
  {
    id: 'lm-studio',
    name: 'LM Studio',
    endpoint: 'http://127.0.0.1:1234/v1',
    healthUrl: 'http://127.0.0.1:1234/v1/models',
    installHint: 'Abra o LM Studio e ative o servidor local na porta 1234',
  },
];

function unavailable(candidate, reason) {
  return {
    id: candidate.id,
    name: candidate.name,
    endpoint: candidate.endpoint,
    available: false,
    reason,
    installHint: candidate.installHint,
  };
}

async function fetchModels(candidate) {
  if (candidate.modelsFromTags) {
    const response = await fetchUrl(candidate.healthUrl, { timeout: HEALTH_TIMEOUT_MS });
    if (!response.ok) return [];
    const data = await response.json().catch(() => ({}));
    const models = Array.isArray(data.models) ? data.models : [];
    return models.map((model) => model.name || model.model).filter(Boolean);
  }

  if (!candidate.modelsUrl) return [];

  try {
    const response = await fetchUrl(candidate.modelsUrl, { timeout: HEALTH_TIMEOUT_MS });
    if (!response.ok) return [];
    const data = await response.json().catch(() => ({}));
    const models = Array.isArray(data.data) ? data.data : [];
    return models.map((model) => model.id).filter(Boolean);
  } catch (error) {
    return [];
  }
}

async function checkLocalProvider(candidate) {
  try {
    const response = await fetchUrl(candidate.healthUrl, { timeout: HEALTH_TIMEOUT_MS });
    if (!response.ok) {
      return unavailable(candidate, `respondeu HTTP ${response.status}`);
    }
    const models = await fetchModels(candidate);
    return {
      id: candidate.id,
      name: candidate.name,
      endpoint: candidate.endpoint,
      available: true,
      models,
    };
  } catch (error) {
    return unavailable(candidate, 'não respondeu em 500ms');
  }
}

function checkDeepSeek() {
  const available = Boolean(process.env.DEEPSEEK_API_KEY);
  const provider = {
    id: 'deepseek',
    name: 'DeepSeek (API)',
    endpoint: 'https://api.deepseek.com',
  };

  if (!available) {
    return {
      ...provider,
      available: false,
      reason: 'chave não configurada',
      installHint: 'Configure DEEPSEEK_API_KEY no .env',
    };
  }

  return {
    ...provider,
    available: true,
    models: ['deepseek-flash'],
  };
}

async function detectProviders() {
  const providers = await Promise.all(CANDIDATES.map(checkLocalProvider));
  providers.push(checkDeepSeek());

  const active = providers.find((provider) => provider.available);

  return {
    providers,
    activeProvider: active ? active.id : 'demo',
  };
}

module.exports = { detectProviders };
