'use strict';

const fileStore = require('./file-store');
const patches = require('./patches');
const agents = require('./agents');
const editorContext = require('./editor-context');

let aiTalk = null;
let webService = null;
function getWeb() {
  if (!webService) webService = require('./web');
  return webService;
}
let configService = null;
function getConfig() {
  if (!configService) configService = require('./config');
  return configService;
}
function getAiTalk() {
  if (!aiTalk) aiTalk = require('./ai-talk');
  return aiTalk;
}

const PDF_NOTE = 'conteúdo binário/PDF não é suportado nesta fase';

const DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        'Lê um arquivo de texto do workspace. Use start/end (1-based, inclusivos) para ler apenas um trecho.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Caminho relativo à raiz do workspace' },
          start: { type: 'integer', description: 'Primeira linha (1-based)' },
          end: { type: 'integer', description: 'Última linha (1-based, inclusive)' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        'Propõe o conteúdo completo de um arquivo. A gravação só acontece após aprovação humana no diff.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Caminho relativo à raiz do workspace' },
          content: { type: 'string', description: 'Conteúdo completo proposto' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description:
        'Propõe a substituição de um trecho exato por outro. O trecho antigo deve aparecer uma única vez.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Caminho relativo à raiz do workspace' },
          old: { type: 'string', description: 'Trecho exato a substituir' },
          new: { type: 'string', description: 'Novo trecho' },
        },
        required: ['path', 'old', 'new'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_preview',
      description: 'Recarrega o visualizador (Bloco 2) com o estado atual do editor.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_agents_md',
      description:
        'Atualiza uma seção editável do AGENTS.md (1 = onde estou, 5 = decisões recentes).',
      parameters: {
        type: 'object',
        properties: {
          section: { type: 'integer', description: 'Número da seção (1 ou 5)' },
          content: { type: 'string', description: 'Novo conteúdo da seção' },
        },
        required: ['section', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recall_memory',
      description: 'Lê o AGENTS.md atual (memória viva do projeto).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delegate',
      description:
        'Despacha uma tarefa para outro modelo do celeiro (ai-talk) e devolve a resposta dele. Use prefer_role para escolher local, cloud, docker, machine ou any.',
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'Tarefa completa entregue ao outro modelo' },
          prefer_role: {
            type: 'string',
            description: 'Papel desejado: local, cloud, docker, machine ou any',
          },
          context: { type: 'string', description: 'Contexto curto do projeto (opcional)' },
        },
        required: ['task'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description:
        'Abre uma URL pública (http/https) e devolve o texto legível da página, com título e truncamento. Bloqueia rede local e conteúdo binário.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL completa, começando com http:// ou https://' },
          max_chars: {
            type: 'integer',
            description: 'Limite de caracteres do texto devolvido (padrão 20000)',
          },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Busca na web (DuckDuckGo por padrão, ou SearXNG via HERMES_SEARCH_URL) e devolve títulos, URLs e trechos.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Termos da busca' },
          limit: { type: 'integer', description: 'Quantidade de resultados (1 a 8, padrão 5)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_errors',
      description: 'Retorna os erros atualmente exibidos no console do visualizador.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description:
        'Lista arquivos e pastas do workspace (recursivo, com teto). Oculta .git, node_modules, caches e o que está no .gitignore.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Pasta inicial relativa à raiz (padrão: raiz)' },
          max_entries: {
            type: 'integer',
            description: 'Teto de entradas devolvidas (1 a 2000, padrão 500)',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_editor_context',
      description:
        'Retorna o estado atual do editor: arquivo ativo, seleção, cursor, abas abertas e se há alterações não salvas.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_models',
      description:
        'Lista os modelos expostos por um servidor local compatível: Ollama (/api/tags) ou OpenAI (/v1/models). Só aceita endereços da própria máquina ou da rede local.',
      parameters: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['ollama', 'openai'],
            description: 'Tipo do servidor (padrão ollama)',
          },
          base_url: {
            type: 'string',
            description: 'Base do servidor, ex.: http://127.0.0.1:11434',
          },
        },
        required: ['base_url'],
      },
    },
  },
];

const CLIENT_TOOLS = new Set(['run_preview', 'get_errors']);
const SERVER_TOOLS = new Set([
  'read_file',
  'write_file',
  'edit_file',
  'update_agents_md',
  'recall_memory',
  'delegate',
  'web_fetch',
  'web_search',
  'list_directory',
  'get_editor_context',
  'list_models',
]);

/**
 * Ferramentas registradas em tempo de execução por plugins. Ficam num mapa à
 * parte porque podem ser revogadas quando o plugin descarrega.
 */
const dynamicTools = new Map();

