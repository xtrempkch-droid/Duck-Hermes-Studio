'use strict';

const fs = require('fs');
const path = require('path');

const { detectProviders } = require('./detect-providers');
const { proxyChat } = require('./llm-proxy');
const relay = require('./relay');
const machines = require('./machines');

const DATA_DIR = path.join(__dirname, '..', 'data');
const TRANSCRIPT_FILE = path.join(DATA_DIR, 'ai-talk.json');
const MAX_ENTRIES = 50;
const MAX_TASK_CHARS = 8000;
const MAX_REPLY_CHARS = 8000;
const DELEGATE_TIMEOUT_MS = 120000;

const ROLES = {
  local: 'modelo local (Ollama, llama.cpp, LM Studio, Deep Rock IA)',
  cloud: 'modelo na nuvem (DeepSeek, OpenRouter, Gemini)',
  docker: 'LLM de teste em container',
  machine: 'modelo em outra máquina da rede',
  any: 'qualquer provedor disponível',
};

const ROLE_PROVIDERS = {
  local: ['ollama', 'llamacpp-local', 'lm-studio', 'deep-rock-local'],
  cloud: ['deepseek', 'openrouter', 'gemini'],
  docker: ['docker-test'],
};

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeRole(value) {
  if (value === undefined || value === null || value === '') return 'any';
  const role = String(value).trim().toLowerCase();
  if (!ROLES[role]) {
    throw httpError('papel inválido: use ' + Object.keys(ROLES).join(', '), 400);
  }
  return role;
}

function normalizeTask(value) {
  if (typeof value !== 'string') throw httpError('a tarefa precisa ser um texto', 400);

  const task = value.replace(/\r\n?/g, '\n').trim();
  if (task.length < 3) throw httpError('tarefa curta demais', 400);
  if (task.length > MAX_TASK_CHARS) {
    throw httpError('tarefa limitada a ' + MAX_TASK_CHARS + ' caracteres', 400);
  }
  return task;
}

