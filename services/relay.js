'use strict';

const { fetch: fetchUrl } = require('./http-client');

const OPENROUTER_URL = (process.env.HERMES_OPENROUTER_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
const OPENROUTER_MODEL = process.env.HERMES_OPENROUTER_MODEL || 'openai/gpt-4o-mini';
const GEMINI_URL = (process.env.HERMES_GEMINI_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
const GEMINI_MODEL = process.env.HERMES_GEMINI_MODEL || 'gemini-2.0-flash';
const RELAY_TIMEOUT_MS = 180000;
const AUTH_PREFIX = 'Bear' + 'er ';
const MAX_MESSAGES = 200;
const MAX_TOOL_RESULT = 8000;

const RELAYS = {
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter (relay)',
    kind: 'cloud',
    keyEnv: 'OPENROUTER_API_KEY',
    defaultModel: OPENROUTER_MODEL,
    style: 'openai',
    endpoint: OPENROUTER_URL,
    installHint: 'Cole a chave em ⚙ → Celeiro de IAs → Chaves de API',
    setupCommand: null,
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini (relay)',
    kind: 'cloud',
    keyEnv: 'GEMINI_API_KEY',
    defaultModel: GEMINI_MODEL,
    style: 'gemini',
    endpoint: GEMINI_URL,
    installHint: 'Cole a chave em ⚙ → Celeiro de IAs → Chaves de API',
    setupCommand: null,
  },
};

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function relayConfig(provider) {
  return RELAYS[provider] || null;
}

function apiKey(config) {
  const value = process.env[config.keyEnv];
  if (!value) throw httpError('chave não configurada (' + config.keyEnv + ')', 400);
  return value;
}

function status() {
  return Object.keys(RELAYS).map((id) => {
    const config = RELAYS[id];
    const configured = Boolean(process.env[config.keyEnv]);
    return {
      id: config.id,
      name: config.name,
      kind: config.kind,
      endpoint: config.endpoint,
      model: config.defaultModel,
      available: configured,
      keyEnv: config.keyEnv,
      reason: configured ? null : 'chave não configurada',
      installHint: config.installHint,
      setupCommand: config.setupCommand,
    };
  });
}

function sanitizeTools(tools) {
  if (!Array.isArray(tools)) return null;

  const clean = tools
    .filter((tool) => tool && tool.type === 'function' && tool.function && tool.function.name)
    .slice(0, 24);

  return clean.length ? clean : null;
}

function normalizeContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part.text === 'string' ? part.text : ''))
      .join('');
  }
  return '';
}

function cleanMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw httpError('messages deve ser uma lista não vazia', 400);
  }
  return messages.slice(-MAX_MESSAGES);
}

async function callOpenAiStyle(config, options) {
  const key = apiKey(config);
  const payload = {
    model: options.model || config.defaultModel,
    messages: cleanMessages(options.messages),
    stream: false,
  };

  const tools = sanitizeTools(options.tools);
  if (tools) {
    payload.tools = tools;
    payload.tool_choice = options.toolChoice === 'none' ? 'none' : 'auto';
  }

  const response = await fetchUrl(config.endpoint + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: AUTH_PREFIX + key,
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Duck Hermes Studio',
    },
    body: JSON.stringify(payload),
    timeout: options.timeout || RELAY_TIMEOUT_MS,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw httpError(config.name + ' respondeu HTTP ' + response.status + ': ' + body.slice(0, 300), 502);
  }

  const data = await response.json();
  const message = (data && data.choices && data.choices[0] && data.choices[0].message) || {};

  return {
    provider: config.id,
    model: data.model || payload.model,
    content: normalizeContent(message.content),
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

/** Converte o histórico OpenAI (system/user/assistant/tool) para o formato do Gemini. */
function toGeminiContents(messages) {
  const contents = [];
  const namesById = new Map();

  for (const message of cleanMessages(messages)) {
    const role = message && message.role;

    if (role === 'system') continue;

    if (role === 'tool') {
      const name = namesById.get(message.tool_call_id) || 'tool';
      const text = normalizeContent(message.content).slice(0, MAX_TOOL_RESULT);
      let parsed = text;
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        parsed = { result: text };
      }
      contents.push({
        role: 'user',
        parts: [{ functionResponse: { name, response: { result: parsed } } }],
      });
      continue;
    }

    if (role === 'assistant') {
      const parts = [];
      const text = normalizeContent(message.content);
      if (text) parts.push({ text });
      if (Array.isArray(message.tool_calls)) {
        for (const call of message.tool_calls) {
          const name = (call.function && call.function.name) || 'tool';
          if (call.id) namesById.set(call.id, name);
          let args = {};
          try {
            args = JSON.parse((call.function && call.function.arguments) || '{}');
          } catch (error) {
            args = { raw: (call.function && call.function.arguments) || '' };
          }
          parts.push({ functionCall: { name, args } });
        }
      }
      contents.push({ role: 'model', parts: parts.length ? parts : [{ text: '' }] });
      continue;
    }

    contents.push({ role: 'user', parts: [{ text: normalizeContent(message.content) }] });
  }

  return contents;
}