function registerDynamicTool(pluginId, definition, handler) {
  const owner = String(pluginId || '').trim();
  if (!owner) throw httpError('plugin sem id', 400);
  if (owner === 'core') throw httpError('o id "core" é reservado', 400);

  const fn = definition && definition.function ? definition.function : definition;
  const name = fn && typeof fn.name === 'string' ? fn.name.trim() : '';

  if (!/^[a-zA-Z][a-zA-Z0-9_]{1,63}$/.test(name)) {
    throw httpError('nome de ferramenta inválido', 400);
  }
  if (SERVER_TOOLS.has(name) || CLIENT_TOOLS.has(name) || dynamicTools.has(name)) {
    throw httpError(`já existe uma ferramenta chamada ${name}`, 409);
  }
  if (typeof handler !== 'function') throw httpError('handler da ferramenta deve ser função', 400);

  dynamicTools.set(name, {
    pluginId: owner,
    definition: {
      type: 'function',
      function: {
        name,
        description: String(fn.description || '').slice(0, 1000),
        parameters: fn.parameters || { type: 'object', properties: {} },
      },
    },
    handler,
  });

  return name;
}

function unregisterToolsByPlugin(pluginId) {
  let removed = 0;
  for (const [name, tool] of dynamicTools) {
    if (tool.pluginId === pluginId) {
      dynamicTools.delete(name);
      removed += 1;
    }
  }
  return removed;
}

function listDynamicTools() {
  return [...dynamicTools.entries()].map(([name, tool]) => ({
    name,
    pluginId: tool.pluginId,
  }));
}

function serverToolNames() {
  return [...SERVER_TOOLS, ...dynamicTools.keys()];
}

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function assertArguments(args) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    throw httpError('argumentos da ferramenta devem ser um objeto', 400);
  }
  return args;
}

function requireString(args, key) {
  const value = args[key];
  if (typeof value !== 'string') {
    throw httpError(`argumento "${key}" deve ser texto`, 400);
  }
  return value;
}

function sliceLines(content, start, end) {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const total = lines.length;

  const first = Number.isInteger(start) ? Math.max(1, start) : 1;
  const last = Number.isInteger(end) ? Math.min(total, end) : total;

  if (first > last) {
    throw httpError('intervalo de linhas inválido', 400);
  }

  return {
    start: first,
    end: last,
    total,
    truncated: first > 1 || last < total,
    content: lines.slice(first - 1, last).join('\n'),
  };
}

function countOccurrences(haystack, needle) {
  if (needle === '') return 0;

  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

async function readFileTool(args) {
  const targetPath = requireString(args, 'path');
  const start = args.start === undefined || args.start === null ? undefined : Number(args.start);
  const end = args.end === undefined || args.end === null ? undefined : Number(args.end);

  const file = await fileStore.readFile(targetPath);
  const slice = sliceLines(file.content, start, end);

  return {
    ok: true,
    path: file.path,
    size: file.size,
    totalLines: slice.total,
    start: slice.start,
    end: slice.end,
    truncated: slice.truncated,
    content: slice.content,
  };
}

async function proposal(pathValue, content, origin) {
  const preview = await patches.previewPatch({ path: pathValue, content, author: 'AI', origin });

  return {
    ok: true,
    requiresApproval: true,
    patchId: preview.id,
    path: preview.path,
    exists: preview.exists,
    changed: preview.changed,
    stats: preview.stats,
    diff: preview.diff,
    note:
      origin === 'edit_file'
        ? 'Edição proposta. Aguardando aprovação humana.'
        : 'Escrita proposta. Aguardando aprovação humana.',
  };
}

async function writeFileTool(args) {
  const targetPath = requireString(args, 'path');
  const content = requireString(args, 'content');

  return proposal(targetPath, content, 'write_file');
}

async function editFileTool(args) {
  const targetPath = requireString(args, 'path');
  const oldText = requireString(args, 'old');
  const newText = requireString(args, 'new');

  if (oldText === '') throw httpError('argumento "old" não pode ser vazio', 400);

  const file = await fileStore.readFile(targetPath);
  const occurrences = countOccurrences(file.content, oldText);

  if (occurrences === 0) {
    throw httpError('trecho antigo não encontrado no arquivo', 409);
  }
  if (occurrences > 1) {
    throw httpError(`trecho antigo aparece ${occurrences} vezes; use um trecho único`, 409);
  }

  const updated = file.content.replace(oldText, () => newText);
  return proposal(file.path, updated, 'edit_file');
}

function assertWebEnabled() {
  let web;
  try {
    web = getConfig().publicWeb();
  } catch (error) {
    throw httpError('não foi possível ler a configuração de internet', 500);
  }

  if (!web.enabled) {
    throw httpError(
      'acesso à internet está desativado — ligue em ⚙ → Celeiro de IAs → Acesso à internet',
      403
    );
  }

  return web;
}

async function webFetchTool(args) {
  assertWebEnabled();

  const url = requireString(args, 'url');
  const maxChars = args.max_chars === undefined || args.max_chars === null ? undefined : Number(args.max_chars);

  if (maxChars !== undefined && (!Number.isFinite(maxChars) || maxChars < 500 || maxChars > 60000)) {
    throw httpError('max_chars deve ficar entre 500 e 60000', 400);
  }

  const page = await getWeb().fetchPage(url, { maxChars });

  return {
    ok: true,
    url: page.url,
    status: page.status,
    contentType: page.contentType,
    title: page.title,
    bytes: page.bytes,
    truncated: page.truncated,
    text: page.text,
  };
}

async function webSearchTool(args) {
  assertWebEnabled();

  const query = requireString(args, 'query');
  const limit = args.limit === undefined || args.limit === null ? undefined : Number(args.limit);

  if (limit !== undefined && (!Number.isFinite(limit) || limit < 1 || limit > 8)) {
    throw httpError('limit deve ficar entre 1 e 8', 400);
  }

  const result = await getWeb().search(query, { limit });

  return {
    ok: true,
    query: result.query,
    engine: result.engine,
    results: result.results,
    empty: result.empty,
    note: result.note || null,
  };
}

const PRIVATE_HOST = /^(localhost|127(?:\.\d+){3}|::1|\[::1\]|10(?:\.\d+){3}|192\.168(?:\.\d+){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d+){2})$/;

/** `list_models` fala com servidores locais; usar como proxy de rede seria um furo. */
function assertLocalBaseUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl).trim());
  } catch (error) {
    throw httpError('base_url inválida', 400);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw httpError('base_url precisa ser http(s)', 400);
  }
  if (!PRIVATE_HOST.test(parsed.hostname.toLowerCase())) {
    throw httpError(
      'list_models só aceita endereços da própria máquina ou da rede local (127.0.0.1, localhost, 192.168.x, 10.x, 172.16-31.x)',
      403
    );
  }
  return parsed.toString().replace(/\/$/, '');
}