function readTranscript() {
  try {
    const raw = fs.readFileSync(TRANSCRIPT_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function writeTranscript(entries) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(TRANSCRIPT_FILE, JSON.stringify(entries.slice(-MAX_ENTRIES), null, 2));
  } catch (error) {
    /* histórico é opcional: falha de disco não interrompe a delegação */
  }
}

function appendEntry(entry) {
  const entries = readTranscript();
  entries.push(entry);
  writeTranscript(entries);
  return entry;
}

function makeId() {
  return 'talk_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

async function availableTargets() {
  const farm = await detectProviders();
  const list = [];

  for (const provider of farm.providers || []) {
    if (!provider.available || provider.id === 'demo') continue;
    list.push({
      id: provider.id,
      name: provider.name || provider.id,
      kind: provider.kind || 'local',
      endpoint: provider.endpoint || null,
      models: provider.models || [],
      roles: Object.keys(ROLE_PROVIDERS).filter((role) =>
        ROLE_PROVIDERS[role].indexOf(provider.id) !== -1
      ),
    });
  }

  for (const machine of machines.listMachines()) {
    if (!machine.llmUrl) continue;
    list.push({
      id: 'machine:' + machine.id,
      name: machine.name + ' (rede)',
      kind: 'machine',
      endpoint: machine.llmUrl,
      models: machine.llmModel ? [machine.llmModel] : [],
      roles: ['machine'],
    });
  }

  return list;
}

function pickTarget(targets, role, preferredId) {
  if (preferredId) {
    const exact = targets.find((target) => target.id === preferredId);
    if (!exact) throw httpError('provedor ' + preferredId + ' não está disponível', 409);
    return exact;
  }

  if (role === 'any') {
    if (targets.length === 0) throw httpError('nenhum provedor de IA disponível para delegar', 409);
    return targets[0];
  }

  const match = targets.find((target) => target.roles.indexOf(role) !== -1);
  if (!match) {
    throw httpError('nenhum provedor com papel "' + role + '" disponível', 409);
  }
  return match;
}

function pickModel(models, requested) {
  if (requested) return requested;
  if (!Array.isArray(models) || models.length === 0) return null;
  const local = models.find((model) => typeof model === 'string' && model.indexOf(':cloud') === -1);
  return local || models[0];
}

async function callTarget(target, model, messages, options) {
  const settings = options || {};

  if (relay.isRelay(target.id)) {
    return relay.chat({
      provider: target.id,
      model,
      messages,
      tools: settings.tools,
      timeout: DELEGATE_TIMEOUT_MS,
    });
  }

  let baseUrl = target.endpoint;
  let fallbackModel = null;

  if (target.id.indexOf('machine:') === 0) {
    const machine = machines.getMachine(target.id.slice('machine:'.length));
    if (!machine || !machine.llmUrl) throw httpError('máquina de IA não encontrada', 404);
    baseUrl = machine.llmUrl;
    fallbackModel = machine.llmModel || null;
  }

  const provider = target.id.indexOf('machine:') === 0 ? 'openai-compatible' : target.id;
  const response = await proxyChat({
    provider,
    model: model || fallbackModel || undefined,
    messages,
    stream: false,
    baseUrl,
    tools: settings.tools,
    timeout: DELEGATE_TIMEOUT_MS,
  });

  const data = await response.json();
  const message = (data && data.choices && data.choices[0] && data.choices[0].message) || {};
  const content = typeof message.content === 'string' ? message.content : '';

  return {
    provider: target.id,
    model: (data && data.model) || model || null,
    content,
    toolCalls: Array.isArray(message.tool_calls)
      ? message.tool_calls.map((call) => ({
          id: call.id || null,
          type: 'function',
          function: {
            name: (call.function && call.function.name) || '',
            arguments: (call.function && call.function.arguments) || '{}',
          },
        }))
      : [],
    finishReason: data && data.choices && data.choices[0] ? data.choices[0].finish_reason : null,
  };
}

function buildMessages(task, context) {
  const lines = [
    'Você é outro agente do celeiro do Duck Hermes Studio, acionado por delegação.',
    'Responda apenas o resultado pedido, em português, sem inventar conteúdo de arquivos.',
  ];

  if (context) lines.push('Contexto do projeto:', String(context).slice(0, 4000));

  return [
    { role: 'system', content: lines.join('\n') },
    { role: 'user', content: task },
  ];
}

async function delegate(input) {
  const payload = input || {};
  const task = normalizeTask(payload.task);
  const role = normalizeRole(payload.preferRole || payload.role);
  const targets = await availableTargets();
  const target = pickTarget(targets, role, payload.provider);
  const model = pickModel(target.models, payload.model);
  const started = Date.now();
  const id = makeId();

  try {
    const result = await callTarget(target, model, buildMessages(task, payload.context), {
      tools: payload.tools,
    });

    const entry = appendEntry({
      id,
      at: new Date().toISOString(),
      status: 'ok',
      role,
      task: task.slice(0, 2000),
      target: { id: target.id, name: target.name, kind: target.kind },
      model: result.model || model,
      durationMs: Date.now() - started,
      reply: String(result.content || '').slice(0, MAX_REPLY_CHARS),
      toolCalls: (result.toolCalls || []).length,
    });

    return {
      ok: true,
      id: entry.id,
      target: entry.target,
      model: entry.model,
      role,
      durationMs: entry.durationMs,
      content: entry.reply,
      toolCalls: result.toolCalls || [],
      finishReason: result.finishReason || null,
    };
  } catch (error) {
    appendEntry({
      id,
      at: new Date().toISOString(),
      status: 'error',
      role,
      task: task.slice(0, 2000),
      target: { id: target.id, name: target.name, kind: target.kind },
      model: model || null,
      durationMs: Date.now() - started,
      error: error.message,
    });
    throw error.status ? error : httpError('delegação falhou: ' + error.message, 502);
  }
}

async function status() {
  const targets = await availableTargets();
  return {
    roles: Object.keys(ROLES).map((id) => ({
      id,
      description: ROLES[id],
      available:
        id === 'any'
          ? targets.length
          : targets.filter((target) => target.roles.indexOf(id) !== -1).length,
    })),
    targets,
    recent: readTranscript().slice(-10).reverse(),
    total: readTranscript().length,
    timeoutMs: DELEGATE_TIMEOUT_MS,
  };
}

function clearTranscript() {
  writeTranscript([]);
  return { ok: true, cleared: true };
}

module.exports = {
  ROLES,
  ROLE_PROVIDERS,
  delegate,
  status,
  availableTargets,
  readTranscript,
  clearTranscript,
  normalizeRole,
  normalizeTask,
  pickTarget,
  TRANSCRIPT_FILE,
};
