'use strict';

/**
 * Turno do agente no servidor: pede ao modelo, executa as ferramentas que ele
 * pedir, repete dentro de um orçamento de passos.
 *
 * O tool calling é feito **pelo prompt**, não pelo `tools` nativo do provedor.
 * Motivo: modelos locais pequenos (e reasoning distills) não têm template de
 * tool calling nem JSON Schema; o modelo recebe as ferramentas em prosa e
 * responde um objeto JSON. Isso também torna o loop testável sem rede.
 *
 * Todo caminho de saída é explícito: chamada de ferramenta, resposta final,
 * resposta fora do contrato JSON (vira a resposta), recusa por repetição e
 * orçamento esgotado.
 */

const DEFAULT_MAX_STEPS = 6;
const MAX_MAX_STEPS = 50;
const MAX_TOOL_RESULT_CHARS = 6000;

const DANGEROUS_TOOLS = new Set(['write_file', 'edit_file', 'update_agents_md']);

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function buildSystemPrompt(agentTools) {
  const toolLines = agentTools
    .map((tool) => {
      const args =
        Array.isArray(tool.parameters) && tool.parameters.length > 0
          ? ` (argumentos: ${tool.parameters.join(', ')})`
          : '';
      return `- ${tool.name}: ${tool.description}${args}`;
    })
    .join('\n');

  return (
    'Você é um assistente de programação operando o editor Duck Hermes Studio. ' +
    'Você tem acesso a estas ferramentas:\n' +
    `${toolLines}\n\n` +
    'Responda APENAS com um objeto JSON, sem texto ao redor:\n' +
    '- para chamar uma ferramenta: {"tool":"<nome>","arguments":{...}}\n' +
    '- para a resposta final: {"answer":"<texto>"}\n\n' +
    'Use o nome exato da ferramenta. Se um argumento estiver errado, a ferramenta ' +
    'responderá com erro e você pode tentar de novo com os argumentos corretos.'
  );
}

function parseJsonObject(text) {
  const start = String(text).indexOf('{');
  const end = String(text).lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed = JSON.parse(String(text).slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    return null;
  }
}

function answerPreview(raw) {
  const key = raw.indexOf('"answer"');
  if (key === -1) return '';
  const colon = raw.indexOf(':', key + 8);
  if (colon === -1) return '';
  const quote = raw.indexOf('"', colon + 1);
  if (quote === -1) return '';

  let result = '';
  for (let index = quote + 1; index < raw.length; index += 1) {
    const character = raw[index];
    if (character === '\\' && index + 1 < raw.length) {
      const escaped = raw[index + 1];
      result += escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped === 'r' ? '\r' : escaped;
      index += 1;
    } else if (character === '"') {
      break;
    } else {
      result += character;
    }
  }
  return result;
}

async function executeSafely(tool, args) {
  try {
    return await tool.execute(args);
  } catch (error) {
    return `ERRO: ${error.message}`;
  }
}

function isFailure(result) {
  return String(result).trimStart().startsWith('ERRO:');
}

function callSignature(name, args) {
  try {
    return `${name}:${JSON.stringify(args)}`;
  } catch (error) {
    return `${name}:unserialisable`;
  }
}

function failureFeedback(tool, result) {
  const expected =
    Array.isArray(tool.parameters) && tool.parameters.length > 0
      ? `\nA ferramenta "${tool.name}" espera exatamente estes argumentos: ${tool.parameters.join(', ')}.`
      : '';
  return `Resultado de ${tool.name}:\n${result}${expected}`;
}

function completedSummary(completed) {
  return completed.length === 0
    ? ''
    : `\n\nFerramentas que responderam com sucesso: ${completed.join(', ')}.`;
}

function exhaustedMessage(lastCall, completed) {
  const summary = completedSummary(completed);

  if (lastCall && lastCall.error) {
    return (
      `O agente parou no limite de passos logo depois de uma chamada que falhou ` +
      `("${lastCall.tool}"):\n\n${lastCall.error}\n\n` +
      'Se ele só precisava de mais passos, aumente "Máximo de passos"; se o mesmo erro ' +
      'se repetir sempre, aumentar não resolve — corrija o argumento ou reformule a tarefa.' +
      summary
    );
  }

  return (
    `O agente atingiu o limite de passos sem dar uma resposta final.${summary}` +
    (completed.length === 0
      ? ' Tente uma tarefa menor ou aumente o limite.'
      : ' Se ele já fez o que você pediu, confira o resultado antes de repetir.')
  );
}

function clampSteps(value) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return DEFAULT_MAX_STEPS;
  return Math.min(MAX_MAX_STEPS, Math.max(1, number));
}

function truncate(text) {
  const value = String(text);
  return value.length > MAX_TOOL_RESULT_CHARS
    ? `${value.slice(0, MAX_TOOL_RESULT_CHARS)}\n… (resultado truncado)`
    : value;
}

/**
 * Um turno. `complete` recebe `{ messages }` e devolve o texto do modelo —
 * injetável para teste e para escolher entre Ollama nativo e OpenAI.
 */
