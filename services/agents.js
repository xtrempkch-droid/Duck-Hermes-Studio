'use strict';

const fsp = require('fs/promises');
const path = require('path');

const fileStore = require('./file-store');

const FILE_NAME = 'AGENTS.md';
const MAX_BYTES = 64 * 1024;
const MAX_INJECT_CHARS = 8000;
const MAX_LINES = 200;
const EDITABLE_SECTIONS = new Set([1, 5]);
const RECENT_DECISIONS_LIMIT = 12;

const SECTIONS = [
  {
    number: 1,
    title: 'Onde estou',
    hint: 'máquina, papel, estado atual, última sessão',
    editable: true,
    defaultBody: '- Mensagem: ainda não registrado.\n- Estado: projeto recém-aberto no Duck Hermes Studio.',
  },
  {
    number: 2,
    title: 'O que estou construindo',
    hint: 'objetivo da sessão',
    editable: false,
    defaultBody: '- Objetivo: evoluir o Duck Hermes Studio em fases pequenas e verificáveis.',
  },
  {
    number: 3,
    title: 'Ferramentas à disposição',
    hint: 'gerada dinamicamente pela detecção',
    editable: false,
    defaultBody: null,
  },
  {
    number: 4,
    title: 'Convenções',
    hint: 'indentação, idioma',
    editable: false,
    defaultBody: '- Código e comentários em português.\n- Indentação de 2 espaços, sem ponto e vírgula opcional fora do padrão do arquivo.\n- Mudanças pequenas, sempre verificadas.',
  },
  {
    number: 5,
    title: 'Decisões recentes',
    hint: 'não reabrir sem motivo',
    editable: true,
    defaultBody: '- Nenhuma decisão registrada ainda.',
  },
  {
    number: 6,
    title: 'O que NÃO fazer',
    hint: 'limites explícitos',
    editable: false,
    defaultBody:
      '- Não gravar arquivos sem aprovação no diff.\n- Não executar comandos fora do runner.\n- Não adicionar dependências sem necessidade.',
  },
  {
    number: 7,
    title: 'Como me situar se eu (IA) me perder',
    hint: 'passos de recuperação',
    editable: false,
    defaultBody:
      '- Leia este arquivo inteiro antes de agir.\n- Use read_file para confirmar o estado real.\n- Se o contexto estourar, resuma a seção 5 e continue.',
  },
];

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function sectionHeading(section) {
  return `## ${section.number}. ${section.title}`;
}

function toolListMarkdown() {
  // require tardio: tools.js também depende deste módulo
  const tools = require('./tools');

  return tools
    .listDefinitions()
    .map((tool) => {
      const where = tools.CLIENT_TOOLS.has(tool.function.name) ? 'navegador' : 'backend';
      return `- \`${tool.function.name}\` (${where}): ${tool.function.description}`;
    })
    .join('\n');
}

function renderDefaultDocument() {
  return [
    '# AGENTS.md',
    '',
    'Memória viva do projeto, lida no início de cada turno e atualizada ao fim.',
    '',
    ...SECTIONS.flatMap((section) => [
      sectionHeading(section),
      '',
      section.number === 3 ? toolListMarkdown() : section.defaultBody,
      '',
    ]),
  ].join('\n');
}

