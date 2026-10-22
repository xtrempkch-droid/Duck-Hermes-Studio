'use strict';

const fileStore = require('./file-store');
const patches = require('./patches');
const agents = require('./agents');

let aiTalk = null;
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
      name: 'get_errors',
      description: 'Retorna os erros atualmente exibidos no console do visualizador.',
      parameters: { type: 'object', properties: {} },
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
]);

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
  const preview = await patches.previewPatch({ path: pathValue, content });

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

async function execute(name, rawArguments) {
  const args = assertArguments(rawArguments || {});

  if (CLIENT_TOOLS.has(name)) {
    throw httpError(`a ferramenta ${name} é executada no navegador`, 400);
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
    default:
      throw httpError(`ferramenta desconhecida: ${name}`, 404);
  }
}

function listDefinitions() {
  return DEFINITIONS;
}

module.exports = {
  DEFINITIONS,
  CLIENT_TOOLS,
  SERVER_TOOLS,
  listDefinitions,
  execute,
  sliceLines,
  countOccurrences,
  PDF_NOTE,
};
