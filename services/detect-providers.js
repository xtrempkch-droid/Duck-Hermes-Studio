'use strict';

const { execFile } = require('child_process');
const { fetch: fetchUrl } = require('./http-client');
const relay = require('./relay');

const HEALTH_TIMEOUT_MS = 500;
const DOCKER_TIMEOUT_MS = 1200;
const CACHE_TTL_MS = 10000;

const DOCKER_LLM_URL = (process.env.HERMES_DOCKER_LLM_URL || 'http://127.0.0.1:8090/v1').replace(/\/$/, '');
const DOCKER_LLM_MODEL = process.env.HERMES_DOCKER_LLM_MODEL || 'docker-test';

const CANDIDATES = [
  {
    id: 'deep-rock-local',
    name: 'Deep Rock IA (local)',
    endpoint: 'http://127.0.0.1:8080/v1',
    healthUrl: 'http://127.0.0.1:8080/health',
    modelsUrl: 'http://127.0.0.1:8080/v1/models',
    installHint: 'Inicie o Deep Rock IA em http://127.0.0.1:8080',
    setupCommand: null,
  },
  {
    id: 'ollama',
    name: 'Ollama',
    endpoint: 'http://127.0.0.1:11434/v1',
    healthUrl: 'http://127.0.0.1:11434/api/tags',
    modelsFromTags: true,
    installHint: 'Instale o Ollama e execute: ollama serve',
    setupCommand: 'ollama serve',
  },
  {
    id: 'llamacpp-local',
    name: 'llama.cpp (local)',
    endpoint: 'http://127.0.0.1:8081/v1',
    healthUrl: 'http://127.0.0.1:8081/v1/models',
    installHint: 'Inicie o llama.cpp com o servidor OpenAI em http://127.0.0.1:8081',
    setupCommand: 'llama-server -m modelo.gguf --port 8081',
  },
  {
    id: 'lm-studio',
    name: 'LM Studio',
    endpoint: 'http://127.0.0.1:1234/v1',
    healthUrl: 'http://127.0.0.1:1234/v1/models',
    installHint: 'Abra o LM Studio e ative o servidor local na porta 1234',
    setupCommand: null,
  },
  {
    id: 'docker-test',
    name: 'Docker (teste)',
    endpoint: DOCKER_LLM_URL,
    healthUrl: DOCKER_LLM_URL + '/models',
    modelsUrl: DOCKER_LLM_URL + '/models',
    fallbackModel: DOCKER_LLM_MODEL,
    kind: 'docker',
    installHint: 'Execute: docker compose -f docker/test-llm/docker-compose.yml up -d',
    setupCommand: 'docker compose -f docker/test-llm/docker-compose.yml up -d',
  },
];

const DEMO_PROVIDER = {
  id: 'demo',
  name: 'Modo demo',
  endpoint: null,
  kind: 'demo',
  available: true,
  alwaysAvailable: true,
  models: [],
  description: 'Sem IA: editor, preview, console, arquivos, DevDocs e AGENTS.md continuam funcionando.',
  installHint: 'Escolha um provedor acima quando quiser conversar com uma IA.',
  setupCommand: null,
};

let cache = null;
let cacheAt = 0;

function unavailable(candidate, reason) {
  return {
    id: candidate.id,
    name: candidate.name,
    endpoint: candidate.endpoint,
    available: false,
    reason,
    installHint: candidate.installHint,
    setupCommand: candidate.setupCommand || null,
    kind: candidate.kind || 'local',
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
    if (models.length === 0 && candidate.fallbackModel) models.push(candidate.fallbackModel);

    return {
      id: candidate.id,
      name: candidate.name,
      endpoint: candidate.endpoint,
      available: true,
      models,
      setupCommand: candidate.setupCommand || null,
      kind: candidate.kind || 'local',
    };
  } catch (error) {
    return unavailable(candidate, `não respondeu em ${HEALTH_TIMEOUT_MS}ms`);
  }
}

function checkDeepSeek() {
  const available = Boolean(process.env.DEEPSEEK_API_KEY);
  const provider = {
    id: 'deepseek',
    name: 'DeepSeek (API)',
    endpoint: 'https://api.deepseek.com',
    kind: 'cloud',
    keyEnv: 'DEEPSEEK_API_KEY',
    setupCommand: null,
  };

  if (!available) {
    return {
      ...provider,
      available: false,
      reason: 'chave não configurada',
      installHint: 'Cole a chave em ⚙ → Celeiro de IAs → Chaves de API',
    };
  }

  return {
    ...provider,
    available: true,
    models: ['deepseek-flash'],
  };
}

function runDocker(args) {
  return new Promise((resolve) => {
    execFile('docker', args, { timeout: DOCKER_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve({
          ok: false,
          error: error.code === 'ENOENT' ? 'docker não encontrado' : 'docker indisponível',
        });
        return;
      }
      resolve({ ok: true, output: String(stdout || '') });
    });
  });
}

async function inspectDocker() {
  const result = await runDocker(['ps', '--format', '{{.Names}}\t{{.Image}}\t{{.Ports}}']);

  if (!result.ok) {
    return {
      cli: false,
      error: result.error,
      containers: [],
      testContainerRunning: false,
      hint: 'Instale o Docker para usar o provedor de teste em container',
    };
  }

  const containers = result.output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, image, ports] = line.split('\t');
      return { name: name || '', image: image || '', ports: ports || '' };
    })
    .slice(0, 20);

  return {
    cli: true,
    error: null,
    containers,
    testContainerRunning: containers.some(
      (container) =>
        /hermes.*llm|duck.*llm/i.test(container.name) ||
        /hermes-llm-test|duck-llm-test/i.test(container.image) ||
        /:8090->/.test(container.ports)
    ),
    hint: 'docker compose -f docker/test-llm/docker-compose.yml up -d',
  };
}

async function detectProviders(options) {
  const settings = options || {};
  const now = Date.now();

  if (!settings.refresh && cache && now - cacheAt < CACHE_TTL_MS) {
    return cache;
  }

  const local = await Promise.all(CANDIDATES.map(checkLocalProvider));
  local.push(checkDeepSeek());
  local.push(...relay.status());

  const docker = await inspectDocker();
  const usable = local.filter((provider) => provider.available);
  const preferred = settings.preferredProvider
    ? usable.find((provider) => provider.id === settings.preferredProvider)
    : null;

  const providers = local.concat([DEMO_PROVIDER]);

  const result = {
    providers,
    activeProvider: preferred ? preferred.id : usable[0] ? usable[0].id : 'demo',
    summary: {
      total: providers.length,
      available: usable.length,
      unavailable: providers.length - usable.length - 1,
      demo: true,
    },
    docker,
    detectedAt: Date.now(),
  };

  cache = result;
  cacheAt = now;
  return result;
}

function invalidateCache() {
  cache = null;
  cacheAt = 0;
}

module.exports = { detectProviders, invalidateCache, DOCKER_LLM_MODEL, DOCKER_LLM_URL };