function parseSections(markdown) {
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
  const found = new Map();
  let current = null;

  for (const line of lines) {
    const match = line.match(/^##\s+(\d+)\.\s+(.*)$/);
    if (match) {
      current = { number: Number(match[1]), title: match[2].trim(), body: [] };
      found.set(current.number, current);
      continue;
    }
    if (current) current.body.push(line);
  }

  return found;
}

function serializeSections(existing, overrides) {
  const parts = ['# AGENTS.md', '', 'Memória viva do projeto, lida no início de cada turno e atualizada ao fim.', ''];

  for (const section of SECTIONS) {
    const saved = existing.get(section.number);
    let body = overrides && Object.prototype.hasOwnProperty.call(overrides, section.number)
      ? overrides[section.number]
      : saved
        ? saved.body.join('\n').trim()
        : section.number === 3
          ? toolListMarkdown()
          : section.defaultBody || '';

    if (section.number === 3) body = toolListMarkdown();

    parts.push(sectionHeading(section), '', body || '', '');
  }

  return parts.join('\n').replace(/\n{3,}/g, '\n\n');
}

function agentsPath() {
  return fileStore.resolvePath(FILE_NAME);
}

async function readRaw() {
  try {
    return await fsp.readFile(agentsPath(), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function ensureDocument() {
  const existing = await readRaw();
  if (existing !== null) return existing;

  const document = renderDefaultDocument();
  await fsp.writeFile(agentsPath(), document, 'utf8');
  return document;
}

function summarize(markdown) {
  const sections = parseSections(markdown);
  return SECTIONS.map((section) => ({
    number: section.number,
    title: section.title,
    hint: section.hint,
    editable: section.editable,
    content: sections.has(section.number)
      ? sections.get(section.number).body.join('\n').trim()
      : section.number === 3
        ? toolListMarkdown()
        : section.defaultBody || '',
  }));
}

async function readAgents() {
  const markdown = await ensureDocument();
  const bytes = Buffer.byteLength(markdown, 'utf8');
  const lines = markdown.split('\n').length;

  return {
    path: FILE_NAME,
    bytes,
    lines,
    tooLong: lines > MAX_LINES || bytes > MAX_BYTES,
    sections: summarize(markdown),
  };
}

async function updateSection(rawSection, content) {
  const number = Number(rawSection);
  const section = SECTIONS.find((item) => item.number === number);

  if (!section) throw httpError('seção inexistente', 400);
  if (!section.editable) {
    throw httpError(
      `a seção ${number} é somente leitura nesta fase (editáveis: ${[...EDITABLE_SECTIONS].join(', ')})`,
      403
    );
  }
  if (typeof content !== 'string') throw httpError('conteúdo deve ser texto', 400);

  const trimmed = content.trim();
  if (trimmed.length > 4000) throw httpError('conteúdo da seção muito longo (máx. 4000)', 413);

  const current = await ensureDocument();
  const parsed = parseSections(current);
  const next = serializeSections(parsed, { [number]: trimmed });

  if (Buffer.byteLength(next, 'utf8') > MAX_BYTES) {
    throw httpError('AGENTS.md ultrapassaria 64 KB', 413);
  }

  const temporary = `${agentsPath()}.${process.pid}.tmp`;
  await fsp.writeFile(temporary, next, 'utf8');
  await fsp.rename(temporary, agentsPath());

  return readAgents();
}

function decisionLine(summary) {
  const text = String(summary || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);

  if (!text) return null;
  return `- ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · ${text}`;
}

async function appendDecision(summary) {
  const line = decisionLine(summary);
  if (!line) throw httpError('resumo vazio', 400);

  const current = await ensureDocument();
  const parsed = parseSections(current);
  const existing = parsed.has(5) ? parsed.get(5).body.join('\n').trim() : '';

  const lines = existing
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item && !/^-?\s*Nenhuma decisão registrada ainda\.?$/i.test(item));

  lines.push(line);

  const next = serializeSections(parsed, { 5: lines.slice(-RECENT_DECISIONS_LIMIT).join('\n') });
  await fsp.writeFile(agentsPath(), next, 'utf8');
  return readAgents();
}

async function buildContext() {
  try {
    const markdown = await ensureDocument();
    const clipped =
      markdown.length > MAX_INJECT_CHARS
        ? `${markdown.slice(0, MAX_INJECT_CHARS)}\n\n… (AGENTS.md truncado; use read_file para o restante)`
        : markdown;

    return {
      path: FILE_NAME,
      content: clipped,
      truncated: markdown.length > MAX_INJECT_CHARS,
      prompt: [
        'Memória do projeto (AGENTS.md) — leia antes de agir e respeite as seções 6 e 7:',
        clipped,
      ].join('\n\n'),
    };
  } catch (error) {
    return { path: FILE_NAME, content: '', truncated: false, prompt: '', error: error.message };
  }
}

module.exports = {
  FILE_NAME,
  SECTIONS,
  EDITABLE_SECTIONS,
  MAX_LINES,
  readAgents,
  updateSection,
  appendDecision,
  buildContext,
  renderDefaultDocument,
  parseSections,
  agentsPath,
};