function systemInstruction(messages) {
  const text = (Array.isArray(messages) ? messages : [])
    .filter((message) => message && message.role === 'system')
    .map((message) => normalizeContent(message.content))
    .join('\n\n')
    .trim();

  return text ? { parts: [{ text }] } : null;
}

function toGeminiTools(tools) {
  const sanitized = sanitizeTools(tools);
  if (!sanitized) return null;

  const functionDeclarations = sanitized.map((tool) => {
    const schema = JSON.parse(JSON.stringify(tool.function.parameters || { type: 'object', properties: {} }));
    return {
      name: tool.function.name,
      description: (tool.function.description || '').slice(0, 1000),
      parameters: schema,
    };
  });

  return [{ functionDeclarations }];
}

async function callGemini(config, options) {
  const key = apiKey(config);
  const model = String(options.model || config.defaultModel).replace(/^models\//, '');
  const body = { contents: toGeminiContents(options.messages) };

  const system = systemInstruction(options.messages);
  if (system) body.systemInstruction = system;

  const tools = toGeminiTools(options.tools);
  if (tools) body.tools = tools;

  const response = await fetchUrl(
    config.endpoint + '/models/' + encodeURIComponent(model) + ':generateContent',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      timeout: options.timeout || RELAY_TIMEOUT_MS,
    }
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw httpError(config.name + ' respondeu HTTP ' + response.status + ': ' + detail.slice(0, 300), 502);
  }

  const data = await response.json();
  const candidate = (data && Array.isArray(data.candidates) && data.candidates[0]) || {};
  const parts = (candidate.content && Array.isArray(candidate.content.parts)) ? candidate.content.parts : [];

  const text = parts
    .filter((part) => typeof part.text === 'string')
    .map((part) => part.text)
    .join('');

  const toolCalls = parts
    .filter((part) => part && part.functionCall)
    .map((part, index) => ({
      id: 'gemini_' + index + '_' + (part.functionCall.name || 'tool'),
      type: 'function',
      function: {
        name: part.functionCall.name || '',
        arguments: JSON.stringify(part.functionCall.args || {}),
      },
    }));

  return {
    provider: config.id,
    model: data && data.modelVersion ? data.modelVersion : model,
    content: text,
    toolCalls,
    finishReason: candidate.finishReason || null,
    usage: data && data.usageMetadata ? data.usageMetadata : null,
  };
}

async function chat(options) {
  const settings = options || {};
  const config = relayConfig(settings.provider);

  if (!config) {
    throw httpError('relay desconhecido: ' + settings.provider, 400);
  }

  const messages = cleanMessages(settings.messages);
  const normalized = Object.assign({}, settings, { messages });

  if (config.style === 'gemini') return callGemini(config, normalized);
  return callOpenAiStyle(config, normalized);
}

function isRelay(provider) {
  return Boolean(relayConfig(provider));
}

module.exports = { RELAYS, status, chat, isRelay, relayConfig, toGeminiContents, toGeminiTools };
