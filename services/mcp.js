'use strict';

/**
 * Servidor MCP (Model Context Protocol) em stdio, sem SDK.
 *
 * Fala JSON-RPC 2.0 delimitado por linha — o transporte que clientes MCP usam
 * em stdio. Expõe as mesmas ferramentas do app (`services/tools.js`), então o
 * agente do Duck Hermes pode ser chamado por qualquer cliente MCP (VS Code,
 * Claude Desktop, scripts) sem duplicar implementação.
 *
 * Regra de ouro: **stdout é o canal JSON-RPC**. Diagnóstico vai para stderr.
 */

const readline = require('readline');

const tools = require('./tools');

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'duck-hermes-studio';
const SERVER_VERSION = '0.1.0';
const MAX_INPUT_BYTES = 1024 * 1024;

function textResult(text, isError) {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

function jsonResult(value) {
  return textResult(JSON.stringify(value, null, 2));
}

function errorResponse(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/** Converte a definição OpenAI-like do app para o formato `tools/list` do MCP. */
function toMcpTool(definition) {
  const fn = definition.function || definition;
  return {
    name: fn.name,
    description: fn.description || '',
    inputSchema: fn.parameters || { type: 'object', properties: {} },
  };
}

function listTools() {
  return tools
    .listDefinitions()
    .filter((definition) => {
      const name = (definition.function || definition).name;
      return !tools.CLIENT_TOOLS.has(name);
    })
    .map(toMcpTool);
}

/** Trata uma mensagem; devolve a resposta ou `null` para notificações. */
async function handleMessage(message) {
  if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') {
    return errorResponse(message && message.id !== undefined ? message.id : null, -32600, 'requisição inválida');
  }

  const { id, method, params } = message;
  const isNotification = id === undefined;

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
          instructions:
            'Ferramentas do editor local Duck Hermes Studio. write_file/edit_file propõem patches que só são gravados após aprovação humana no app.',
        },
      };

    case 'notifications/initialized':
    case 'initialized':
      return null;

    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };

    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: listTools() } };

    case 'tools/call': {
      const name = params && params.name;
      const args = (params && params.arguments) || {};

      if (typeof name !== 'string' || !name) {
        return errorResponse(id, -32602, 'params.name obrigatório');
      }
      if (tools.CLIENT_TOOLS.has(name)) {
        return { jsonrpc: '2.0', id, result: textResult(`a ferramenta ${name} só existe na interface`, true) };
      }

      try {
        const result = await tools.execute(name, args);
        return { jsonrpc: '2.0', id, result: jsonResult(result) };
      } catch (error) {
        return {
          jsonrpc: '2.0',
          id,
          result: textResult(error.message || 'falha na ferramenta', true),
        };
      }
    }

    default:
      if (isNotification) return null;
      return errorResponse(id, -32601, `método não suportado: ${String(method)}`);
  }
}

/**
 * Liga o servidor ao stdio. Cada linha de stdin é uma mensagem; cada resposta
 * vira uma linha em stdout. Respostas de requisições assíncronas podem sair
 * fora de ordem — o protocolo permite, o id correlaciona.
 */
function serveStdio(options) {
  const settings = options || {};
  const input = settings.input || process.stdin;
  const output = settings.output || process.stdout;
  const log = settings.log || ((line) => process.stderr.write(line + '\n'));

  let buffer = '';

  const write = (message) => {
    output.write(JSON.stringify(message) + '\n');
  };

  const handleLine = async (line) => {
    if (!line.trim()) return;

    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      write(errorResponse(null, -32700, 'JSON inválido'));
      return;
    }

    try {
      const response = await handleMessage(message);
      if (response) write(response);
    } catch (error) {
      write(
        message && message.id !== undefined
          ? errorResponse(message.id, -32603, error.message || 'erro interno')
          : null
      );
    }
  };

  input.setEncoding('utf8');
  input.on('data', (chunk) => {
    buffer += chunk;
    if (buffer.length > MAX_INPUT_BYTES) {
      log('mensagem grande demais; descartando buffer');
      buffer = '';
      return;
    }

    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      handleLine(line);
    }
  });

  input.on('end', () => {
    if (buffer.trim()) handleLine(buffer);
  });

  log(`${SERVER_NAME} MCP pronto (stdio, ${listTools().length} ferramentas)`);
  return { handleMessage, listTools };
}

module.exports = {
  PROTOCOL_VERSION,
  SERVER_NAME,
  SERVER_VERSION,
  handleMessage,
  listTools,
  serveStdio,
  toMcpTool,
};