async function runAgentTurn(request) {
  const settings = request || {};
  const maxSteps = clampSteps(settings.maxSteps);
  const mode = settings.mode === 'assisted' ? 'assisted' : 'autonomous';
  const agentTools = Array.isArray(settings.tools) ? settings.tools : [];
  const toolsByName = new Map();
  for (const tool of agentTools) toolsByName.set(tool.name, tool);

  if (typeof settings.complete !== 'function') {
    throw httpError('runAgentTurn precisa de uma função complete', 500);
  }

  const steps = [];
  let previousFailure = null;
  let lastCall = null;
  const completed = [];
  let messages;

  if (Array.isArray(settings.history) && settings.history.length > 0) {
    messages = [...settings.history];
  } else {
    messages = [
      { role: 'system', content: buildSystemPrompt(agentTools) },
      { role: 'user', content: String(settings.prompt || '') },
    ];
  }

  for (let index = 0; index < maxSteps; index += 1) {
    const content = await settings.complete({ messages, step: index });

    if (typeof settings.onProgress === 'function') {
      const preview = answerPreview(String(content || ''));
      if (preview) settings.onProgress({ type: 'answer_delta', text: preview });
    }

    const parsed = parseJsonObject(content);

    if (parsed === null) {
      steps.push({ action: 'fallback', text: String(content || '') });
      return { status: 'done', answer: String(content || ''), steps };
    }

    if (typeof parsed.answer === 'string') {
      steps.push({ action: 'answer', text: parsed.answer });
      return { status: 'done', answer: parsed.answer, steps };
    }

    if (typeof parsed.tool !== 'string') {
      steps.push({ action: 'fallback', text: String(content || '') });
      return { status: 'done', answer: String(content || ''), steps };
    }

    const toolName = parsed.tool;
    const args = parsed.arguments && typeof parsed.arguments === 'object' ? parsed.arguments : {};
    const tool = toolsByName.get(toolName);

    if (typeof settings.onProgress === 'function') {
      settings.onProgress({ type: 'tool_call', tool: toolName });
    }

    if (mode === 'assisted' && DANGEROUS_TOOLS.has(toolName)) {
      return {
        status: 'needs_approval',
        answer: '',
        steps,
        tool: toolName,
        arguments: args,
        history: messages,
        assistantJson: String(content || ''),
      };
    }

    messages.push({ role: 'assistant', content: String(content || '') });

    if (!tool) {
      messages.push({
        role: 'user',
        content: `A ferramenta "${toolName}" não existe. Disponíveis: ${agentTools
          .map((known) => known.name)
          .join(', ')}.`,
      });
      steps.push({ action: 'tool', text: toolName });
      continue;
    }

    const result = truncate(await executeSafely(tool, args));

    if (isFailure(result)) {
      const signature = callSignature(toolName, args);
      if (previousFailure && previousFailure.signature === signature && previousFailure.error === result) {
        steps.push({ action: 'tool', text: toolName });
        return {
          status: 'done',
          answer:
            `A chamada a "${toolName}" falhou duas vezes seguidas com os mesmos argumentos e o mesmo erro, ` +
            `então parei em vez de gastar o resto do orçamento repetindo-a. Erro:\n\n${result}` +
            completedSummary(completed),
          steps,
        };
      }
      previousFailure = { signature, error: result };
      lastCall = { tool: toolName, error: result };
    } else {
      previousFailure = null;
      lastCall = { tool: toolName, error: null };
      completed.push(toolName);
    }

    messages.push({
      role: 'user',
      content: isFailure(result) ? failureFeedback(tool, result) : `Resultado de ${toolName}:\n${result}`,
    });
    steps.push({ action: 'tool', text: toolName });
  }

  return { status: 'done', answer: exhaustedMessage(lastCall, completed), steps };
}

/** Adapta as definições do app (`services/tools.js`) para `AgentTool`. */
function toolsFromDefinitions(definitions, execute) {
  return definitions.map((definition) => {
    const fn = definition.function || definition;
    const parameters =
      fn.parameters && fn.parameters.properties ? Object.keys(fn.parameters.properties) : [];
    return {
      name: fn.name,
      description: fn.description || '',
      parameters,
      execute: async (args) => {
        const result = await execute(fn.name, args || {});
        return JSON.stringify(result, null, 2);
      },
    };
  });
}

/**
 * Completa um turno usando Ollama nativo (`format: json`) ou um provedor
 * OpenAI-compatible já configurado no app (chave/base vêm do llm-proxy).
 */
function makeCompleter(options) {
  const settings = options || {};
  const provider = settings.provider || 'ollama';
  const model = settings.model;
  const baseUrl = settings.baseUrl || 'http://127.0.0.1:11434';
  const timeout = Math.min(Math.max(Number(settings.timeout) || 120000, 5000), 600000);

  if (!model) throw httpError('informe o modelo para o agente', 400);

  if (provider === 'ollama') {
    const httpClient = require('./http-client');
    return async ({ messages }) => {
      let response;
      try {
        response = await httpClient.fetch(baseUrl.replace(/\/$/, '') + '/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages, stream: false, format: 'json' }),
          timeout,
        });
      } catch (error) {
        throw httpError('não foi possível falar com o Ollama em ' + baseUrl + ': ' + error.message, 502);
      }

      if (!response.ok) throw httpError(`Ollama respondeu HTTP ${response.status}`, 502);
      const payload = await response.json().catch(() => null);
      const content = payload && payload.message && payload.message.content;
      if (typeof content !== 'string' || content.trim() === '') {
        throw httpError('Ollama respondeu sem conteúdo', 502);
      }
      return content;
    };
  }

  const { proxyChat } = require('./llm-proxy');
  return async ({ messages }) => {
    const response = await proxyChat({ provider, model, messages, stream: false, timeout });
    const payload = await response.json().catch(() => null);
    const content =
      payload && payload.choices && payload.choices[0] && payload.choices[0].message
        ? payload.choices[0].message.content
        : null;
    if (typeof content !== 'string' || content.trim() === '') {
      throw httpError('provedor respondeu sem conteúdo', 502);
    }
    return content;
  };
}

module.exports = {
  DEFAULT_MAX_STEPS,
  MAX_MAX_STEPS,
  DANGEROUS_TOOLS,
  buildSystemPrompt,
  parseJsonObject,
  answerPreview,
  runAgentTurn,
  toolsFromDefinitions,
  makeCompleter,
  clampSteps,
};