async function listModelsTool(args) {
  const kind = args.kind === 'openai' ? 'openai' : 'ollama';
  const base = assertLocalBaseUrl(requireString(args, 'base_url'));
  const url = kind === 'ollama' ? `${base}/api/tags` : `${base}/v1/models`;

  let response;
  try {
    response = await require('./http-client').fetch(url, { timeout: 5000 });
  } catch (error) {
    return { ok: false, kind, baseUrl: base, error: error.message, models: [] };
  }

  if (!response.ok) {
    return { ok: false, kind, baseUrl: base, error: `HTTP ${response.status}`, models: [] };
  }

  const payload = (await response.json().catch(() => null)) || {};
  const models =
    kind === 'ollama'
      ? (Array.isArray(payload.models) ? payload.models : [])
          .map((item) => item && item.name)
          .filter((name) => typeof name === 'string')
      : (Array.isArray(payload.data) ? payload.data : [])
          .map((item) => item && item.id)
          .filter((id) => typeof id === 'string');

  return { ok: true, kind, baseUrl: base, count: models.length, models };
}

async function execute(name, rawArguments) {
  const args = assertArguments(rawArguments || {});

  if (CLIENT_TOOLS.has(name)) {
    throw httpError(`a ferramenta ${name} é executada no navegador`, 400);
  }

  if (dynamicTools.has(name)) {
    const tool = dynamicTools.get(name);
    try {
      return await tool.handler(args);
    } catch (error) {
      if (error && error.status) throw error;
      throw httpError(`plugin ${tool.pluginId}: ${error.message || 'falha na ferramenta'}`, 502);
    }
  }

  if (!SERVER_TOOLS.has(name)) {
    throw httpError(`ferramenta desconhecida: ${name}`, 404);
  }

  switch (name) {
    case 'read_file':
      return readFileTool(args);
    case 'write_file':
      return writeFileTool(args);
    case 'edit_file':
      return editFileTool(args);
    case 'update_agents_md':
      return agents.updateSection(args.section, requireString(args, 'content'));
    case 'recall_memory':
      return agents.readAgents();
    case 'delegate':
      return getAiTalk().delegate({
        task: requireString(args, 'task'),
        preferRole: args.prefer_role,
        context: typeof args.context === 'string' ? args.context : '',
      });
    case 'web_fetch':
      return webFetchTool(args);
    case 'web_search':
      return webSearchTool(args);
    case 'list_directory': {
      const maxEntries = args.max_entries === undefined ? undefined : Number(args.max_entries);
      if (maxEntries !== undefined && (!Number.isFinite(maxEntries) || maxEntries < 1 || maxEntries > 2000)) {
        throw httpError('max_entries deve ficar entre 1 e 2000', 400);
      }
      const listing = await fileStore.walkDirectory(
        typeof args.path === 'string' ? args.path : '',
        { maxEntries }
      );
      return { ok: true, ...listing };
    }
    case 'get_editor_context':
      return { ok: true, ...editorContext.store.get() };
    case 'list_models':
      return listModelsTool(args);
    default:
      throw httpError(`ferramenta desconhecida: ${name}`, 404);
  }
}

function listDefinitions() {
  return [...DEFINITIONS, ...[...dynamicTools.values()].map((tool) => tool.definition)];
}

module.exports = {
  DEFINITIONS,
  CLIENT_TOOLS,
  SERVER_TOOLS,
  listDefinitions,
  serverToolNames,
  registerDynamicTool,
  unregisterToolsByPlugin,
  listDynamicTools,
  execute,
  sliceLines,
  countOccurrences,
  PDF_NOTE,
};
