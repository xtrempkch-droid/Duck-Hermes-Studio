const STORAGE_KEY = 'duck-hermes-files';
const LEGACY_STORAGE_KEY = 'win98-hermes-files';
const PATHS_STORAGE_KEY = 'duck-hermes-paths';
const ACTIVE_STORAGE_KEY = 'duck-hermes-active';
const PROVIDER_STORAGE_KEY = 'duck-hermes-provider';
const FILES_PANEL_STORAGE_KEY = 'duck-hermes-files-panel';
const ONBOARD_STORAGE_KEY = 'duck-hermes-onboarded';

const DEFAULT_FILES = {
  'index.html': `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Preview</title>
</head>
<body>
  <h1>Hello</h1>
  <script>console.log('Hermes Studio pronto')</script>
</body>
</html>
`,
  'style.css': `body { font-family: sans-serif; padding: 20px; }
`,
  'script.js': `console.log('script.js carregado');
`,
  'data.json': `{
  "projeto": "Duck Hermes Studio",
  "fase": 1,
  "viewers": ["html", "css", "javascript", "json", "markdown"],
  "ativo": true
}
`,
  'notes.md': `# Notas do projeto

O **Bloco 2** agora é um visualizador contextual: as abas mudam conforme o
tipo do arquivo ativo.

- \`index.html\` e \`style.css\` → Preview e Console
- \`script.js\` → Executar e Console
- \`data.json\` → Árvore e Texto
- \`notes.md\` → Preview e Texto

> Edite este texto e use Preview para ver o resultado.
`,
};

function loadStorage() {
  const files = { ...DEFAULT_FILES };
  let diskPaths = {};
  let activeFile = 'index.html';

  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      for (const name of Object.keys(saved || {})) {
        if (typeof saved[name] === 'string') files[name] = saved[name];
      }
    }

    const rawPaths = localStorage.getItem(PATHS_STORAGE_KEY);
    if (rawPaths) {
      const savedPaths = JSON.parse(rawPaths);
      for (const name of Object.keys(savedPaths || {})) {
        if (typeof savedPaths[name] === 'string') diskPaths[name] = savedPaths[name];
      }
    }
  } catch (error) {
    console.warn('Não foi possível restaurar os arquivos salvos.', error);
    diskPaths = {};
  }

  for (const name of Object.keys(diskPaths)) {
    if (typeof files[name] !== 'string') delete diskPaths[name];
  }

  const savedActive = localStorage.getItem(ACTIVE_STORAGE_KEY);
  if (savedActive && typeof files[savedActive] === 'string') activeFile = savedActive;

  return { files, diskPaths, activeFile };
}

const initialStorage = loadStorage();

const state = {
  files: initialStorage.files,
  media: {},
  diskPaths: initialStorage.diskPaths,
  savedSnapshots: { ...initialStorage.files },
  workspace: null,
  fileModalMode: 'open',
  fileModalDir: '',
  activeFile: initialStorage.activeFile,
  activeProvider: localStorage.getItem(PROVIDER_STORAGE_KEY) || 'demo',
  activeModel: null,
  farm: null,
  chatHistory: [],
  tools: [],
  viewerTab: 'preview',
  errorCount: 0,
  github: null,
  githubFile: null,
  folderBrowsePath: '',
  gitSyncPending: null,
};

const elements = {
  frame: document.getElementById('preview-frame'),
  viewerTabs: document.getElementById('viewer-tabs'),
  consolePanel: document.getElementById('console-panel'),
  treePanel: document.getElementById('tree-panel'),
  textPanel: document.getElementById('text-panel'),
  mediaPanel: document.getElementById('media-panel'),
  binaryPanel: document.getElementById('binary-panel'),
  codePanel: document.getElementById('code-panel'),
  cursor: document.getElementById('status-cursor'),
  provider: document.getElementById('status-provider'),
  errors: document.getElementById('status-errors'),
  fileStatus: document.getElementById('status-file'),
  editorTabs: document.getElementById('editor-tabs'),
  saveButton: document.getElementById('save-label'),
  saveAction: document.getElementById('btn-save'),
  menuToggle: document.getElementById('btn-menu'),
  menuPanel: document.getElementById('menu-panel'),
  filesMenuLabel: document.getElementById('files-menu-label'),
  saveAsButton: document.getElementById('btn-save-as'),
  openButton: document.getElementById('btn-open'),
  fileModal: document.getElementById('file-modal'),
  fileModalTitle: document.getElementById('file-modal-title'),
  fileRoot: document.getElementById('file-root'),
  filePath: document.getElementById('file-path'),
  fileList: document.getElementById('file-list'),
  fileStatusText: document.getElementById('file-status'),
  fileConfirm: document.getElementById('btn-file-confirm'),
  farmModal: document.getElementById('farm-modal'),
  farmStatus: document.getElementById('farm-status'),
  farmProviders: document.getElementById('farm-providers'),
  farmDocker: document.getElementById('farm-docker'),
  farmRefresh: document.getElementById('btn-farm-refresh'),
  apiKeys: document.getElementById('api-keys'),
  apiKeysStatus: document.getElementById('api-keys-status'),
  setupModal: document.getElementById('setup-modal'),
  setupSummary: document.getElementById('setup-summary'),
  setupProviders: document.getElementById('setup-providers'),
  setupCapabilities: document.getElementById('setup-capabilities'),
  setupRefresh: document.getElementById('btn-setup-refresh'),
  chatDemoHint: document.getElementById('chat-demo-hint'),
  machineList: document.getElementById('machine-list'),
  machineForm: document.getElementById('machine-form'),
  runnerOutput: document.getElementById('runner-output'),
  docsFilter: document.getElementById('docs-filter'),
  docsFilterCount: document.getElementById('docs-filter-count'),
  docsFrame: document.getElementById('docs-frame'),
  agentsModal: document.getElementById('agents-modal'),
  agentsMeta: document.getElementById('agents-meta'),
  agentsStatus: document.getElementById('agents-status'),
  agentsSections: document.getElementById('agents-sections'),
  execModal: document.getElementById('exec-modal'),
  execDetails: document.getElementById('exec-details'),
  execStatus: document.getElementById('exec-status'),
  execApprove: document.getElementById('btn-exec-approve'),
  filesPanel: document.getElementById('block-files'),
  filesTree: document.getElementById('files-tree'),
  filesRoot: document.getElementById('files-root'),
  filesStatus: document.getElementById('files-status'),
  filesToggle: document.getElementById('btn-files'),
  diffModal: document.getElementById('diff-modal'),
  diffTitle: document.getElementById('diff-title'),
  diffStats: document.getElementById('diff-stats'),
  diffPath: document.getElementById('diff-path'),
  diffView: document.getElementById('diff-view'),
  diffStatus: document.getElementById('diff-status'),
  diffApprove: document.getElementById('btn-diff-approve'),
  diffReject: document.getElementById('btn-diff-reject'),
  chatFeed: document.getElementById('chat-feed'),
  chatInput: document.getElementById('chat-input'),
  sendButton: document.getElementById('btn-send'),
  docsModal: document.getElementById('docs-modal'),
  docsList: document.getElementById('docs-list'),
  docsStatus: document.getElementById('docs-status'),
  docsResults: document.getElementById('docs-results'),
  docsSearchArea: document.getElementById('docs-search-area'),
  docsSearchDocset: document.getElementById('docs-search-docset'),
  docsSearchInput: document.getElementById('docs-search-input'),
  workspaceMenuName: document.getElementById('workspace-menu-name'),
  githubMenuState: document.getElementById('github-menu-state'),
  folderModal: document.getElementById('folder-modal'),
  folderCurrent: document.getElementById('folder-current'),
  folderPath: document.getElementById('folder-path'),
  folderShortcuts: document.getElementById('folder-shortcuts'),
  folderRecent: document.getElementById('folder-recent'),
  folderList: document.getElementById('folder-list'),
  folderStatus: document.getElementById('folder-status'),
  folderChoose: document.getElementById('btn-folder-choose'),
  githubModal: document.getElementById('github-modal'),
  githubStatus: document.getElementById('github-status'),
  githubAccount: document.getElementById('github-account'),
  githubForm: document.getElementById('github-form'),
  githubToken: document.getElementById('github-token'),
  githubName: document.getElementById('github-name'),
  githubEmail: document.getElementById('github-email'),
  githubFile: document.getElementById('github-file'),
  githubSave: document.getElementById('btn-github-save'),
  gitRemote: document.getElementById('git-remote'),
  gitSyncStatus: document.getElementById('git-sync-status'),
  gitFetch: document.getElementById('btn-git-fetch'),
  gitPull: document.getElementById('btn-git-pull'),
  gitPush: document.getElementById('btn-git-push'),
  gitPushConfirm: document.getElementById('btn-git-push-confirm'),
  gitPullConfirm: document.getElementById('btn-git-pull-confirm'),
  gitSyncCancel: document.getElementById('btn-git-sync-cancel'),
  newFileModal: document.getElementById('new-file-modal'),
  newFileName: document.getElementById('new-file-name'),
  newFilePreview: document.getElementById('new-file-preview'),
  newFileStatus: document.getElementById('new-file-status'),
};

let editorView = null;
let fallbackEditor = null;
let languageCompartment = null;
let editableCompartment = null;
let editorModules = null;
let codeViewer = null;
let makeLanguageExtension = null;
let sendInFlight = false;
let saveStatusTimer = null;
let docsets = [];
let docsFilterValue = '';
let pendingPatchId = null;
let diffInFlight = false;
let diffResolver = null;
let diffContext = { fromActiveTab: false };
let agentsDocument = null;
let agentsWrote = false;
const fileTreeCache = new Map();
const expandedDirs = new Set(['']);
let activeTreePath = null;
let lastPythonRun = null;
let execInFlight = false;
let agentRunning = false;
const MAX_TOOL_STEPS = 6;
const rendered = { preview: null, run: null };

const VIEWER_TABS = {
  html: [
    { id: 'preview', label: 'Preview' },
    { id: 'console', label: 'Console' },
  ],
  css: [
    { id: 'preview', label: 'Preview' },
    { id: 'console', label: 'Console' },
  ],
  javascript: [
    { id: 'run', label: 'Executar' },
    { id: 'console', label: 'Console' },
  ],
  json: [
    { id: 'tree', label: 'Árvore' },
    { id: 'text', label: 'Texto' },
  ],
  markdown: [
    { id: 'preview', label: 'Preview' },
    { id: 'text', label: 'Texto' },
  ],
  python: [
    { id: 'code', label: 'Código' },
    { id: 'run', label: 'Executar' },
    { id: 'console', label: 'Console' },
  ],
  yaml: [
    { id: 'tree', label: 'Árvore' },
    { id: 'text', label: 'Texto' },
  ],
  toml: [
    { id: 'tree', label: 'Árvore' },
    { id: 'text', label: 'Texto' },
  ],
  code: [
    { id: 'code', label: 'Código' },
    { id: 'text', label: 'Texto' },
  ],
  image: [{ id: 'media', label: 'Imagem' }],
  pdf: [{ id: 'media', label: 'PDF' }],
  binary: [{ id: 'binary', label: 'Binário' }],
  text: [{ id: 'text', label: 'Texto' }],
};

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif'];
const EXTRA_CODE_EXTS = [
  'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'rs', 'go', 'java', 'kt', 'kts', 'rb', 'php',
  'sh', 'bash', 'zsh', 'ps1', 'sql', 'xml', 'ini', 'conf', 'cfg', 'env', 'lua',
  'swift', 'r', 'pl', 'dart', 'vue', 'svelte', 'scss', 'less',
];

function extensionOf(fileName) {
  const name = String(fileName || '');
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

function fileKind(fileName) {
  const ext = extensionOf(fileName);
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'css') return 'css';
  if (['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx'].includes(ext)) return 'javascript';
  if (ext === 'json') return 'json';
  if (ext === 'yaml' || ext === 'yml') return 'yaml';
  if (ext === 'toml') return 'toml';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'py' || ext === 'pyw') return 'python';
  if (ext === 'pdf') return 'pdf';
  if (IMAGE_EXTS.includes(ext)) return 'image';
  if (EXTRA_CODE_EXTS.includes(ext)) return 'code';
  return 'text';
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function updateCursorFromState(editorState) {
  const position = editorState.selection.main.head;
  const line = editorState.doc.lineAt(position);
  const column = position - line.from + 1;
  elements.cursor.textContent = `Ln ${line.number}, Col ${column}`;
}

function updateFallbackCursor() {
  if (!fallbackEditor) return;
  const position = fallbackEditor.selectionStart;
  const before = fallbackEditor.value.slice(0, position);
  const lines = before.split('\n');
  elements.cursor.textContent = `Ln ${lines.length}, Col ${lines[lines.length - 1].length + 1}`;
}

function updateErrorStatus() {
  elements.errors.textContent = `Erros: ${state.errorCount}`;
}

function createFallbackEditor(container) {
  const textarea = document.createElement('textarea');
  textarea.id = 'fallback-editor';
  textarea.spellcheck = false;
  textarea.value = state.files[state.activeFile];

  textarea.addEventListener('input', () => {
    state.files[state.activeFile] = textarea.value;
    refreshTabStates();
    if (state.viewerTab === 'tree' || state.viewerTab === 'text') renderViewer();
  });
  for (const eventName of ['keyup', 'click', 'select']) {
    textarea.addEventListener(eventName, updateFallbackCursor);
  }

  container.appendChild(textarea);
  fallbackEditor = textarea;
  updateFallbackCursor();
}

async function initEditor() {
  const container = document.getElementById('editor-container');

  try {
    const [codemirror, stateModule, htmlModule, cssModule, javascriptModule] = await Promise.all([
      import('codemirror'),
      import('@codemirror/state'),
      import('@codemirror/lang-html'),
      import('@codemirror/lang-css'),
      import('@codemirror/lang-javascript'),
    ]);

    const { EditorView, basicSetup } = codemirror;
    const { EditorState, Compartment } = stateModule;

    editorModules = { EditorState, EditorView };
    editableCompartment = new Compartment();

    makeLanguageExtension = (fileName) => {
      const kind = fileKind(fileName);
      if (kind === 'html') return htmlModule.html();
      if (kind === 'css') return cssModule.css();
      if (kind === 'javascript' || kind === 'json') return javascriptModule.javascript();
      return [];
    };

    languageCompartment = new Compartment();

    editorView = new EditorView({
      state: EditorState.create({
        doc: state.files[state.activeFile],
        extensions: [
          basicSetup,
          languageCompartment.of(makeLanguageExtension(state.activeFile)),
          editableCompartment.of(EditorView.editable.of(!state.media[state.activeFile])),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              state.files[state.activeFile] = update.state.doc.toString();
              refreshTabStates();
              if (state.viewerTab === 'tree' || state.viewerTab === 'text') renderViewer();
            }
            if (update.docChanged || update.selectionSet) {
              updateCursorFromState(update.state);
            }
          }),
        ],
      }),
      parent: container,
    });

    updateCursorFromState(editorView.state);
  } catch (error) {
    console.error('CodeMirror não pôde ser carregado; usando editor simples.', error);
    createFallbackEditor(container);
  }
}

function buildPreviewDocument() {
  const style = `<style>${state.files['style.css'].replace(/<\/style/gi, '<\\/style')}</style>`;
  const script = `<script>${state.files['script.js'].replace(/<\/script/gi, '<\\/script')}</script>`;

  const headInjection = consoleInterceptor() + style;
  const bodyInjection = script;

  let document = state.files['index.html'];

  if (/<\/head>/i.test(document)) {
    document = document.replace(/<\/head>/i, `${headInjection}</head>`);
  } else if (/<html[^>]*>/i.test(document)) {
    document = document.replace(/<html[^>]*>/i, (match) => `${match}<head>${headInjection}</head>`);
  } else {
    document = `<head>${headInjection}</head>${document}`;
  }

  if (/<\/body>/i.test(document)) {
    document = document.replace(/<\/body>/i, `${bodyInjection}</body>`);
  } else {
    document += bodyInjection;
  }

  return document;
}

function addConsoleLine(level, data) {
  const line = document.createElement('div');
  line.className = `console-line ${level}`;

  const timestamp = document.createElement('span');
  timestamp.className = 'console-time';
  timestamp.textContent = new Date().toLocaleTimeString('pt-BR');

  const message = document.createElement('span');
  message.textContent = String(data);

  line.append(timestamp, message);
  elements.consolePanel.appendChild(line);
  elements.consolePanel.scrollTop = elements.consolePanel.scrollHeight;

  if (level === 'error') {
    state.errorCount += 1;
    updateErrorStatus();
  }
}

function clearConsole() {
  elements.consolePanel.textContent = '';
  state.errorCount = 0;
  updateErrorStatus();
}

function addChatMessage(role, text) {
  const message = document.createElement('div');
  message.className = `chat-msg ${role}`;
  message.textContent = text;
  elements.chatFeed.appendChild(message);
  elements.chatFeed.scrollTop = elements.chatFeed.scrollHeight;
  return message;
}

function addToolMessage(text) {
  return addChatMessage('tool', text);
}

function summarizeArguments(args) {
  const entries = Object.entries(args || {});
  if (entries.length === 0) return '';

  return entries
    .map(([key, value]) => {
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      const short = text.length > 60 ? `${text.slice(0, 57)}…` : text;
      return `${key}=${short.replace(/\n/g, '⏎')}`;
    })
    .join(', ');
}

function parseTextToolCall(content) {
  if (typeof content !== 'string') return null;

  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [];
  if (fenced) candidates.push(fenced[1]);
  candidates.push(content);

  for (const candidate of candidates) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) continue;

    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1));
      const name = parsed.tool || parsed.name || parsed.function;
      const args = parsed.arguments || parsed.args || parsed.parameters || {};
      if (typeof name === 'string' && name) return { name, arguments: args };
    } catch (error) {
      // tenta o próximo candidato
    }
  }

  return null;
}

function consoleErrors() {
  return [...elements.consolePanel.querySelectorAll('.console-line.error')].map((line) =>
    line.textContent.replace(/\d{2}:\d{2}:\d{2}/, '').trim()
  );
}

async function executeToolCall(call) {
  const name = call.function && call.function.name;
  const raw = call.function && call.function.arguments;

  let args = {};
  try {
    args = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw || {};
  } catch (error) {
    return { ok: false, error: 'argumentos da ferramenta não são JSON válido' };
  }

  if (name === 'run_preview') {
    renderViewer({ force: true });
    return { ok: true, note: 'visualizador recarregado' };
  }

  if (name === 'get_errors') {
    const errors = consoleErrors();
    return { ok: true, count: errors.length, errors };
  }

  const data = await requestJson('/api/tools/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, arguments: args }),
  });

  if (data.requiresApproval) {
    addToolMessage(
      `Aguardando aprovação: ${data.path} (+${data.stats.added} −${data.stats.removed})`
    );
    const decision = await awaitPatchApproval({ ...data, id: data.patchId }, { fromActiveTab: false });
    if (decision.approved) {
      return {
        ok: true,
        applied: true,
        path: data.path,
        stats: data.stats,
        note: 'alteração aprovada e gravada',
      };
    }
    return {
      ok: false,
      rejected: true,
      path: data.path,
      note: 'o usuário descartou a alteração; nada foi gravado',
    };
  }

  return data;
}

async function postLlm(payload) {
  const response = await fetch('/api/llm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

function toolsSystemPrompt(agentsContext) {
  const names = state.tools
    .map((tool) => `${tool.function.name}: ${tool.function.description}`)
    .join('\n');

  return [
    agentsContext || '',
    'Você pode usar ferramentas para ler e propor alterações em arquivos do projeto.',
    'Para chamar uma ferramenta responda SOMENTE com um bloco JSON:',
    '{"tool": "nome", "arguments": { ... }}',
    'Ferramentas disponíveis:',
    names,
    'Nunca invente conteúdo de arquivos: use read_file antes de editar.',
  ].join('\n');
}

function trimHistory() {
  const limit = 40;
  if (state.chatHistory.length <= limit) return;

  let start = state.chatHistory.length - limit;
  while (start < state.chatHistory.length && state.chatHistory[start].role === 'tool') {
    start += 1;
  }
  state.chatHistory = state.chatHistory.slice(start);
}

async function runAgentTurn(userText) {
  agentsWrote = false;
  state.chatHistory.push({ role: 'user', content: userText });
  trimHistory();

  let nativeTools = state.tools.length > 0;
  let step = 0;
  let agentsContext = '';

  try {
    const context = await requestJson('/api/agents/context');
    agentsContext = context.prompt || '';
  } catch (error) {
    agentsContext = '';
  }

  while (step < MAX_TOOL_STEPS) {
    const payload = {
      provider: state.activeProvider,
      model: state.activeModel || undefined,
      messages: nativeTools
        ? [{ role: 'system', content: agentsContext || 'Siga as convenções do projeto.' }, ...state.chatHistory]
        : [{ role: 'system', content: toolsSystemPrompt(agentsContext) }, ...state.chatHistory],
      stream: false,
    };

    if (nativeTools) payload.tools = state.tools;

    let data;
    try {
      data = await postLlm(payload);
    } catch (error) {
      if (nativeTools && /tool|function|400|422/i.test(error.message)) {
        nativeTools = false;
        continue;
      }
      throw error;
    }

    const toolCalls = Array.isArray(data.toolCalls) ? data.toolCalls : [];

    if (toolCalls.length === 0) {
      const content = data.content || '';
      const fallbackCall = nativeTools ? null : parseTextToolCall(content);

      if (fallbackCall) {
        state.chatHistory.push({ role: 'assistant', content });
        if (['write_file', 'edit_file', 'update_agents_md'].includes(fallbackCall.name)) {
          agentsWrote = true;
        }
        addToolMessage(`🔧 ${fallbackCall.name}(${summarizeArguments(fallbackCall.arguments)})`);
        let result;
        try {
          result = await executeToolCall({
            function: { name: fallbackCall.name, arguments: JSON.stringify(fallbackCall.arguments) },
          });
        } catch (error) {
          result = { ok: false, error: error.message };
        }

        state.chatHistory.push({
          role: 'user',
          content: `Resultado de ${fallbackCall.name}: ${JSON.stringify(result).slice(0, 4000)}`,
        });
        step += 1;
        continue;
      }

      state.chatHistory.push({ role: 'assistant', content });
      addChatMessage('assistant', content || '(resposta vazia)');

      if (agentsWrote) {
        agentsWrote = false;
        fetch('/api/agents/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ summary: userText.slice(0, 150) }),
        }).catch(() => {});
      }
      return;
    }

    const normalized = toolCalls.map((call, index) => ({
      ...call,
      id: call.id || `call_${step}_${index}`,
    }));

    state.chatHistory.push({
      role: 'assistant',
      content: data.content || '',
      tool_calls: normalized,
    });

    for (const call of normalized) {
      let parsedArgs = {};
      try {
        parsedArgs = JSON.parse(call.function.arguments || '{}');
      } catch (error) {
        parsedArgs = {};
      }

      if (['write_file', 'edit_file', 'update_agents_md'].includes(call.function.name)) {
        agentsWrote = true;
      }
      addToolMessage(`🔧 ${call.function.name}(${summarizeArguments(parsedArgs)})`);

      let result;
      try {
        result = await executeToolCall(call);
      } catch (error) {
        result = { ok: false, error: error.message };
      }

      state.chatHistory.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result).slice(0, 8000),
      });
    }

    step += 1;
  }

  addChatMessage('error', `Limite de ${MAX_TOOL_STEPS} passos de ferramentas atingido.`);
}

async function loadTools() {
  try {
    const data = await requestJson('/api/tools');
    state.tools = Array.isArray(data.tools) ? data.tools : [];
  } catch (error) {
    state.tools = [];
  }
}

function setAgentsStatus(message, isError) {
  elements.agentsStatus.textContent = message || '';
  elements.agentsStatus.classList.toggle('error', Boolean(isError));
}

function renderAgents(agents) {
  agentsDocument = agents;
  elements.agentsMeta.textContent = `${agents.lines} linhas · ${Math.round(agents.bytes / 1024)} KB${agents.tooLong ? ' · acima do recomendado (200 linhas)' : ''}`;
  elements.agentsSections.textContent = '';

  for (const section of agents.sections) {
    const wrapper = document.createElement('section');
    wrapper.className = 'agents-section';

    const heading = document.createElement('h3');
    heading.append(document.createTextNode(`${section.number}. ${section.title}`));

    const hint = document.createElement('span');
    hint.className = 'agents-hint';
    hint.textContent = `— ${section.hint}`;
    heading.appendChild(hint);

    if (!section.editable) {
      const badge = document.createElement('span');
      badge.className = 'agents-readonly';
      badge.textContent = 'somente leitura';
      heading.appendChild(badge);
    }

    wrapper.appendChild(heading);

    if (section.editable) {
      const textarea = document.createElement('textarea');
      textarea.value = section.content;
      textarea.spellcheck = false;
      wrapper.appendChild(textarea);

      const actions = document.createElement('div');
      actions.className = 'agents-actions';

      const save = document.createElement('button');
      save.type = 'button';
      save.textContent = `Salvar seção ${section.number}`;
      save.addEventListener('click', async () => {
        save.disabled = true;
        setAgentsStatus(`Salvando seção ${section.number}…`);
        try {
          const updated = await requestJson('/api/agents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ section: section.number, content: textarea.value }),
          });
          renderAgents(updated);
          setAgentsStatus(`Seção ${section.number} salva.`);
        } catch (error) {
          setAgentsStatus(error.message, true);
        } finally {
          save.disabled = false;
        }
      });

      actions.appendChild(save);
      wrapper.appendChild(actions);
    } else {
      const pre = document.createElement('pre');
      pre.textContent = section.content;
      wrapper.appendChild(pre);
    }

    elements.agentsSections.appendChild(wrapper);
  }
}

function loadAgentsDocument() {
  requestJson('/api/agents')
    .then((data) => {
      agentsDocument = data;
    })
    .catch(() => {
      agentsDocument = null;
    });
}

async function openAgentsModal() {
  elements.agentsModal.classList.remove('hidden');
  elements.agentsSections.textContent = '';
  setAgentsStatus('Carregando AGENTS.md…');

  try {
    const data = await requestJson('/api/agents');
    renderAgents(data);
    setAgentsStatus(`Arquivo: ${data.path} — seções 1 e 5 são editáveis.`);
  } catch (error) {
    setAgentsStatus(`Erro ao carregar: ${error.message}`, true);
  }
}

function closeAgentsModal() {
  elements.agentsModal.classList.add('hidden');
}

async function sendChat() {
  const text = elements.chatInput.value.trim();
  if (!text || sendInFlight) return;

  sendInFlight = true;
  elements.sendButton.disabled = true;
  elements.chatInput.value = '';
  addChatMessage('user', text);

  try {
    await runAgentTurn(text);
  } catch (error) {
    addChatMessage('error', `Erro: ${error.message}`);
  } finally {
    sendInFlight = false;
    elements.sendButton.disabled = false;
    elements.chatInput.focus();
  }
}

function persistLocal() {
  try {
    const textFiles = {};
    for (const name of Object.keys(state.files)) {
      if (!state.media[name]) textFiles[name] = state.files[name];
    }

    const textPaths = {};
    for (const name of Object.keys(state.diskPaths)) {
      if (!state.media[name]) textPaths[name] = state.diskPaths[name];
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(textFiles));
    localStorage.setItem(PATHS_STORAGE_KEY, JSON.stringify(textPaths));
    if (!state.media[state.activeFile]) {
      localStorage.setItem(ACTIVE_STORAGE_KEY, state.activeFile);
    }
    return true;
  } catch (error) {
    console.warn('Não foi possível salvar no armazenamento local.', error);
    return false;
  }
}

function flashSaveButton(label) {
  elements.saveButton.textContent = label;
  elements.menuToggle.textContent = `☰ ${label}`;

  clearTimeout(saveStatusTimer);
  saveStatusTimer = setTimeout(() => {
    elements.saveButton.textContent = 'Salvar';
    elements.menuToggle.textContent = '☰ Arquivo';
  }, 1500);
}

function isDirty(fileName) {
  return state.files[fileName] !== state.savedSnapshots[fileName];
}

function refreshTabStates() {
  for (const tab of elements.editorTabs.children) {
    const name = tab.dataset.file;
    tab.classList.toggle('active', name === state.activeFile);
    tab.classList.toggle('dirty', isDirty(name));
  }
  markTreeActive();
}

function renderEditorTabs() {
  const names = Object.keys(state.files);
  elements.editorTabs.textContent = '';

  for (const name of names) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'editor-tab';
    tab.dataset.file = name;
    tab.title = state.media[name]
      ? `${state.diskPaths[name] || name} — pré-visualização (somente leitura)`
      : state.diskPaths[name] || `${name} — sem arquivo em disco`;

    const label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = name;
    tab.appendChild(label);

    if (names.length > 1) {
      const close = document.createElement('span');
      close.className = 'tab-close';
      close.setAttribute('role', 'button');
      close.setAttribute('aria-label', `Fechar ${name}`);
      close.textContent = '×';
      close.addEventListener('click', (event) => {
        event.stopPropagation();
        closeFile(name);
      });
      tab.appendChild(close);
    }

    tab.classList.toggle('active', name === state.activeFile);
    tab.classList.toggle('dirty', isDirty(name));
    tab.addEventListener('click', () => setActiveFile(name));
    elements.editorTabs.appendChild(tab);
  }
}

function updateFileStatus() {
  const diskPath = state.diskPaths[state.activeFile];
  elements.fileStatus.textContent = diskPath || 'Sem arquivo em disco';
  elements.fileStatus.title = diskPath
    ? `Em disco: ${state.workspace ? `${state.workspace.root}/${diskPath}` : diskPath}`
    : 'Use "Salvar como" para escolher onde gravar';
}

function applyActiveFileToEditor(fileName) {
  const editable = !state.media[fileName];

  if (editorView) {
    const effects = [languageCompartment.reconfigure(makeLanguageExtension(fileName))];
    if (editableCompartment) {
      effects.push(editableCompartment.reconfigure(editorModules.EditorView.editable.of(editable)));
    }

    editorView.dispatch({
      changes: {
        from: 0,
        to: editorView.state.doc.length,
        insert: editable ? state.files[fileName] : '',
      },
      selection: { anchor: 0 },
      effects,
    });
  } else if (fallbackEditor) {
    fallbackEditor.value = editable ? state.files[fileName] : '';
    fallbackEditor.readOnly = !editable;
    updateFallbackCursor();
  }
}

function setActiveFile(fileName) {
  if (typeof state.files[fileName] !== 'string') return;

  state.activeFile = fileName;
  refreshTabStates();
  applyActiveFileToEditor(fileName);

  if (editorView) editorView.focus();
  else if (fallbackEditor) fallbackEditor.focus();

  state.viewerTab = null;
  renderViewer();
  updateFileStatus();
  markTreeActive();
}

function closeFile(fileName) {
  const names = Object.keys(state.files);
  if (names.length <= 1) return;

  if (isDirty(fileName) && !window.confirm(`Descartar as alterações não salvas de ${fileName}?`)) {
    return;
  }

  const index = names.indexOf(fileName);
  delete state.files[fileName];
  delete state.diskPaths[fileName];
  delete state.savedSnapshots[fileName];

  if (state.activeFile === fileName) {
    const remaining = Object.keys(state.files);
    setActiveFile(remaining[Math.min(index, remaining.length - 1)]);
  }

  renderEditorTabs();
  persistLocal();
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function baseName(filePath) {
  const parts = String(filePath).split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : String(filePath);
}

function dirName(filePath) {
  const index = String(filePath).lastIndexOf('/');
  return index === -1 ? '' : String(filePath).slice(0, index);
}

function uniqueTabName(candidate, diskPath) {
  if (typeof state.files[candidate] !== 'string') return candidate;
  if (state.diskPaths[candidate] === diskPath) return candidate;
  return diskPath;
}

function renameTab(oldName, newName) {
  if (oldName === newName || typeof state.files[newName] === 'string') return oldName;

  state.files[newName] = state.files[oldName];
  state.diskPaths[newName] = state.diskPaths[oldName];
  state.savedSnapshots[newName] = state.savedSnapshots[oldName];
  delete state.files[oldName];
  delete state.diskPaths[oldName];
  delete state.savedSnapshots[oldName];

  if (state.activeFile === oldName) state.activeFile = newName;
  return newName;
}

function setDiffStatus(message, isError) {
  elements.diffStatus.textContent = message || '';
  elements.diffStatus.classList.toggle('error', Boolean(isError));
}

function renderDiff(patch) {
  elements.diffView.textContent = '';
  const fragment = document.createDocumentFragment();
  const limit = 3000;
  const visible = patch.diff.slice(0, limit);

  for (const line of visible) {
    const row = document.createElement('div');
    row.className = `diff-line ${line.type}`;

    const gutters = document.createElement('span');
    gutters.className = 'diff-gutter';
    const oldNumber = line.oldLine === null ? '' : String(line.oldLine);
    const newNumber = line.newLine === null ? '' : String(line.newLine);
    gutters.textContent = `${oldNumber} ${newNumber}`.trim();

    const sign = document.createElement('span');
    sign.className = 'diff-sign';
    sign.textContent = line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' ';

    const text = document.createElement('span');
    text.className = 'diff-text';
    text.textContent = line.text === '' ? ' ' : line.text;

    row.append(gutters, sign, text);
    fragment.appendChild(row);
  }

  if (patch.diff.length > limit) {
    const note = document.createElement('div');
    note.className = 'diff-line context';
    note.textContent = `… ${patch.diff.length - limit} linha(s) não exibidas (limite de ${limit})`;
    fragment.appendChild(note);
  }

  elements.diffView.appendChild(fragment);
}

function openDiffModal(patch, options) {
  const settings = options || {};
  pendingPatchId = patch.id || patch.patchId;
  diffContext = { fromActiveTab: Boolean(settings.fromActiveTab) };
  diffResolver = typeof settings.onDecision === 'function' ? settings.onDecision : null;
  elements.diffModal.classList.remove('hidden');
  elements.diffTitle.textContent = 'Revisar alterações';
  elements.diffStats.textContent = `+${patch.stats.added} −${patch.stats.removed}`;
  elements.diffPath.textContent = `${patch.path}${patch.exists ? '' : ' (arquivo novo)'}`;
  elements.diffApprove.disabled = false;
  elements.diffReject.disabled = false;
  setDiffStatus('Toda gravação em arquivo existente passa por esta revisão.');
  renderDiff(patch);
}

function closeDiffModal() {
  elements.diffModal.classList.add('hidden');
  pendingPatchId = null;
  diffResolver = null;
}

function awaitPatchApproval(patch, options) {
  return new Promise((resolve) => {
    openDiffModal(patch, { ...(options || {}), onDecision: resolve });
  });
}

async function approveDiff() {
  if (!pendingPatchId || diffInFlight) return;

  diffInFlight = true;
  elements.diffApprove.disabled = true;
  elements.diffReject.disabled = true;
  setDiffStatus('Gravando…');

  try {
    const data = await applyPendingPatch(pendingPatchId, { fromActiveTab: diffContext.fromActiveTab });
    const resolver = diffResolver;
    closeDiffModal();
    if (resolver) resolver({ approved: true, result: data });
  } catch (error) {
    setDiffStatus(error.message, true);
    const patchGone = /mudou no disco|não encontrado|expirado/.test(error.message);
    if (patchGone) pendingPatchId = null;
    elements.diffApprove.disabled = patchGone;
    elements.diffReject.disabled = false;
  } finally {
    diffInFlight = false;
  }
}

async function discardDiff() {
  if (diffInFlight) return;

  if (!pendingPatchId) {
    closeDiffModal();
    return;
  }

  diffInFlight = true;
  elements.diffApprove.disabled = true;
  elements.diffReject.disabled = true;
  setDiffStatus('Descartando…');

  try {
    await requestJson('/api/patch/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: pendingPatchId }),
    });
    const resolver = diffResolver;
    closeDiffModal();
    flashSaveButton('Não gravado');
    if (resolver) resolver({ approved: false });
  } catch (error) {
    setDiffStatus(error.message, true);
  } finally {
    elements.diffApprove.disabled = false;
    elements.diffReject.disabled = false;
    diffInFlight = false;
  }
}

function finalizeFileWrite(data, options) {
  const settings = options || {};

  if (settings.fromActiveTab) {
    const newName = renameTab(state.activeFile, uniqueTabName(data.path, data.path));
    if (newName === state.activeFile) state.activeFile = newName;

    state.diskPaths[state.activeFile] = data.path;
    state.savedSnapshots[state.activeFile] = state.files[state.activeFile];
  } else {
    // Patch do agente: só mexe na aba correspondente, sem renomear a aba ativa.
    const openTab = Object.keys(state.files).find((name) => state.diskPaths[name] === data.path);
    if (openTab) {
      state.savedSnapshots[openTab] = state.files[openTab];
    }
  }

  renderEditorTabs();
  updateFileStatus();
  persistLocal();
  flashSaveButton('Salvo');
  closeFileModal();
  return data;
}

async function applyPendingPatch(id, options) {
  const data = await requestJson('/api/patch/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });

  return finalizeFileWrite(data, options);
}

async function writeActiveFileTo(targetPath) {
  const preview = await requestJson('/api/patch/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: targetPath, content: state.files[state.activeFile] }),
  });

  if (!preview.changed) return applyPendingPatch(preview.id, { fromActiveTab: true });

  closeFileModal();
  openDiffModal(preview, { fromActiveTab: true });
  return null;
}

function saveActiveFile() {
  if (state.media[state.activeFile]) {
    flashSaveButton('Somente leitura');
    setFileStatus('Imagem/PDF/binário: pré-visualização sem edição');
    return;
  }

  persistLocal();

  const diskPath = state.diskPaths[state.activeFile];
  if (!diskPath) {
    flashSaveButton('Salvo');
    openFileModal('save');
    return;
  }

  writeActiveFileTo(diskPath).catch((error) => {
    flashSaveButton('Erro ao salvar');
    window.alert(`Não foi possível salvar ${diskPath}: ${error.message}`);
  });
}

function setFilesStatus(message, isError) {
  elements.filesStatus.textContent = message || '';
  elements.filesStatus.classList.toggle('error', Boolean(isError));
}

function filesPanelVisible() {
  return !elements.filesPanel.classList.contains('hidden');
}

function treeDepth(depth) {
  return `${8 + depth * 14}px`;
}

async function listTreeDir(dirPath) {
  if (fileTreeCache.has(dirPath)) return fileTreeCache.get(dirPath);

  const query = dirPath ? `?path=${encodeURIComponent(dirPath)}` : '';
  const data = await requestJson(`/api/fs/list${query}`);
  fileTreeCache.set(dirPath, data);
  return data;
}

function activeDiskPath() {
  return state.diskPaths[state.activeFile] || null;
}

function markTreeActive() {
  activeTreePath = activeDiskPath();

  for (const row of elements.filesTree.querySelectorAll('.tree-entry')) {
    const isActive = row.dataset.path === activeTreePath;
    row.classList.toggle('active', isActive);

    const openTab = Object.keys(state.diskPaths).find(
      (name) => state.diskPaths[name] === row.dataset.path
    );
    row.dataset.tab = openTab || '';
    row.classList.toggle('dirty', Boolean(openTab && isDirty(openTab)));
  }
}

function fileNode(entry, depth) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'tree-entry';
  row.dataset.path = entry.path;
  row.style.paddingLeft = treeDepth(depth);

  const openTab = Object.keys(state.diskPaths).find((name) => state.diskPaths[name] === entry.path);
  if (openTab) row.dataset.tab = openTab;

  const caret = document.createElement('span');
  caret.className = 'tree-caret';
  caret.textContent = '·';

  const label = document.createElement('span');
  label.className = 'tree-label';
  label.textContent = entry.name;
  label.title = entry.path;

  row.append(caret, label);
  row.addEventListener('click', async () => {
    try {
      await openFileFromPath(entry.path);
      markTreeActive();
      setFilesStatus(entry.path);
    } catch (error) {
      setFilesStatus(error.message, true);
    }
  });

  return row;
}

async function appendTreeEntries(container, data, depth) {
  for (const entry of data.entries) {
    if (entry.type === 'dir') {
      container.appendChild(await dirNode(entry, depth));
    } else if (entry.type === 'file') {
      container.appendChild(fileNode(entry, depth));
    } else {
      const row = document.createElement('div');
      row.className = 'tree-entry';
      row.style.paddingLeft = treeDepth(depth);

      const label = document.createElement('span');
      label.className = 'tree-label';
      label.textContent = `${entry.name} (não suportado)`;
      label.title = entry.path;

      row.appendChild(label);
      container.appendChild(row);
    }
  }
}

async function dirNode(entry, depth) {
  const wrapper = document.createElement('div');

  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'tree-entry dir';
  row.dataset.path = entry.path;
  row.style.paddingLeft = treeDepth(depth);

  const caret = document.createElement('span');
  caret.className = 'tree-caret';
  caret.textContent = '▸';

  const label = document.createElement('span');
  label.className = 'tree-label';
  label.textContent = entry.name;
  label.title = entry.path;

  row.append(caret, label);

  const children = document.createElement('div');
  children.className = 'tree-children hidden';

  wrapper.append(row, children);

  const expand = async () => {
    if (children.dataset.loaded !== '1') {
      try {
        const listed = await listTreeDir(entry.path);
        children.textContent = '';
        await appendTreeEntries(children, listed, depth + 1);
        children.dataset.loaded = '1';
      } catch (error) {
        setFilesStatus(error.message, true);
        return;
      }
    }

    const opening = !expandedDirs.has(entry.path);
    if (opening) expandedDirs.add(entry.path);
    else expandedDirs.delete(entry.path);

    caret.textContent = opening ? '▾' : '▸';
    children.classList.toggle('hidden', !opening);
  };

  row.addEventListener('click', expand);

  if (expandedDirs.has(entry.path)) {
    await expand();
  }

  return wrapper;
}

async function renderFileTree() {
  elements.filesTree.textContent = '';
  setFilesStatus('Carregando…');

  try {
    await loadWorkspaceInfo();
    elements.filesRoot.textContent = state.workspace ? state.workspace.root : '';
    elements.filesRoot.title = elements.filesRoot.textContent;

    const root = await listTreeDir('');
    await appendTreeEntries(elements.filesTree, root, 0);
    markTreeActive();
    setFilesStatus(`${root.entries.length} item(ns) na raiz`);
  } catch (error) {
    setFilesStatus(`Erro: ${error.message}`, true);
  }
}

async function refreshFileTree() {
  fileTreeCache.clear();
  expandedDirs.clear();
  expandedDirs.add('');
  await renderFileTree();
}

function setFilesPanel(visible) {
  elements.filesPanel.classList.toggle('hidden', !visible);
  document.getElementById('resizer-files').classList.toggle('hidden', !visible);
  localStorage.setItem(FILES_PANEL_STORAGE_KEY, visible ? '1' : '0');

  syncFilesMenuItem();

  if (visible) {
    renderFileTree();
  }
}

function toggleFilesPanel() {
  setFilesPanel(!filesPanelVisible());
}

async function revealActiveInTree() {
  const diskPath = activeDiskPath();
  if (!diskPath) {
    markTreeActive();
    return;
  }

  const parts = diskPath.split('/');
  parts.pop();

  let accumulated = '';
  for (const part of parts) {
    accumulated = accumulated ? `${accumulated}/${part}` : part;
    expandedDirs.add(accumulated);
  }

  await renderFileTree();
}

function openMediaTab(targetPath, kind) {
  const known = Object.keys(state.files).find((name) => state.diskPaths[name] === targetPath);
  const name = known || uniqueTabName(baseName(targetPath), targetPath);

  state.media[name] = { path: targetPath, kind };
  state.files[name] = '';
  state.savedSnapshots[name] = '';
  state.diskPaths[name] = targetPath;
  state.activeFile = name;
  state.viewerTab = null;

  renderEditorTabs();
  applyActiveFileToEditor(name);
  renderViewer({ force: true });
  updateFileStatus();
  persistLocal();
  closeFileModal();
  markTreeActive();

  if (editorView) editorView.focus();
  else if (fallbackEditor) fallbackEditor.focus();
}

async function openFileFromPath(targetPath) {
  const targetKind = fileKind(targetPath);

  if (targetKind === 'image' || targetKind === 'pdf') {
    openMediaTab(targetPath, targetKind);
    return;
  }

  let data;
  try {
    data = await requestJson('/api/fs/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: targetPath }),
    });
  } catch (error) {
    if (/bin[aá]rio/i.test(error.message)) {
      openMediaTab(targetPath, 'binary');
      return;
    }
    throw error;
  }

  const existing = Object.keys(state.files).find((name) => state.diskPaths[name] === data.path);

  if (existing && isDirty(existing)) {
    if (!window.confirm(`${existing} tem alterações não salvas. Recarregar do disco?`)) {
      setActiveFile(existing);
      closeFileModal();
      return;
    }
  }

  const name = existing || uniqueTabName(data.path, data.path);

  state.files[name] = data.content;
  state.diskPaths[name] = data.path;
  state.savedSnapshots[name] = data.content;
  state.activeFile = name;
  state.viewerTab = null;

  renderEditorTabs();
  applyActiveFileToEditor(name);
  renderViewer({ force: true });
  updateFileStatus();
  persistLocal();
  closeFileModal();
  markTreeActive();

  if (editorView) editorView.focus();
  else if (fallbackEditor) fallbackEditor.focus();
}

function setFileStatus(message, isError) {
  elements.fileStatusText.textContent = message || '';
  elements.fileStatusText.classList.toggle('error', Boolean(isError));
}

async function loadWorkspaceInfo() {
  if (state.workspace) {
    elements.fileRoot.textContent = `Raiz do workspace: ${state.workspace.root}`;
    return state.workspace;
  }

  state.workspace = await requestJson('/api/fs/info');
  elements.fileRoot.textContent = `Raiz do workspace: ${state.workspace.root}`;
  return state.workspace;
}

async function browseDirectory(dir) {
  state.fileModalDir = dir || '';
  setFileStatus('Carregando…');
  elements.fileList.textContent = '';

  const query = state.fileModalDir ? `?path=${encodeURIComponent(state.fileModalDir)}` : '';
  let data;
  try {
    data = await requestJson(`/api/fs/list${query}`);
  } catch (error) {
    setFileStatus(`Erro ao listar: ${error.message}`, true);
    return;
  }

  if (state.fileModalMode === 'save') {
    elements.filePath.value = data.path === '.' ? '' : `${data.path}/`;
  }

  const rows = [];
  if (data.parent !== null && data.parent !== undefined) {
    rows.push({ name: '..', path: data.parent, type: 'dir', size: null });
  }
  rows.push(...data.entries);

  for (const entry of rows) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'file-row';

    const icon = document.createElement('span');
    icon.className = 'file-icon';
    icon.textContent = entry.type === 'dir' ? '▸' : '·';

    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = entry.name;

    row.append(icon, name);

    if (entry.type === 'file' && typeof entry.size === 'number') {
      const size = document.createElement('span');
      size.className = 'file-size';
      size.textContent = entry.size < 1024 ? `${entry.size} B` : `${Math.round(entry.size / 1024)} KB`;
      row.appendChild(size);
    }

    row.addEventListener('click', () => selectFileEntry(entry, data.path));
    elements.fileList.appendChild(row);
  }

  setFileStatus(`Diretório: ${data.path}${data.truncated ? ' (lista truncada)' : ''}`);
}

async function selectFileEntry(entry, currentDir) {
  if (entry.type === 'dir') {
    await browseDirectory(entry.path);
    return;
  }

  if (state.fileModalMode === 'save') {
    const prefix = currentDir === '.' ? '' : `${currentDir}/`;
    elements.filePath.value = `${prefix}${entry.name}`;
    setFileStatus(`Destino: ${elements.filePath.value}`);
    elements.filePath.focus();
    return;
  }

  await confirmFileAction(entry.path);
}

async function confirmFileAction(targetPath) {
  const pathValue = String(targetPath || elements.filePath.value || '').trim();

  if (!pathValue) {
    setFileStatus('Informe um caminho.', true);
    return;
  }

  const saving = state.fileModalMode === 'save';
  setFileStatus(saving ? 'Salvando…' : 'Abrindo…');

  try {
    if (saving) await writeActiveFileTo(pathValue);
    else await openFileFromPath(pathValue);
  } catch (error) {
    setFileStatus(error.message, true);
  }
}

async function openFileModal(mode) {
  state.fileModalMode = mode;
  elements.fileModal.classList.remove('hidden');
  elements.fileModalTitle.textContent = mode === 'save' ? 'Salvar como' : 'Abrir arquivo';
  elements.fileConfirm.textContent = mode === 'save' ? 'Salvar' : 'Abrir';
  elements.filePath.value = '';
  elements.fileList.textContent = '';
  setFileStatus('');

  try {
    await loadWorkspaceInfo();
  } catch (error) {
    setFileStatus(`Erro ao obter o workspace: ${error.message}`, true);
    return;
  }

  await browseDirectory(mode === 'save' ? dirName(state.diskPaths[state.activeFile] || '') : '');

  if (mode === 'save') {
    elements.filePath.value = state.diskPaths[state.activeFile] || state.activeFile;
  }

  elements.filePath.focus();
  elements.filePath.select();
}

function closeFileModal() {
  elements.fileModal.classList.add('hidden');
}

function consoleInterceptor() {
  return `<script>
(function(){
  function send(level,args){
    var text = Array.prototype.slice.call(args).map(function(item){
      if (typeof item === 'string') return item;
      try { return JSON.stringify(item); } catch (error) { return String(item); }
    }).join(' ');
    window.parent.postMessage({ type: 'CONSOLE_LOG', level: level, data: text }, '*');
  }
  var _log = console.log, _error = console.error, _warn = console.warn;
  console.log = function(){ send('info', arguments); _log.apply(console, arguments); };
  console.warn = function(){ send('info', arguments); _warn.apply(console, arguments); };
  console.error = function(){ send('error', arguments); _error.apply(console, arguments); };
  window.onerror = function(message){ send('error', [message]); };
  window.addEventListener('unhandledrejection', function(event){ send('error', ['Promise rejeitada: ' + event.reason]); });
})();
</script>`;
}

function activeKind() {
  const media = state.media[state.activeFile];
  if (media && media.kind) return media.kind;
  return fileKind(state.activeFile);
}

function renderViewerTabs(kind) {
  const tabs = VIEWER_TABS[kind] || VIEWER_TABS.text;
  if (!tabs.some((tab) => tab.id === state.viewerTab)) {
    state.viewerTab = tabs[0].id;
  }

  elements.viewerTabs.textContent = '';

  for (const tab of tabs) {
    const button = document.createElement('button');
    button.className = 'viewer-tab';
    button.dataset.tab = tab.id;
    button.textContent = tab.label;
    button.classList.toggle('active', tab.id === state.viewerTab);
    elements.viewerTabs.appendChild(button);
  }
}

function renderViewer(options = {}) {
  const kind = activeKind();
  if (options.force) {
    rendered.preview = null;
    rendered.run = null;
  }

  renderViewerTabs(kind);

  const tab = state.viewerTab;
  const isPython = kind === 'python';
  const usesFrame = tab === 'preview' || tab === 'run' || (tab === 'code' && isPython);

  elements.frame.classList.toggle('hidden', !usesFrame);
  elements.consolePanel.classList.toggle('hidden', tab !== 'console');
  elements.treePanel.classList.toggle('hidden', tab !== 'tree');
  elements.textPanel.classList.toggle('hidden', tab !== 'text');
  elements.mediaPanel.classList.toggle('hidden', tab !== 'media');
  elements.binaryPanel.classList.toggle('hidden', tab !== 'binary');
  elements.codePanel.classList.toggle('hidden', tab !== 'code' || isPython);

  if (tab !== 'code' || isPython) destroyCodeViewer();
  removePythonPlaceholder();

  if (tab === 'console') return;
  if (tab === 'media') {
    renderMediaPanel(kind);
    return;
  }
  if (tab === 'binary') {
    renderBinaryPanel();
    return;
  }
  if (tab === 'tree') {
    if (kind === 'json') renderJsonTree();
    else renderStructuredTree(kind);
    return;
  }
  if (tab === 'text') {
    renderTextView(kind);
    return;
  }
  if (tab === 'code') {
    if (isPython) renderCodeView(kind);
    else renderHighlightedCode();
    return;
  }
  if (tab === 'run') {
    if (isPython) {
      if (options.runNow) {
        if (options.execute) runPythonFile();
        else renderPythonReady();
      } else {
        renderPythonReady();
      }
      return;
    }
    if (options.runNow) runJavascript(true);
    else renderRunPlaceholder();
    return;
  }

  renderPreview(kind, Boolean(options.force));
}

function switchViewerTab(tab) {
  if (state.viewerTab === tab) return;
  state.viewerTab = tab;
  document.querySelectorAll('.viewer-tab').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tab);
  });
  renderViewer({ runNow: tab === 'run' && activeKind() !== 'python' });
}

function removePythonPlaceholder() {
  const existing = document.getElementById('python-placeholder');
  if (existing) existing.remove();
}

function renderCodeView(kind) {
  const source = state.files[state.activeFile] || '';
  const body = escapeHtml(source);
  elements.frame.srcdoc = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<style>
  body { margin: 0; padding: 12px 14px; background: #ffffff; }
  pre { margin: 0; font-family: 'Courier New', monospace; font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; color: #222; }
  .lineno { display: inline-block; width: 32px; color: #aaa; text-align: right; padding-right: 10px; user-select: none; }
</style></head><body><pre>${body
    .split(String.fromCharCode(10))
    .map((line, index) => `<span class="lineno">${index + 1}</span>${line}`)
    .join(String.fromCharCode(10))}</pre></body></html>`;
}

function pythonPlaceholder(messageHtml) {
  removePythonPlaceholder();

  const box = document.createElement('div');
  box.id = 'python-placeholder';
  box.className = 'python-placeholder';
  box.innerHTML = messageHtml;

  const runButton = document.createElement('button');
  runButton.type = 'button';
  runButton.textContent = 'Executar arquivo';
  runButton.addEventListener('click', runPythonFile);
  box.appendChild(runButton);

  document.getElementById('viewer-content').appendChild(box);
  return box;
}

function currentPythonRun() {
  return lastPythonRun && lastPythonRun.file === state.activeFile ? lastPythonRun : null;
}

function renderPythonReady() {
  const previous = currentPythonRun();
  const script = previous
    ? '<p>Última execução abaixo. Use <strong>Executar</strong> para rodar de novo.</p>'
    : '<p>Este visualizador executa o arquivo Python no backend, com aprovação.</p>';

  const box = pythonPlaceholder(
    `<p>${escapeHtml(state.activeFile)}</p>${script}<p class="hint">Travas: sem sudo, timeout, cwd no workspace e rede desligada por padrão.</p>`
  );

  if (previous) box.appendChild(renderExecOutput(previous));
}

function renderExecOutput(run) {
  const output = document.createElement('pre');
  output.className = 'exec-output';

  const head = document.createElement('div');
  head.className = run.ok ? 'ok' : 'fail';
  const status = run.timedOut ? 'tempo esgotado' : `código ${run.code}`;
  head.textContent = `${run.ok ? '✔' : '✘'} ${status} · ${run.durationMs}ms · cwd ${run.cwd}`;

  const body = document.createElement('div');
  body.textContent = `${run.stdout || ''}${run.stderr ? `${run.stdout ? String.fromCharCode(10) : ''}[stderr]${String.fromCharCode(10)}${run.stderr}` : ''}` || '(sem saída)';

  output.append(head, body);
  return output;
}

function pythonCommand() {
  return `python3 ${state.activeFile}`;
}

async function requestExec(command) {
  const response = await fetch('/api/exec', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, cwd: '', timeout: 30000 }),
  });

  if (response.status === 428) {
    const payload = await response.json();
    return { needsApproval: true, payload };
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

  return { needsApproval: false, run: data };
}

function setExecStatus(message, isError) {
  elements.execStatus.textContent = message || '';
  elements.execStatus.classList.toggle('error', Boolean(isError));
}

function renderExecDetails(item) {
  elements.execDetails.textContent = '';

  const rows = [
    ['Comando', item.command],
    ['Diretório', item.cwd || '.'],
    ['Timeout', `${item.timeout} ms`],
    ['Rede', item.network ? 'habilitada' : 'desligada'],
  ];

  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    elements.execDetails.append(dt, dd);
  }
}

function openExecModal(item) {
  renderExecDetails(item);
  setExecStatus(item.reason ? `Motivo: ${item.reason}` : '');
  elements.execApprove.disabled = false;
  elements.execModal.classList.remove('hidden');
  elements.execModal.dataset.approvalId = item.approvalId;
  elements.execModal.dataset.command = item.command;
}

function closeExecModal() {
  elements.execModal.classList.add('hidden');
  delete elements.execModal.dataset.approvalId;
  delete elements.execModal.dataset.command;
}

async function approveExec() {
  const approvalId = elements.execModal.dataset.approvalId;
  if (!approvalId || execInFlight) return;

  execInFlight = true;
  elements.execApprove.disabled = true;
  setExecStatus('Executando…');

  try {
    const response = await fetch('/api/exec/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvalId }),
    });
    const run = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(run.error || `HTTP ${response.status}`);

    lastPythonRun = { ...run, file: state.activeFile };
    closeExecModal();
    state.viewerTab = 'run';
    renderViewer();
  } catch (error) {
    setExecStatus(error.message, true);
    elements.execApprove.disabled = false;
  } finally {
    execInFlight = false;
  }
}

async function runPythonFile() {
  if (execInFlight) return;

  renderPythonReady();
  const box = pythonPlaceholder('<p>Preparando execução…</p>');
  box.querySelector('button').remove();

  try {
    const result = await requestExec(pythonCommand());

    if (result.needsApproval) {
      removePythonPlaceholder();
      openExecModal(result.payload);
      renderPythonReady();
      return;
    }

    lastPythonRun = { ...result.run, file: state.activeFile };
    renderViewer();
  } catch (error) {
    renderPythonReady();
    lastPythonRun = {
      ok: false,
      code: 1,
      timedOut: false,
      durationMs: 0,
      cwd: '.',
      stdout: '',
      stderr: error.message,
      file: state.activeFile,
    };
    renderPythonReady();
  }
}

function renderRunPlaceholder() {
  const name = escapeHtml(state.activeFile);
  elements.frame.srcdoc = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<style>body{margin:0;padding:14px;color:#555;font-family:'Courier New',monospace;font-size:12px;line-height:1.6}</style>
</head><body><p>${name} ainda não foi executado.</p><p>Use <strong>Executar</strong> na barra superior ou clique na aba <strong>Executar</strong>.</p></body></html>`;
}

function previewSignature(kind) {
  return [
    'preview',
    kind,
    kind === 'markdown' ? state.files[state.activeFile] : '',
    state.files['index.html'],
    state.files['style.css'],
    state.files['script.js'],
  ].join('\u0000');
}

function renderPreview(kind, force) {
  const signature = previewSignature(kind);
  if (!force && rendered.preview === signature) return;

  rendered.preview = signature;
  clearConsole();

  if (kind === 'markdown') {
    elements.frame.srcdoc = buildMarkdownDocument(state.files[state.activeFile]);
    return;
  }

  elements.frame.srcdoc = buildPreviewDocument();
}

function runJavascript(force) {
  const source = state.files[state.activeFile];
  const signature = `run\u0000${state.activeFile}\u0000${source}`;
  if (!force && rendered.run === signature) return;

  rendered.run = signature;
  clearConsole();
  elements.frame.srcdoc = buildScriptSandboxDocument(source, state.activeFile);
}

function runActiveViewer() {
  const kind = activeKind();

  if (kind === 'python') {
    state.viewerTab = 'run';
    renderViewer({ force: true, runNow: true, execute: true });
    return;
  }

  if (kind === 'javascript') state.viewerTab = 'run';
  else if (kind === 'json') state.viewerTab = 'tree';
  else if (kind === 'text') state.viewerTab = 'text';
  else state.viewerTab = 'preview';

  renderViewer({ force: true, runNow: true });
}

function mediaUrl(filePath) {
  return `/api/fs/raw?path=${encodeURIComponent(filePath)}`;
}

function mediaEntryPath(fileName) {
  const entry = state.media[fileName];
  if (entry && entry.path) return entry.path;
  return state.diskPaths[fileName] || null;
}

function mediaMessage(text) {
  const message = document.createElement('p');
  message.className = 'media-message';
  message.textContent = text;
  return message;
}

function mediaBar(labelText, filePath) {
  const bar = document.createElement('div');
  bar.className = 'media-bar';

  const label = document.createElement('span');
  label.className = 'media-label';
  label.textContent = labelText;
  label.title = filePath;

  const open = document.createElement('a');
  open.href = mediaUrl(filePath);
  open.target = '_blank';
  open.rel = 'noopener';
  open.className = 'media-open';
  open.textContent = 'Abrir externo ↗';

  bar.append(label, open);
  return bar;
}

function renderMediaPanel(kind) {
  const panel = elements.mediaPanel;
  panel.textContent = '';

  const fileName = state.activeFile;
  const filePath = mediaEntryPath(fileName);

  if (!filePath) {
    panel.appendChild(mediaMessage('Pré-visualização indisponível: o arquivo não está no disco do workspace.'));
    return;
  }

  panel.appendChild(mediaBar(`${fileName} — ${filePath}`, filePath));

  const url = mediaUrl(filePath);

  if (kind === 'pdf') {
    const embed = document.createElement('embed');
    embed.type = 'application/pdf';
    embed.src = url;
    embed.className = 'media-pdf';
    panel.appendChild(embed);
    return;
  }

  const image = document.createElement('img');
  image.src = url;
  image.alt = fileName;
  image.className = 'media-image';
  image.addEventListener('error', () => {
    image.remove();
    panel.appendChild(mediaMessage('Não foi possível carregar a imagem (formato não suportado pelo navegador?).'));
  });
  panel.appendChild(image);
}

function renderBinaryPanel() {
  const panel = elements.binaryPanel;
  panel.textContent = '';

  const fileName = state.activeFile;
  const filePath = mediaEntryPath(fileName);

  panel.appendChild(
    mediaMessage(
      'Arquivo binário: não é possível editar nem mostrar o conteúdo aqui. Use "Abrir externo" para visualizar no sistema.'
    )
  );

  if (filePath) {
    panel.appendChild(mediaBar(`${fileName} — ${filePath}`, filePath));
  }
}

function destroyCodeViewer() {
  if (!codeViewer) return;
  codeViewer.destroy();
  codeViewer = null;
}

const LEGACY_MODES = {
  rs: { module: 'rust', exportName: 'rust' },
  c: { module: 'clike', exportName: 'c' },
  h: { module: 'clike', exportName: 'c' },
  cc: { module: 'clike', exportName: 'cpp' },
  cpp: { module: 'clike', exportName: 'cpp' },
  hpp: { module: 'clike', exportName: 'cpp' },
  cs: { module: 'clike', exportName: 'csharp' },
  java: { module: 'clike', exportName: 'java' },
  kt: { module: 'clike', exportName: 'kotlin' },
  kts: { module: 'clike', exportName: 'kotlin' },
  dart: { module: 'clike', exportName: 'dart' },
  go: { module: 'go', exportName: 'go' },
  rb: { module: 'ruby', exportName: 'ruby' },
  lua: { module: 'lua', exportName: 'lua' },
  swift: { module: 'swift', exportName: 'swift' },
  sh: { module: 'shell', exportName: 'shell' },
  bash: { module: 'shell', exportName: 'shell' },
  zsh: { module: 'shell', exportName: 'shell' },
  sql: { module: 'sql', exportName: 'sql' },
  xml: { module: 'xml', exportName: 'xml' },
  ini: { module: 'properties', exportName: 'properties' },
  conf: { module: 'properties', exportName: 'properties' },
  cfg: { module: 'properties', exportName: 'properties' },
  env: { module: 'properties', exportName: 'properties' },
  ps1: { module: 'powershell', exportName: 'powerShell' },
};

const legacyModeCache = new Map();
let codeRenderToken = 0;

let highlightSupportPromise = null;

async function loadHighlightSupport() {
  if (!highlightSupportPromise) {
    highlightSupportPromise = import('@codemirror/language')
      .then((module) => module.syntaxHighlighting(module.defaultHighlightStyle, { fallback: true }))
      .catch(() => null);
  }
  return highlightSupportPromise;
}

async function loadLegacyMode(ext) {
  const entry = LEGACY_MODES[ext];
  if (!entry) return null;
  if (legacyModeCache.has(ext)) return legacyModeCache.get(ext);

  const url =
    'https://esm.sh/@codemirror/legacy-modes@6.4.3/mode/' +
    entry.module +
    '?external=@codemirror/language&target=es2022';

  try {
    const [languageModule, modeModule] = await Promise.all([
      import('@codemirror/language'),
      import(url),
    ]);
    const mode = modeModule[entry.exportName];
    if (!mode) throw new Error('modo não exportado');
    const extension = languageModule.StreamLanguage.define(mode);
    legacyModeCache.set(ext, extension);
    return extension;
  } catch (error) {
    legacyModeCache.set(ext, null);
    return null;
  }
}

async function renderHighlightedCode() {
  const panel = elements.codePanel;
  destroyCodeViewer();
  panel.textContent = '';

  const fileName = state.activeFile;
  const source = state.files[fileName] || '';
  const token = ++codeRenderToken;

  if (!editorModules) {
    const fallback = document.createElement('pre');
    fallback.className = 'code-fallback';
    fallback.textContent = source;
    panel.appendChild(fallback);
    return;
  }

  const [language, highlight] = await Promise.all([
    loadLegacyMode(extensionOf(fileName)),
    loadHighlightSupport(),
  ]);
  if (token !== codeRenderToken || state.activeFile !== fileName) return;

  const { EditorState, EditorView } = editorModules;
  const extensions = [
    EditorView.editable.of(false),
    EditorState.readOnly.of(true),
    EditorView.lineWrapping,
  ];

  if (highlight) extensions.push(highlight);
  if (language) extensions.push(language);

  codeViewer = new EditorView({
    state: EditorState.create({ doc: source, extensions }),
    parent: panel,
  });
}

function createOutlineNode(label, value) {
  return { label, value: typeof value === 'string' ? value : '', children: [] };
}

function parseYamlOutline(text) {
  const root = createOutlineNode('raiz');
  const stack = [{ indent: -1, node: root }];

  for (const raw of String(text).split(String.fromCharCode(10))) {
    const expanded = raw.replace(/\t/g, '  ');
    const content = expanded.trim();
    if (!content || content.startsWith('#') || content === '---' || content === '...') continue;

    const indent = expanded.length - expanded.trimStart().length;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();

    const parent = stack[stack.length - 1].node;
    const isItem = content === '-' || content.startsWith('- ');
    const body = isItem ? content.slice(1).trim() : content;
    const colon = body.indexOf(':');

    let label;
    let value = '';

    if (isItem) {
      const nestedColon = body.indexOf(':');
      if (nestedColon !== -1) {
        label = `- ${body.slice(0, nestedColon).trim()}`;
        value = body.slice(nestedColon + 1).trim().slice(0, 120);
      } else {
        label = `- ${body || '(item)'}`.slice(0, 120);
      }
    } else if (colon !== -1) {
      label = body.slice(0, colon).trim();
      const rest = body.slice(colon + 1).trim();
      if (rest && !rest.startsWith('|') && !rest.startsWith('>') && rest !== '#') {
        value = rest.slice(0, 120);
      }
      if (!label) continue;
    } else {
      continue;
    }

    const node = createOutlineNode(label, value);
    parent.children.push(node);

    if (!isItem && (value === '' || body.slice(colon + 1).trim().startsWith('|') || body.slice(colon + 1).trim().startsWith('>'))) {
      stack.push({ indent, node });
    }
  }

  return root;
}

function parseTomlOutline(text) {
  const root = createOutlineNode('raiz');
  let current = root;

  const ensureSection = (dotted) => {
    let node = root;
    for (const part of String(dotted).split('.').map((piece) => piece.trim()).filter(Boolean)) {
      let next = node.children.find((child) => child.label === part && child.children.length >= 0 && child.section);
      if (!next) {
        next = createOutlineNode(part, '');
        next.section = true;
        node.children.push(next);
      }
      node = next;
    }
    return node;
  };

  for (const raw of String(text).split(String.fromCharCode(10))) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const section = line.match(/^\[\[?([^\]]+)\]\]?$/);
    if (section) {
      current = ensureSection(section[1]);
      continue;
    }

    const pair = line.match(/^([A-Za-z0-9_.\-"']+)\s*=\s*(.*)$/);
    if (!pair) continue;

    const value = pair[2].replace(/^["']|["']$/g, '').slice(0, 120);
    current.children.push(createOutlineNode(pair[1], value));
  }

  return root;
}

function buildOutlineNode(node) {
  const wrapper = document.createElement('div');
  wrapper.className = 'tree-node';

  if (node.children.length > 0) {
    const details = document.createElement('details');
    details.open = true;

    const summary = document.createElement('summary');
    const key = document.createElement('span');
    key.className = 'tree-key';
    key.textContent = node.label;

    summary.append(key, document.createTextNode(` {${node.children.length}}`));
    details.appendChild(summary);

    for (const child of node.children) details.appendChild(buildOutlineNode(child));
    wrapper.appendChild(details);
    return wrapper;
  }

  const leaf = document.createElement('div');
  leaf.className = 'tree-leaf';

  const key = document.createElement('span');
  key.className = 'tree-key';
  key.textContent = node.label.startsWith('- ') ? node.label : `${node.label}:`;

  const value = document.createElement('span');
  value.className = 'tree-string';
  value.textContent = node.value === '' ? '…' : node.value;

  leaf.append(key, document.createTextNode(' '), value);
  wrapper.appendChild(leaf);
  return wrapper;
}

function renderStructuredTree(kind) {
  elements.treePanel.textContent = '';

  const source = state.files[state.activeFile] || '';
  const outline = kind === 'yaml' ? parseYamlOutline(source) : parseTomlOutline(source);

  const hint = document.createElement('p');
  hint.className = 'tree-hint';
  hint.textContent =
    kind === 'yaml'
      ? 'Estrutura por indentação (chaves e itens) — valores truncados, não é um parser YAML completo.'
      : 'Estrutura por seções TOML ([seção] e chave = valor) — valores truncados.';

  elements.treePanel.append(hint, buildOutlineNode(outline));
}

function renderJsonTree() {
  elements.treePanel.textContent = '';

  try {
    const data = JSON.parse(state.files[state.activeFile]);
    elements.treePanel.appendChild(buildTreeNode(data, 'raiz', false));
  } catch (error) {
    const message = document.createElement('div');
    message.className = 'tree-error';
    message.textContent = `JSON inválido: ${error.message}`;
    elements.treePanel.appendChild(message);
  }
}

function buildTreeNode(value, label, isIndex) {
  const node = document.createElement('div');
  node.className = 'tree-node';

  if (value !== null && typeof value === 'object') {
    const details = document.createElement('details');
    details.open = true;

    const summary = document.createElement('summary');
    const key = document.createElement('span');
    key.className = 'tree-key';
    key.textContent = label;

    const size = Array.isArray(value) ? `[${value.length}]` : `{${Object.keys(value).length}}`;
    summary.append(key, document.createTextNode(` ${size}`));
    details.appendChild(summary);

    const entries = Array.isArray(value)
      ? value.map((item, index) => [`${index}`, item, true])
      : Object.keys(value).map((name) => [name, value[name], false]);

    for (const [entryKey, entryValue, entryIsIndex] of entries) {
      details.appendChild(buildTreeNode(entryValue, entryKey, entryIsIndex));
    }

    node.appendChild(details);
    return node;
  }

  const leaf = document.createElement('div');
  const key = document.createElement('span');
  key.className = isIndex ? 'tree-index' : 'tree-key';
  key.textContent = isIndex ? `[${label}]` : `${label}:`;

  const val = document.createElement('span');
  if (value === null) {
    val.className = 'tree-null';
    val.textContent = 'null';
  } else if (typeof value === 'string') {
    val.className = 'tree-string';
    val.textContent = JSON.stringify(value);
  } else if (typeof value === 'number') {
    val.className = 'tree-number';
    val.textContent = String(value);
  } else if (typeof value === 'boolean') {
    val.className = 'tree-boolean';
    val.textContent = String(value);
  } else {
    val.textContent = String(value);
  }

  leaf.append(key, document.createTextNode(' '), val);
  node.appendChild(leaf);
  return node;
}

function renderTextView(kind) {
  let text = state.files[state.activeFile];

  if (kind === 'json') {
    try {
      text = JSON.stringify(JSON.parse(text), null, 2);
    } catch (error) {
      // Mantém o texto original quando o JSON é inválido.
    }
  }

  elements.textPanel.textContent = text;
}

function buildScriptSandboxDocument(sourceText, fileName) {
  const source = sourceText.replace(/<\/script/gi, '<\\/script');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
${consoleInterceptor()}
<style>body{margin:0;padding:10px;color:#555;font-family:'Courier New',monospace;font-size:12px}</style>
</head>
<body>
<p>${escapeHtml(fileName)}</p>
<script>
try {
${source}
} catch (error) {
  console.error(error && error.message ? error.message : String(error));
}
</script>
</body>
</html>`;
}

function renderInlineMarkdown(text) {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+|#[^\s)]+)\)/g,
    '<a href="$2" rel="noopener noreferrer">$1</a>'
  );
  return html;
}

function renderMarkdown(markdown) {
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let index = 0;
  let openList = null;

  const closeList = () => {
    if (!openList) return;
    out.push(`</${openList}>`);
    openList = null;
  };

  const startsBlock = (line) =>
    /^```/.test(line) ||
    /^#{1,6}\s+/.test(line) ||
    /^\s*[-*+]\s+/.test(line) ||
    /^\s*\d+[.)]\s+/.test(line) ||
    /^>\s?/.test(line) ||
    /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);

  while (index < lines.length) {
    const line = lines[index];

    const fence = line.match(/^```(.*)$/);
    if (fence) {
      closeList();
      const language = fence[1].trim();
      const code = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      const className = language ? ` class="language-${escapeHtml(language)}"` : '';
      out.push(`<pre><code${className}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    if (/^\s*$/.test(line)) {
      closeList();
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      closeList();
      out.push('<hr>');
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      closeList();
      const quote = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ''));
        index += 1;
      }
      out.push(`<blockquote><p>${renderInlineMarkdown(quote.join(' '))}</p></blockquote>`);
      continue;
    }

    const unordered = line.match(/^\s*[-*+]\s+(.*)$/);
    if (unordered) {
      if (openList !== 'ul') {
        closeList();
        out.push('<ul>');
        openList = 'ul';
      }
      out.push(`<li>${renderInlineMarkdown(unordered[1])}</li>`);
      index += 1;
      continue;
    }

    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ordered) {
      if (openList !== 'ol') {
        closeList();
        out.push('<ol>');
        openList = 'ol';
      }
      out.push(`<li>${renderInlineMarkdown(ordered[1])}</li>`);
      index += 1;
      continue;
    }

    closeList();
    const paragraph = [];
    while (index < lines.length && lines[index].trim() !== '' && !startsBlock(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    out.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`);
  }

  closeList();
  return out.join('\n');
}

function buildMarkdownDocument(markdown) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<style>
  body { margin: 0; padding: 20px; color: #222; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; line-height: 1.6; }
  h1, h2, h3, h4, h5, h6 { margin: 1em 0 0.4em; line-height: 1.25; }
  h1 { font-size: 24px; border-bottom: 1px solid #e0e0e0; padding-bottom: 6px; }
  h2 { font-size: 20px; }
  h3 { font-size: 16px; }
  p { margin: 0.6em 0; }
  ul, ol { margin: 0.6em 0; padding-left: 24px; }
  code { padding: 1px 4px; border-radius: 3px; background: #f0f0f0; font-family: 'Courier New', monospace; font-size: 12px; }
  pre { padding: 10px; overflow: auto; border-radius: 4px; background: #f5f5f5; }
  pre code { padding: 0; background: transparent; }
  blockquote { margin: 0.6em 0; padding-left: 12px; border-left: 3px solid #d0d0d0; color: #555; }
  hr { border: 0; border-top: 1px solid #e0e0e0; margin: 1em 0; }
  a { color: #0b5cad; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #d0d0d0; padding: 4px 8px; }
</style>
</head>
<body>
${renderMarkdown(markdown)}
</body>
</html>`;
}

function showDocsStatus(message) {
  elements.docsStatus.textContent = message;
}

function refreshDocsSearchArea() {
  const downloaded = docsets.filter((doc) => doc.downloaded);
  const previous = elements.docsSearchDocset.value;

  elements.docsSearchDocset.textContent = '';
  for (const doc of downloaded) {
    const option = document.createElement('option');
    option.value = doc.slug;
    option.textContent = doc.version ? `${doc.name} ${doc.version}` : doc.name;
    elements.docsSearchDocset.appendChild(option);
  }

  if (downloaded.some((doc) => doc.slug === previous)) {
    elements.docsSearchDocset.value = previous;
  }

  elements.docsSearchArea.classList.toggle('hidden', downloaded.length === 0);
}

function visibleDocsets() {
  const filter = docsFilterValue.trim().toLowerCase();
  if (!filter) return docsets;

  return docsets.filter(
    (doc) =>
      String(doc.name || '').toLowerCase().includes(filter) ||
      String(doc.slug || '').toLowerCase().includes(filter)
  );
}

function renderDocsets() {
  const fragment = document.createDocumentFragment();
  const visible = visibleDocsets();

  for (const doc of visible) {
    const item = document.createElement('li');

    const name = document.createElement('span');
    name.className = 'doc-name';
    name.textContent = doc.name;
    name.title = doc.slug;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = doc.downloaded ? 'doc-download downloaded' : 'doc-download';
    button.textContent = doc.downloaded ? 'Baixado ✓' : 'Baixar';
    button.addEventListener('click', () => downloadDocset(doc, button));

    if (doc.version) {
      const version = document.createElement('span');
      version.className = 'doc-version';
      version.textContent = doc.version;
      item.append(name, version, button);
    } else {
      item.append(name, button);
    }

    fragment.appendChild(item);
  }

  elements.docsList.textContent = '';
  elements.docsList.appendChild(fragment);
  elements.docsFilterCount.textContent = `${visible.length} / ${docsets.length}`;

  if (visible.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'hint';
    empty.textContent = 'Nenhum docset corresponde ao filtro.';
    elements.docsList.appendChild(empty);
  }
}

async function downloadDocset(doc, button) {
  if (doc.downloaded && !window.confirm(`O docset ${doc.name} já existe. Deseja sobrescrever?`)) {
    return;
  }

  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = 'Baixando…';
  showDocsStatus(`Baixando ${doc.name}…`);

  try {
    const response = await fetch('/api/devdocs/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: doc.slug }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    doc.downloaded = true;
    button.textContent = 'Baixado ✓';
    button.classList.add('downloaded');
    showDocsStatus(`${doc.name} baixado.`);
    refreshDocsSearchArea();
  } catch (error) {
    button.textContent = originalLabel;
    showDocsStatus(`Erro ao baixar ${doc.name}: ${error.message}`);
  } finally {
    button.disabled = false;
  }
}

async function openDocEntry(docset, result) {
  showDocsStatus(`Carregando ${result.name}…`);

  try {
    const response = await fetch(
      `/api/devdocs/entry?docset=${encodeURIComponent(docset)}&path=${encodeURIComponent(result.path || '')}`
    );
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    elements.docsFrame.classList.remove('hidden');
    elements.docsFrame.srcdoc = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<style>
  body { margin: 0; padding: 14px 18px; color: #222; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; line-height: 1.55; }
  h1, h2, h3 { line-height: 1.25; }
  h1 { font-size: 22px; }
  h2 { font-size: 18px; }
  h3 { font-size: 15px; }
  code, pre { font-family: 'Courier New', monospace; font-size: 12px; }
  pre { padding: 8px; overflow: auto; background: #f5f5f5; border-radius: 4px; }
  code { padding: 1px 4px; background: #f0f0f0; border-radius: 3px; }
  pre code { padding: 0; background: transparent; }
  a { color: #0b5cad; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #d0d0d0; padding: 4px 8px; }
</style>
</head>
<body>
<article>${data.html}</article>
</body>
</html>`;
    elements.docsFrame.scrollIntoView({ block: 'nearest' });
    showDocsStatus(`${data.name} — ${docset}`);
  } catch (error) {
    showDocsStatus(`Erro ao abrir ${result.name}: ${error.message}`);
  }
}

async function openDocsModal() {
  elements.docsModal.classList.remove('hidden');
  elements.docsResults.textContent = '';
  elements.docsList.textContent = '';
  elements.docsSearchArea.classList.add('hidden');
  elements.docsFrame.classList.add('hidden');
  elements.docsFrame.removeAttribute('srcdoc');
  showDocsStatus('Carregando docsets…');

  try {
    const response = await fetch('/api/devdocs/available');
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    docsets = Array.isArray(data.docsets) ? data.docsets : [];
    renderDocsets();
    refreshDocsSearchArea();
    showDocsStatus(`${docsets.length} docsets disponíveis.`);
  } catch (error) {
    showDocsStatus(`Erro ao carregar docsets: ${error.message}`);
  }
}

function closeDocsModal() {
  elements.docsModal.classList.add('hidden');
}

async function searchDocs() {
  const query = elements.docsSearchInput.value.trim();
  const docset = elements.docsSearchDocset.value;

  if (!query || !docset) return;

  elements.docsResults.textContent = '';
  showDocsStatus('Buscando…');

  try {
    const response = await fetch(
      `/api/devdocs/search?q=${encodeURIComponent(query)}&docset=${encodeURIComponent(docset)}`
    );
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    const results = Array.isArray(data.results) ? data.results : [];
    showDocsStatus(`${results.length} resultado(s) para "${query}".`);

    for (const result of results) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'doc-result';
      button.textContent = result.name;
      button.title = result.path || '';
      button.addEventListener('click', () => openDocEntry(docset, result));
      elements.docsResults.appendChild(button);
    }
  } catch (error) {
    showDocsStatus(`Erro na busca: ${error.message}`);
  }
}

function pickModel(models) {
  if (!Array.isArray(models) || models.length === 0) return null;
  const local = models.find((model) => typeof model === 'string' && !model.includes(':cloud'));
  return local || models[0];
}

const DEMO_CAPABILITIES = [
  'Editor com syntax highlight e abas',
  'Preview de HTML/CSS/JS',
  'Console do Bloco 2',
  'Visualizadores JSON e Markdown',
  'Abrir e salvar arquivos reais',
  'Árvore de arquivos do projeto',
  'DevDocs offline',
  'AGENTS.md editável',
];

function isDemoMode() {
  return !state.activeProvider || state.activeProvider === 'demo';
}

function updateDemoHint() {
  if (!elements.chatDemoHint) return;
  elements.chatDemoHint.classList.toggle('hidden', !isDemoMode());
  elements.chatInput.placeholder = isDemoMode()
    ? 'Modo demo: configure uma IA para conversar…'
    : 'Pergunte algo...';
}

function storedProvider() {
  return localStorage.getItem(PROVIDER_STORAGE_KEY) || '';
}

/* "demo" só é enviado ao backend quando o usuário escolheu explicitamente,
   para que a detecção automática continue valendo na primeira execução. */
function explicitPreferredProvider() {
  const stored = storedProvider();
  return stored && stored !== 'demo' ? stored : '';
}

function applyFarmProvider(requestedDemo) {
  const farmActive = (state.farm && state.farm.activeProvider) || 'demo';
  state.activeProvider = requestedDemo ? 'demo' : farmActive;

  const providers = (state.farm && state.farm.providers) || [];
  const active = providers.find((provider) => provider.id === state.activeProvider);
  state.activeModel = active && active.models ? pickModel(active.models) : null;

  localStorage.setItem(PROVIDER_STORAGE_KEY, state.activeProvider);
  elements.provider.textContent = `Provedor: ${state.activeProvider}`;
  elements.provider.classList.toggle('demo', isDemoMode());
  updateDemoHint();
}

async function loadFarm(options) {
  const settings = options || {};
  const preferred = settings.provider || explicitPreferredProvider();
  const url = preferred ? `/api/farm?provider=${encodeURIComponent(preferred)}` : '/api/farm';

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.farm = await response.json();
    applyFarmProvider(storedProvider() === 'demo');
  } catch (error) {
    state.activeProvider = 'demo';
    state.activeModel = null;
    state.farm = state.farm || null;
    elements.provider.textContent = 'Provedor: demo';
    elements.provider.classList.add('demo');
    updateDemoHint();
  }

  if (state.farm && !elements.farmModal.classList.contains('hidden')) renderFarm(state.farm);
  if (state.farm && !elements.setupModal.classList.contains('hidden')) renderSetup(state.farm);
}

async function refreshFarm() {
  elements.farmStatus.textContent = 'Redetectando provedores e máquinas…';
  const preferred = explicitPreferredProvider();
  try {
    const response = await fetch('/api/farm/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(preferred ? { provider: preferred } : {}),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.farm = await response.json();
    applyFarmProvider(storedProvider() === 'demo');
    renderFarm(state.farm);
    elements.farmStatus.textContent = `Detecção concluída (${new Date().toLocaleTimeString('pt-BR')}).`;
  } catch (error) {
    elements.farmStatus.textContent = `Erro ao redetectar: ${error.message}`;
  }
}

function selectProvider(providerId) {
  state.activeProvider = providerId;
  localStorage.setItem(PROVIDER_STORAGE_KEY, providerId);

  const provider = state.farm && state.farm.providers.find((item) => item.id === providerId);
  state.activeModel = provider && provider.models ? pickModel(provider.models) : null;

  elements.provider.textContent = `Provedor: ${providerId}`;
  elements.provider.classList.toggle('demo', isDemoMode());
  updateDemoHint();

  if (state.farm) renderFarm(state.farm);
  if (state.farm && !elements.setupModal.classList.contains('hidden')) {
    renderSetup(state.farm);
    elements.setupSummary.textContent = setupSummaryText(state.farm);
  }
}

function providerCard(provider) {
  const card = document.createElement('div');
  card.className = 'provider-card';
  if (provider.id === state.activeProvider) card.classList.add('active');

  const head = document.createElement('div');
  head.className = 'provider-head';

  const dot = document.createElement('span');
  dot.className = provider.available ? 'dot on' : 'dot';

  const title = document.createElement('span');
  title.textContent = provider.name || provider.id;

  const kind = document.createElement('span');
  kind.className = 'provider-meta';
  kind.textContent = provider.kind ? `· ${provider.kind}` : '';

  head.append(dot, title, kind);

  if (provider.alwaysAvailable) {
    const badge = document.createElement('span');
    badge.className = 'provider-badge';
    badge.textContent = 'sempre disponível';
    head.appendChild(badge);
  }

  card.append(head);

  if (provider.endpoint) {
    const endpoint = document.createElement('div');
    endpoint.className = 'provider-meta';
    endpoint.textContent = provider.endpoint;
    card.appendChild(endpoint);
  }

  if (provider.models && provider.models.length) {
    const models = document.createElement('div');
    models.className = 'provider-meta';
    models.textContent = `modelos: ${provider.models.slice(0, 3).join(', ')}`;
    card.appendChild(models);
  }

  if (provider.description) {
    const description = document.createElement('div');
    description.className = 'provider-hint';
    description.textContent = provider.description;
    card.appendChild(description);
  }

  if (!provider.available && provider.reason) {
    const reason = document.createElement('div');
    reason.className = 'provider-hint';
    reason.textContent = provider.reason;
    card.appendChild(reason);
  }

  if (!provider.available && provider.installHint) {
    const hint = document.createElement('div');
    hint.className = 'provider-hint';
    hint.textContent = provider.installHint;
    card.appendChild(hint);
  }

  const actions = document.createElement('div');
  actions.className = 'provider-actions';

  if (provider.keyEnv) {
    const keyButton = document.createElement('button');
    keyButton.type = 'button';
    keyButton.textContent = provider.available ? 'Trocar chave' : 'Colar chave';
    keyButton.addEventListener('click', () => focusApiKey(provider.id));
    actions.appendChild(keyButton);
  }

  const use = document.createElement('button');
  use.type = 'button';
  use.className = 'primary';
  use.textContent = provider.id === state.activeProvider ? 'Em uso' : 'Usar';
  use.disabled = !provider.available;
  use.addEventListener('click', () => selectProvider(provider.id));
  actions.appendChild(use);

  card.appendChild(actions);
  return card;
}

/* ---------- chaves de API (celeiro) ---------- */

function setApiKeysStatus(message, isError) {
  const el = elements.apiKeysStatus;
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('error', Boolean(isError));
}

function focusApiKey(id) {
  const row = elements.apiKeys && elements.apiKeys.querySelector('.api-key-row[data-id="' + id + '"]');
  if (!row) return;
  row.scrollIntoView({ block: 'nearest' });
  const input = row.querySelector('input');
  if (input) input.focus();
}

function apiKeyRow(key) {
  const row = document.createElement('div');
  row.className = 'api-key-row';
  if (key.configured) row.classList.add('configured');
  row.dataset.id = key.id;

  const head = document.createElement('div');
  head.className = 'api-key-head';

  const dot = document.createElement('span');
  dot.className = 'api-key-dot' + (key.configured ? ' on' : '');

  const name = document.createElement('span');
  name.className = 'api-key-name';
  name.textContent = key.name;

  const state = document.createElement('span');
  state.className = 'api-key-state' + (key.configured ? ' on' : '');
  if (key.configured) {
    const origem = key.source === 'app' ? 'salva no app' : 'vinda do ambiente/.env';
    state.textContent = '✅ configurada (' + (key.hintValue || '••••') + ') · ' + origem;
  } else {
    state.textContent = '❌ sem chave';
  }

  head.append(dot, name, state);
  row.appendChild(head);

  const form = document.createElement('div');
  form.className = 'api-key-form';

  const input = document.createElement('input');
  input.type = 'password';
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.placeholder = key.configured
    ? 'cole outra chave para substituir (ou use Remover)'
    : 'cole a chave aqui';
  input.setAttribute('aria-label', 'Chave de API ' + key.name);

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'primary';
  save.textContent = 'Salvar';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.textContent = 'mostrar';
  toggle.addEventListener('click', () => {
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    toggle.textContent = showing ? 'mostrar' : 'ocultar';
    if (!showing) input.focus();
  });

  const submit = async () => {
    const value = input.value.trim();
    if (!value) {
      setApiKeysStatus('cole a chave do ' + key.name + ' antes de salvar.', true);
      input.focus();
      return;
    }

    save.disabled = true;
    setApiKeysStatus('Salvando chave do ' + key.name + '…');

    try {
      const data = await requestJson('/api/config/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: key.id, key: value }),
      });
      input.value = '';
      input.type = 'password';
      toggle.textContent = 'mostrar';
      renderApiKeys(data.keys);
      setApiKeysStatus('Chave do ' + key.name + ' salva. Redetectando provedores…');
      await reloadFarmAfterKeys();
      setApiKeysStatus('Chave do ' + key.name + ' salva e aplicada.');
    } catch (error) {
      setApiKeysStatus(error.message, true);
    } finally {
      save.disabled = false;
    }
  };

  save.addEventListener('click', submit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  });

  form.append(input, save, toggle);

  if (key.configured && key.canRemove) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remover';
    remove.addEventListener('click', async () => {
      if (!window.confirm('Remover a chave do ' + key.name + ' salva no app?')) return;
      remove.disabled = true;
      setApiKeysStatus('Removendo chave do ' + key.name + '…');
      try {
        const data = await requestJson('/api/config/keys/' + encodeURIComponent(key.id), { method: 'DELETE' });
        renderApiKeys(data.keys);
        setApiKeysStatus('Chave do ' + key.name + ' removida.');
        await reloadFarmAfterKeys();
      } catch (error) {
        setApiKeysStatus(error.message, true);
      } finally {
        remove.disabled = false;
      }
    });
    form.appendChild(remove);
  }

  row.appendChild(form);

  const hint = document.createElement('p');
  hint.className = 'api-key-hint';
  hint.textContent = key.hint + ' ';

  const link = document.createElement('a');
  link.href = key.docs;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'obter chave ↗';

  hint.appendChild(link);
  row.appendChild(hint);

  return row;
}

function renderApiKeys(keys) {
  if (!elements.apiKeys) return;
  elements.apiKeys.textContent = '';

  for (const key of keys || []) {
    elements.apiKeys.appendChild(apiKeyRow(key));
  }
}

async function loadApiKeys() {
  try {
    const data = await requestJson('/api/config/keys');
    renderApiKeys(data.keys);
    return data.keys;
  } catch (error) {
    setApiKeysStatus('Erro ao ler as chaves: ' + error.message, true);
    return [];
  }
}

/** Salvar/remover chave muda o resultado da detecção: redetecta e atualiza tudo. */
async function reloadFarmAfterKeys() {
  try {
    const preferred = explicitPreferredProvider();
    const response = await fetch('/api/farm/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(preferred ? { provider: preferred } : {}),
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    state.farm = await response.json();
    applyFarmProvider(storedProvider() === 'demo');
    renderFarm(state.farm);
  } catch (error) {
    setApiKeysStatus('Chave salva, mas a redetecção falhou: ' + error.message, true);
  }
}

function renderDocker(docker) {
  elements.farmDocker.textContent = '';

  if (!docker) {
    elements.farmDocker.textContent = 'Status do Docker indisponível.';
    return;
  }

  const line = document.createElement('div');
  line.textContent = docker.cli
    ? `Docker CLI: OK — ${docker.containers.length} container(s) em execução`
    : `Docker CLI: indisponível (${docker.error || 'erro'})`;
  elements.farmDocker.appendChild(line);

  if (docker.cli) {
    const test = document.createElement('div');
    test.textContent = docker.testContainerRunning
      ? 'Container de teste do Hermes: em execução'
      : 'Container de teste do Hermes: parado';
    elements.farmDocker.appendChild(test);
  }

  if (docker.hint) {
    const code = document.createElement('code');
    code.textContent = docker.hint;
    elements.farmDocker.appendChild(code);
  }
}

function machineCard(machine) {
  const card = document.createElement('div');
  card.className = 'machine-card';

  const name = document.createElement('span');
  name.className = 'machine-name';
  name.textContent = machine.name;

  const meta = document.createElement('span');
  meta.className = 'machine-meta';
  meta.textContent = `${machine.role} · ${machine.user ? `${machine.user}@` : ''}${machine.host}:${machine.port}${machine.llmUrl ? ` · ${machine.llmUrl}` : ''}`;

  const status = document.createElement('span');
  status.className = 'machine-meta';
  status.textContent = '';

  const actions = document.createElement('div');
  actions.className = 'machine-actions';

  const probe = document.createElement('button');
  probe.type = 'button';
  probe.textContent = 'Testar';
  probe.addEventListener('click', async () => {
    status.textContent = 'testando…';
    try {
      const response = await fetch(`/api/machines/${machine.id}/probe`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      const parts = [];
      if (data.results.llm) parts.push(data.results.llm.ok ? `LLM ok (${(data.results.llm.models || []).length} modelos)` : `LLM falhou: ${data.results.llm.error}`);
      if (data.results.runner) parts.push(data.results.runner.ok ? `Docker ${data.results.runner.dockerVersion}` : `Runner falhou: ${data.results.runner.error}`);
      status.textContent = parts.join(' · ') || 'sem resultado';
    } catch (error) {
      status.textContent = `erro: ${error.message}`;
    }
  });

  const run = document.createElement('button');
  run.type = 'button';
  run.textContent = 'Rodar testes';
  run.disabled = machine.role === 'llm';
  run.addEventListener('click', async () => {
    showRunnerOutput(`Executando "${machine.testCommand}" em ${machine.name}…`);
    try {
      const response = await fetch(`/api/machines/${machine.id}/run-tests`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      showRunnerOutput(
        `${data.ok ? '✔ testes passaram' : '✘ testes falharam'} (código ${data.code}, ${data.durationMs}ms, ${data.mode})
${data.stdout}${data.stderr ? `
[stderr]
${data.stderr}` : ''}`,
        data.ok
      );
    } catch (error) {
      showRunnerOutput(`Erro ao executar: ${error.message}`, false);
    }
  });

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = 'Remover';
  remove.addEventListener('click', async () => {
    if (!window.confirm(`Remover a máquina ${machine.name}?`)) return;
    try {
      const response = await fetch(`/api/machines/${machine.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await loadFarm();
    } catch (error) {
      status.textContent = `erro: ${error.message}`;
    }
  });

  actions.append(probe, run, remove);
  card.append(name, meta, status, actions);
  return card;
}

const STRING_NL = String.fromCharCode(10);

function showRunnerOutput(text, ok) {
  elements.runnerOutput.classList.remove('hidden');
  elements.runnerOutput.textContent = '';

  const head = document.createElement('div');
  head.className = ok === undefined ? '' : ok ? 'ok' : 'fail';
  head.textContent = text.split(STRING_NL)[0];

  const body = document.createElement('div');
  body.textContent = text.split(STRING_NL).slice(1).join(STRING_NL);

  elements.runnerOutput.append(head, body);
}

const gitState = { status: null, activeFile: null, pendingCommit: false, inFlight: false };

function gitElement(id) {
  return document.getElementById(id);
}

function setGitStatus(message, isError) {
  const el = gitElement('git-commit-status');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('error', Boolean(isError));
}

function setGitHead(text) {
  gitElement('git-head').textContent = text || '';
}

function gitMenuCount() {
  const el = gitElement('git-menu-count');
  if (!el) return;
  if (gitState.status && gitState.status.isRepo === false) {
    el.textContent = 'sem repo';
    el.classList.remove('empty');
    return;
  }

  const counts = gitState.status && gitState.status.counts;
  if (!counts || counts.total === 0) {
    el.textContent = 'limpo';
    el.classList.add('empty');
    return;
  }
  el.textContent = counts.total + ' alteração(ões)';
  el.classList.remove('empty');
}

function gitRepoLine(data) {
  const wrap = document.createElement('div');
  wrap.textContent = '';

  if (!data.isRepo) {
    const reason = document.createElement('span');
    reason.textContent = data.reason || 'repositório indisponível';
    wrap.appendChild(reason);

    if (data.hint) {
      const hint = document.createElement('code');
      hint.textContent = data.hint;
      wrap.appendChild(hint);
    }
    return wrap;
  }

  const branch = document.createElement('span');
  branch.className = 'git-branch';
  branch.textContent = data.branch || '(sem branch)';
  wrap.appendChild(branch);

  const root = document.createElement('span');
  root.textContent = data.root === data.workspace ? 'raiz do workspace' : data.root;
  wrap.appendChild(root);

  if (data.head) {
    const head = document.createElement('span');
    head.textContent = '@' + data.head;
    wrap.appendChild(head);
  }

  if (data.ahead > 0) {
    const ahead = document.createElement('span');
    ahead.className = 'git-ahead';
    ahead.textContent = '↑' + data.ahead;
    wrap.appendChild(ahead);
  }

  if (data.behind > 0) {
    const behind = document.createElement('span');
    behind.className = 'git-behind';
    behind.textContent = '↓' + data.behind;
    wrap.appendChild(behind);
  }

  if (!data.rootIsWorkspace) {
    const warn = document.createElement('span');
    warn.textContent = 'repo acima do workspace: só arquivos internos entram na lista';
    wrap.appendChild(warn);
  }

  return wrap;
}

function gitFileRow(file) {
  const row = document.createElement('div');
  row.className = 'git-file';
  if (file.path === gitState.activeFile) row.classList.add('active');

  const code = document.createElement('span');
  code.className = 'git-code' + (file.staged ? ' staged' : '');
  code.textContent = file.untracked ? 'U' : file.index !== ' ' ? file.index : file.worktree;
  code.title = file.status;

  const pathLabel = document.createElement('span');
  pathLabel.className = 'git-path';
  pathLabel.textContent = file.path;
  pathLabel.title = file.path;

  const kind = document.createElement('span');
  kind.className = 'git-kind';
  kind.textContent = file.status;

  const actions = document.createElement('div');
  actions.className = 'git-file-actions';

  const view = document.createElement('button');
  view.type = 'button';
  view.textContent = 'diff';
  view.addEventListener('click', () => showGitDiff(file.path, file.staged));
  actions.appendChild(view);

  if (file.staged) {
    const unstage = document.createElement('button');
    unstage.type = 'button';
    unstage.textContent = 'Desfazer';
    unstage.addEventListener('click', () => gitAction('/api/git/unstage', [file.path], 'stage desfeito'));
    actions.appendChild(unstage);
  } else {
    const stage = document.createElement('button');
    stage.type = 'button';
    stage.textContent = 'Preparar';
    stage.addEventListener('click', () => gitAction('/api/git/stage', [file.path], 'arquivo preparado'));
    actions.appendChild(stage);

    const discard = document.createElement('button');
    discard.type = 'button';
    discard.textContent = 'Descartar';
    discard.addEventListener('click', () => {
      const label = file.untracked ? 'apagar ' + file.path : 'descartar as mudanças em ' + file.path;
      if (!window.confirm('Tem certeza? Isso vai ' + label + '.')) return;
      gitAction('/api/git/discard', [file.path], 'alterações descartadas');
    });
    actions.appendChild(discard);
  }

  row.append(code, pathLabel, kind, actions);
  return row;
}

function renderGitDiff(text) {
  const view = gitElement('git-diff');
  view.textContent = '';

  if (!text) {
    view.textContent = 'Sem alterações para mostrar.';
    return;
  }

  const lines = text.split(STRING_NL);
  const fragment = document.createDocumentFragment();

  for (const line of lines) {
    const span = document.createElement('span');
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('@@')) {
      span.className = 'diff-meta';
    } else if (line.startsWith('+')) {
      span.className = 'diff-add';
    } else if (line.startsWith('-')) {
      span.className = 'diff-del';
    }
    span.textContent = line + STRING_NL;
    fragment.appendChild(span);
  }

  view.appendChild(fragment);
}

async function showGitDiff(filePath, staged) {
  gitState.activeFile = filePath;
  renderGit();
  try {
    const response = await fetch('/api/git/diff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, staged }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'HTTP ' + response.status);
    renderGitDiff(data.diff);
  } catch (error) {
    renderGitDiff('');
    setGitStatus('Erro ao gerar diff: ' + error.message, true);
  }
}

function renderGitLog(commits) {
  const list = gitElement('git-log');
  list.textContent = '';

  if (!commits || commits.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'Nenhum commit ainda.';
    list.appendChild(empty);
    return;
  }

  for (const commit of commits) {
    const row = document.createElement('div');
    row.className = 'git-commit-item';

    const hash = document.createElement('span');
    hash.className = 'git-hash';
    hash.textContent = commit.short;

    const subject = document.createElement('span');
    subject.textContent = commit.subject || '';

    const when = document.createElement('span');
    when.className = 'git-when';
    when.textContent = commit.when || '';

    row.append(hash, subject, when);
    list.appendChild(row);
  }
}

function renderGit() {
  const data = gitState.status;
  if (!data) return;

  gitElement('git-repo').textContent = '';
  gitElement('git-repo').appendChild(gitRepoLine(data));

  if (!data.isRepo) {
    const filesEl = gitElement('git-files');
    filesEl.textContent = '';
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = data.hint || 'O painel Git precisa de um repositório nesta pasta.';
    filesEl.appendChild(hint);
    gitElement('git-diff').textContent = 'Sem repositório para mostrar diff.';
    gitElement('git-log').textContent = '';
    gitElement('git-commit-status').textContent = '';
    gitMenuCount();
    setGitHead('');
    return;
  }

  setGitHead(data.counts.total + ' arquivo(s) · ' + data.counts.staged + ' preparado(s)');

  const files = gitElement('git-files');
  files.textContent = '';

  if (data.files.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'Nada alterado — a árvore está limpa.';
    files.appendChild(empty);
  } else {
    for (const file of data.files) files.appendChild(gitFileRow(file));
  }

  gitMenuCount();
}

async function loadGit(options) {
  const settings = options || {};
  try {
    const response = await fetch('/api/git/status');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'HTTP ' + response.status);
    gitState.status = data;
    if (settings.resetFile) gitState.activeFile = null;
    renderGit();

    if (!data.isRepo) {
      setGitStatus(data.reason || 'Git indisponível', true);
    } else if (!settings.quiet) {
      setGitStatus(
        data.counts.total === 0 ? 'Árvore limpa.' : data.counts.total + ' alteração(ões) pendente(s).'
      );
    }

    try {
      const logResponse = await fetch('/api/git/log?limit=8');
      const logData = await logResponse.json();
      if (logResponse.ok) renderGitLog(logData.commits);
    } catch (error) {
      renderGitLog([]);
    }
  } catch (error) {
    setGitStatus('Erro ao ler o Git: ' + error.message, true);
    gitState.status = { isRepo: false, reason: 'backend indisponível', hint: '' };
    renderGit();
  }
}

async function gitAction(url, files, successMessage) {
  if (gitState.inFlight) return;
  gitState.inFlight = true;
  setGitStatus('Executando…');

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'HTTP ' + response.status);
    if (data.status) {
      gitState.status = data.status;
      renderGit();
    }
    setGitStatus(successMessage || 'Pronto.');
    await loadGit({ quiet: true });
    if (successMessage && /descartado|apagar/.test(successMessage)) {
      refreshFileTree();
    }
  } catch (error) {
    setGitStatus('Falhou: ' + error.message, true);
  } finally {
    gitState.inFlight = false;
  }
}

function resetGitCommitConfirm() {
  gitState.pendingCommit = false;
  gitElement('btn-git-commit').classList.remove('hidden');
  gitElement('btn-git-commit-confirm').classList.add('hidden');
  gitElement('btn-git-commit-cancel').classList.add('hidden');
  gitElement('btn-git-commit-confirm').disabled = false;
}

function openGitCommitConfirm() {
  const message = gitElement('git-message').value.trim();
  if (message.length < 4) {
    setGitStatus('Mensagem precisa de pelo menos 4 caracteres.', true);
    return;
  }
  const counts = (gitState.status && gitState.status.counts) || { total: 0 };
  if (!counts.total) {
    setGitStatus('Nada para commitar.', true);
    return;
  }

  gitState.pendingCommit = true;
  gitElement('btn-git-commit').classList.add('hidden');
  gitElement('btn-git-commit-confirm').classList.remove('hidden');
  gitElement('btn-git-commit-cancel').classList.remove('hidden');
  setGitStatus(
    'Confirma o commit de ' + counts.total + ' arquivo(s) com a mensagem "' + message + '"?'
  );
}

async function confirmGitCommit() {
  const message = gitElement('git-message').value.trim();
  if (!gitState.pendingCommit) return;
  if (gitState.inFlight) return;

  gitState.inFlight = true;
  gitElement('btn-git-commit-confirm').disabled = true;
  setGitStatus('Criando commit…');

  try {
    const response = await fetch('/api/git/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, confirm: true, files: [] }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'HTTP ' + response.status);

    gitState.status = data.status;
    gitState.activeFile = null;
    renderGit();
    if (data.status) renderGitLog((await fetch('/api/git/log?limit=8').then((r) => r.json())).commits);
    gitElement('git-message').value = '';
    setGitStatus('commit ' + (data.hash || '') + ' criado: ' + data.files.length + ' arquivo(s).');
    resetGitCommitConfirm();
    await loadGit({ quiet: true });
  } catch (error) {
    setGitStatus('Falhou: ' + error.message, true);
    resetGitCommitConfirm();
    gitElement('btn-git-commit-confirm').disabled = false;
  } finally {
    gitState.inFlight = false;
  }
}

async function openGitModal() {
  gitElement('git-modal').classList.remove('hidden');
  gitState.pendingCommit = false;
  resetGitCommitConfirm();
  setSyncPending(null);
  setGitStatus('Carregando status do Git…');
  renderGitDiff('');
  await loadGit({ resetFile: true });
  loadGitRemotes().catch((error) => setGitSyncStatus('Erro ao ler os remotes: ' + error.message, true));
}

function closeGitModal() {
  gitElement('git-modal').classList.add('hidden');
  resetGitCommitConfirm();
}

function renderAiTalk(data) {
  const rolesEl = document.getElementById('ai-talk-roles');
  const recentEl = document.getElementById('ai-talk-recent');
  if (!rolesEl || !recentEl) return;

  rolesEl.textContent = '';
  for (const role of data.roles || []) {
    const chip = document.createElement('span');
    chip.className = 'ai-talk-role';
    chip.title = role.description;

    const dot = document.createElement('span');
    dot.className = role.available > 0 ? 'dot on' : 'dot';

    const label = document.createElement('span');
    label.textContent = role.id + ' (' + role.available + ')';

    chip.append(dot, label);
    rolesEl.appendChild(chip);
  }

  recentEl.textContent = '';
  const recent = data.recent || [];
  if (recent.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'Nenhuma delegação registrada.';
    recentEl.appendChild(empty);
    return;
  }

  for (const entry of recent) {
    const row = document.createElement('div');
    row.className = 'ai-talk-entry' + (entry.status === 'error' ? ' error' : '');

    const target = document.createElement('span');
    target.className = 'ai-talk-target';
    target.textContent = (entry.target && entry.target.id) || '?';

    const text = document.createElement('span');
    text.className = 'ai-talk-text';
    text.textContent =
      entry.status === 'error' ? entry.error || 'erro' : String(entry.reply || '').slice(0, 160);
    text.title = entry.task || '';

    const when = document.createElement('span');
    when.className = 'git-when';
    when.textContent = (entry.durationMs || 0) + 'ms';

    row.append(target, text, when);
    recentEl.appendChild(row);
  }
}

async function loadAiTalk() {
  try {
    const response = await fetch('/api/ai-talk');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'HTTP ' + response.status);
    renderAiTalk(data);
  } catch (error) {
    const rolesEl = document.getElementById('ai-talk-roles');
    if (rolesEl) {
      rolesEl.textContent = 'ai-talk indisponível: ' + error.message;
    }
  }
}

async function clearAiTalk() {
  try {
    await fetch('/api/ai-talk', { method: 'DELETE' });
    await loadAiTalk();
  } catch (error) {
    /* silencioso: histórico é opcional */
  }
}

function renderFarm(farm) {
  elements.farmProviders.textContent = '';
  for (const provider of farm.providers || []) {
    elements.farmProviders.appendChild(providerCard(provider));
  }

  renderDocker(farm.docker);

  elements.machineList.textContent = '';
  const machineItems = farm.machines || [];
  if (machineItems.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'Nenhuma máquina adicionada ainda.';
    elements.machineList.appendChild(empty);
  } else {
    for (const machine of machineItems) {
      elements.machineList.appendChild(machineCard(machine));
    }
  }
}

function setupSummaryText(farm) {
  const providers = (farm && farm.providers) || [];
  const summary = (farm && farm.summary) || {};
  const total = typeof summary.total === 'number' ? summary.total : providers.length;
  const available =
    typeof summary.available === 'number'
      ? summary.available
      : providers.filter((provider) => provider.available && provider.id !== 'demo').length;

  const head = available === 0
    ? 'Nenhum provedor de IA disponível — o modo demo está ativo'
    : `${available} de ${total} provedores disponíveis`;

  return `${head} · provedor ativo: ${state.activeProvider || 'demo'}`;
}

function renderSetupCapabilities() {
  elements.setupCapabilities.textContent = '';
  for (const item of DEMO_CAPABILITIES) {
    const li = document.createElement('li');
    li.textContent = item;
    elements.setupCapabilities.appendChild(li);
  }
}

async function copyText(text, button) {
  const original = button.textContent;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    button.textContent = 'copiado';
  } catch (error) {
    button.textContent = 'falhou';
  }
  setTimeout(() => {
    button.textContent = original;
  }, 1200);
}

function setupItem(provider) {
  const item = document.createElement('div');
  item.className = 'setup-item';
  if (provider.available) item.classList.add('available');
  if (provider.id === 'demo') item.classList.add('demo');
  if (provider.id === state.activeProvider) item.classList.add('active');
  item.dataset.provider = provider.id;

  const mark = document.createElement('span');
  mark.className = 'setup-mark';
  mark.textContent = provider.available ? '✅' : '❌';
  mark.title = provider.available ? 'disponível' : 'não encontrado';
  mark.setAttribute('aria-label', provider.available ? 'disponível' : 'não encontrado');

  const body = document.createElement('div');
  body.className = 'setup-body';

  const title = document.createElement('div');
  title.className = 'setup-title';

  const name = document.createElement('span');
  name.textContent = provider.name || provider.id;
  title.appendChild(name);

  if (provider.kind) {
    const kind = document.createElement('span');
    kind.className = 'setup-kind';
    kind.textContent = provider.kind;
    title.appendChild(kind);
  }

  if (provider.alwaysAvailable) {
    const badge = document.createElement('span');
    badge.className = 'setup-badge';
    badge.textContent = 'sempre disponível';
    title.appendChild(badge);
  }

  if (provider.id === state.activeProvider) {
    const active = document.createElement('span');
    active.className = 'setup-badge';
    active.textContent = 'em uso';
    title.appendChild(active);
  }

  body.appendChild(title);

  if (provider.endpoint) {
    const endpoint = document.createElement('div');
    endpoint.className = 'setup-meta';
    endpoint.textContent = provider.endpoint;
    body.appendChild(endpoint);
  }

  if (provider.models && provider.models.length) {
    const models = document.createElement('div');
    models.className = 'setup-meta';
    models.textContent = `modelos: ${provider.models.slice(0, 3).join(', ')}`;
    body.appendChild(models);
  }

  if (provider.description) {
    const description = document.createElement('div');
    description.className = 'setup-hint';
    description.textContent = provider.description;
    body.appendChild(description);
  }

  if (!provider.available && provider.reason) {
    const reason = document.createElement('div');
    reason.className = 'setup-hint';
    reason.textContent = `motivo: ${provider.reason}`;
    body.appendChild(reason);
  }

  if (!provider.available && provider.installHint) {
    const hint = document.createElement('div');
    hint.className = 'setup-hint';
    hint.textContent = provider.installHint;
    body.appendChild(hint);
  }

  if (provider.setupCommand) {
    const row = document.createElement('div');
    row.className = 'setup-command';

    const code = document.createElement('code');
    code.textContent = provider.setupCommand;

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = 'copiar';
    copy.addEventListener('click', () => copyText(provider.setupCommand, copy));

    row.append(code, copy);
    body.appendChild(row);
  }

  const actions = document.createElement('div');
  actions.className = 'setup-actions-cell';

  if (provider.available) {
    const use = document.createElement('button');
    use.type = 'button';
    use.className = provider.id === state.activeProvider ? '' : 'primary';
    use.textContent = provider.id === state.activeProvider ? 'Em uso' : 'Usar';
    use.disabled = provider.id === state.activeProvider;
    use.addEventListener('click', () => selectProvider(provider.id));
    actions.appendChild(use);
  } else if (provider.keyEnv) {
    const paste = document.createElement('button');
    paste.type = 'button';
    paste.className = 'primary';
    paste.textContent = 'Colar chave';
    paste.addEventListener('click', async () => {
      closeSetupModal();
      await openFarmModal();
      focusApiKey(provider.id);
    });
    actions.appendChild(paste);
  }

  item.append(mark, body, actions);
  return item;
}

function renderSetup(farm) {
  elements.setupProviders.textContent = '';
  if (!farm) return;

  for (const provider of farm.providers || []) {
    elements.setupProviders.appendChild(setupItem(provider));
  }
}

async function openSetupModal(options) {
  const settings = options || {};
  elements.setupModal.classList.remove('hidden');
  elements.setupSummary.textContent = 'Detectando provedores de IA…';
  elements.setupProviders.textContent = '';
  renderSetupCapabilities();

  try {
    if (settings.refresh) {
      const preferred = explicitPreferredProvider();
      const response = await fetch('/api/farm/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preferred ? { provider: preferred } : {}),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      state.farm = await response.json();
      applyFarmProvider(storedProvider() === 'demo');
      if (!elements.farmModal.classList.contains('hidden')) renderFarm(state.farm);
    } else {
      await loadFarm();
      if (!state.farm) throw new Error('celeiro indisponível');
    }

    renderSetup(state.farm);
    elements.setupSummary.textContent = setupSummaryText(state.farm);
  } catch (error) {
    elements.setupSummary.textContent = `Erro ao detectar provedores: ${error.message}`;
  }
}

function closeSetupModal() {
  elements.setupModal.classList.add('hidden');
  try {
    localStorage.setItem(ONBOARD_STORAGE_KEY, '1');
  } catch (error) {
    /* armazenamento indisponível: o painel volta na próxima execução */
  }
}

async function openFarmModal() {
  elements.farmModal.classList.remove('hidden');
  elements.farmStatus.textContent = 'Detectando provedores…';
  elements.farmProviders.textContent = '';
  elements.machineList.textContent = '';
  elements.runnerOutput.classList.add('hidden');

  try {
    await loadFarm();
    if (!state.farm) throw new Error('celeiro indisponível');
    renderFarm(state.farm);
    setApiKeysStatus('');
    await loadApiKeys();
    loadAiTalk();
    elements.farmStatus.textContent = `${state.farm.providers.length} provedor(es) · ${(state.farm.machines || []).length} máquina(s)`;
  } catch (error) {
    elements.farmStatus.textContent = `Erro ao carregar o celeiro: ${error.message}`;
  }
}

function closeFarmModal() {
  elements.farmModal.classList.add('hidden');
}

async function addMachine(event) {
  event.preventDefault();
  const form = elements.machineForm;
  const data = new FormData(form);
  const payload = {
    name: String(data.get('name') || '').trim(),
    host: String(data.get('host') || '').trim(),
    user: String(data.get('user') || '').trim(),
    port: Number(data.get('port') || 22),
    role: String(data.get('role') || 'runner'),
    llmUrl: String(data.get('llmUrl') || '').trim(),
    llmModel: String(data.get('llmModel') || '').trim(),
    testCommand: String(data.get('testCommand') || '').trim(),
  };

  elements.farmStatus.textContent = 'Adicionando máquina…';

  try {
    const response = await fetch('/api/machines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);

    form.reset();
    form.port.value = '22';
    await loadFarm();
    renderFarm(state.farm);
    elements.farmStatus.textContent = `Máquina "${result.machine.name}" adicionada.`;
  } catch (error) {
    elements.farmStatus.textContent = `Erro ao adicionar: ${error.message}`;
  }
}

function startDrag(event, onMove) {
  event.preventDefault();
  const move = (moveEvent) => onMove(moveEvent);
  const stop = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', stop);
    document.body.style.userSelect = '';
  };

  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', stop, { once: true });
  document.body.style.userSelect = 'none';
}

function initResizers() {
  const viewer = document.getElementById('block-viewer');
  const editor = document.getElementById('block-editor');
  const leftColumn = document.getElementById('left-column');
  const chat = document.getElementById('block-chat');
  const resizerV = document.getElementById('resizer-v');
  const resizerH = document.getElementById('resizer-h');

  resizerV.addEventListener('pointerdown', (event) => {
    const startY = event.clientY;
    const total = viewer.offsetHeight + editor.offsetHeight + resizerV.offsetHeight;
    const startViewer = viewer.offsetHeight;

    startDrag(event, (moveEvent) => {
      const min = total * 0.15;
      const max = total * 0.85;
      const nextViewer = Math.min(max, Math.max(min, startViewer + (moveEvent.clientY - startY)));
      viewer.style.flex = `0 0 ${nextViewer}px`;
      editor.style.flex = `0 0 ${total - resizerV.offsetHeight - nextViewer}px`;
    });
  });

  const filesPanel = document.getElementById('block-files');
  const resizerFiles = document.getElementById('resizer-files');

  resizerFiles.addEventListener('pointerdown', (event) => {
    const startX = event.clientX;
    const startWidth = filesPanel.offsetWidth;

    startDrag(event, (moveEvent) => {
      const nextWidth = Math.min(520, Math.max(160, startWidth + (moveEvent.clientX - startX)));
      filesPanel.style.flex = `0 0 ${nextWidth}px`;
    });
  });

  resizerH.addEventListener('pointerdown', (event) => {
    const startX = event.clientX;
    const total = leftColumn.offsetWidth + chat.offsetWidth + resizerH.offsetWidth;
    const startLeft = leftColumn.offsetWidth;

    startDrag(event, (moveEvent) => {
      const min = total * 0.2;
      const max = total * 0.8;
      const nextLeft = Math.min(max, Math.max(min, startLeft + (moveEvent.clientX - startX)));
      leftColumn.style.flex = `0 0 ${nextLeft}px`;
      chat.style.flex = `0 0 ${total - resizerH.offsetWidth - nextLeft}px`;
    });
  });
}

/* ---------- workspace, GitHub, sincronização e novo arquivo ---------- */

const NEW_FILE_TEMPLATES = {
  html: [
    '<!DOCTYPE html>',
    '<html lang="pt-BR">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <title>Novo documento</title>',
    '</head>',
    '<body>',
    '  <h1>Olá</h1>',
    '</body>',
    '</html>',
    '',
  ].join(String.fromCharCode(10)),
  css: 'body {' + String.fromCharCode(10) + '  font-family: sans-serif;' + String.fromCharCode(10) + '}' + String.fromCharCode(10),
  js: "'use strict';" + String.fromCharCode(10) + String.fromCharCode(10) + "console.log('novo módulo');" + String.fromCharCode(10),
  json: '{' + String.fromCharCode(10) + '  "nome": "novo"' + String.fromCharCode(10) + '}' + String.fromCharCode(10),
  md: '# Novo arquivo' + String.fromCharCode(10) + String.fromCharCode(10) + 'Escreva aqui.' + String.fromCharCode(10),
  py: 'def main():' + String.fromCharCode(10) + '    print("olá")' + String.fromCharCode(10) + String.fromCharCode(10) + String.fromCharCode(10) + "if __name__ == '__main__':" + String.fromCharCode(10) + '    main()' + String.fromCharCode(10),
  yaml: '# novo arquivo' + String.fromCharCode(10) + 'chave: valor' + String.fromCharCode(10),
  toml: '[secao]' + String.fromCharCode(10) + 'chave = "valor"' + String.fromCharCode(10),
  sh: '#!/usr/bin/env bash' + String.fromCharCode(10) + 'set -euo pipefail' + String.fromCharCode(10),
  gitignore: 'node_modules/' + String.fromCharCode(10) + '.env' + String.fromCharCode(10),
};

function newFileTemplate(fileName) {
  const ext = extensionOf(fileName);
  if (fileName === '.gitignore') return NEW_FILE_TEMPLATES.gitignore;
  return NEW_FILE_TEMPLATES[ext] || '';
}

function normalizeNewFileName(raw) {
  const value = String(raw || '').trim().replace(/\\/g, '/');
  if (!value) return { error: 'informe o nome do arquivo' };
  if (value.length > 200) return { error: 'nome longo demais (máximo 200)' };
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) return { error: 'use um caminho relativo à raiz do workspace' };
  if (value.endsWith('/')) return { error: 'o nome termina com "/" — inclua o nome do arquivo' };

  const segments = value.split('/').filter((segment) => segment !== '');
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return { error: 'o caminho não pode ter "." ou ".."' };
  }
  if (segments.some((segment) => segment.startsWith('.git'))) {
    return { error: 'nada dentro de .git' };
  }
  if (segments[segments.length - 1].indexOf('.') === -1 && segments[segments.length - 1] !== 'Makefile') {
    return { error: 'inclua a extensão (ex.: notas.md)', warn: true };
  }

  return { name: segments.join('/') };
}

function updateNewFilePreview() {
  const result = normalizeNewFileName(elements.newFileName.value);
  const preview = elements.newFilePreview;
  preview.textContent = '';
  preview.classList.toggle('error', Boolean(result.error));

  if (result.error) {
    preview.textContent = result.error;
    return;
  }

  const template = newFileTemplate(result.name);
  const lines = template ? template.split(String.fromCharCode(10)).length - 1 : 0;
  preview.textContent = template
    ? 'esqueleto de ' + lines + ' linha(s) · grava só ao salvar (Ctrl+S → diff)'
    : 'aba em branco · grava só ao salvar (Ctrl+S → diff)';
}

function openNewFileModal() {
  elements.newFileModal.classList.remove('hidden');
  elements.newFileName.value = '';
  elements.newFileStatus.textContent = '';
  updateNewFilePreview();
  elements.newFileName.focus();
}

function closeNewFileModal() {
  elements.newFileModal.classList.add('hidden');
}

function createNewFile() {
  const result = normalizeNewFileName(elements.newFileName.value);

  if (result.error) {
    elements.newFileStatus.textContent = result.error;
    elements.newFileStatus.classList.add('error');
    return;
  }

  const name = result.name;

  const openTab =
    typeof state.files[name] === 'string' && !state.media[name]
      ? name
      : Object.keys(state.files).find((tab) => state.diskPaths[tab] === name);

  if (openTab) {
    setActiveFile(openTab);
    closeNewFileModal();
    setFileStatus(name + ' já estava aberto — aba ativada');
    return;
  }

  state.files[name] = newFileTemplate(name);
  delete state.diskPaths[name];
  delete state.media[name];
  state.savedSnapshots[name] = null;
  state.activeFile = name;
  state.viewerTab = null;

  renderEditorTabs();
  applyActiveFileToEditor(name);
  renderViewer({ force: true });
  updateFileStatus();
  persistLocal();
  closeNewFileModal();
  markTreeActive();
  setFileStatus(name + ' criado na memória — Ctrl+S para gravar no workspace');

  if (editorView) editorView.focus();
  else if (fallbackEditor) fallbackEditor.focus();
}

/* ---------- pasta raiz ---------- */

function folderTag(text, className) {
  const tag = document.createElement('span');
  tag.className = className || 'folder-tag';
  tag.textContent = text;
  return tag;
}

function renderFolderState(info) {
  elements.folderCurrent.textContent = '';

  const label = document.createElement('div');
  label.className = 'folder-current-path';
  label.textContent = info.root;
  label.title = info.root;

  const meta = document.createElement('div');
  meta.className = 'folder-meta';
  meta.appendChild(folderTag('origem: ' + (info.source || '?'), 'folder-badge'));
  if (info.isRepo) meta.appendChild(folderTag('repositório Git', 'folder-badge ok'));

  elements.folderCurrent.append(label, meta);
}

function renderFolderShortcuts(list) {
  elements.folderShortcuts.textContent = '';

  for (const item of list || []) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'folder-shortcut';
    button.textContent = item.label;
    button.title = item.path;
    button.addEventListener('click', () => browseFolder(item.path));
    elements.folderShortcuts.appendChild(button);
  }
}

function renderFolderRecent(list, currentPath) {
  elements.folderRecent.textContent = '';
  const recent = (list || []).filter((item) => item !== currentPath);

  if (recent.length === 0) return;

  const label = document.createElement('span');
  label.className = 'folder-recent-label';
  label.textContent = 'recentes:';
  elements.folderRecent.appendChild(label);

  for (const item of recent.slice(0, 5)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'folder-shortcut recent';
    button.textContent = baseName(item);
    button.title = item;
    button.addEventListener('click', () => browseFolder(item));
    elements.folderRecent.appendChild(button);
  }
}

async function browseFolder(target) {
  elements.folderStatus.textContent = 'Listando…';
  elements.folderList.textContent = '';

  try {
    const query = target ? '?path=' + encodeURIComponent(target) : '';
    const data = await requestJson('/api/workspace/browse' + query);

    state.folderBrowsePath = data.path;
    elements.folderPath.value = data.path;
    renderFolderShortcuts(data.shortcuts);

    if (data.parent) {
      const up = document.createElement('button');
      up.type = 'button';
      up.className = 'folder-entry up';
      up.innerHTML = '';

      const icon = document.createElement('span');
      icon.className = 'folder-icon';
      icon.textContent = '↑';
      const name = document.createElement('span');
      name.className = 'folder-name';
      name.textContent = '..';
      up.append(icon, name);
      up.addEventListener('click', () => browseFolder(data.parent));
      elements.folderList.appendChild(up);
    }

    if (data.entries.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'Nenhuma subpasta aqui. Você pode abrir esta pasta mesmo assim.';
      elements.folderList.appendChild(empty);
    }

    for (const entry of data.entries) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'folder-entry';

      const icon = document.createElement('span');
      icon.className = 'folder-icon';
      icon.textContent = entry.isRepo ? '◈' : '▸';

      const name = document.createElement('span');
      name.className = 'folder-name';
      name.textContent = entry.name;

      row.append(icon, name);
      if (entry.isRepo) row.appendChild(folderTag('git', 'folder-tag'));
      if (entry.path === state.workspace && state.workspace.root) row.classList.add('current');

      row.title = entry.path;
      row.addEventListener('click', () => browseFolder(entry.path));
      elements.folderList.appendChild(row);
    }

    elements.folderStatus.textContent =
      data.entries.length + ' pasta(s)' + (data.isRepo ? ' · esta pasta é um repositório Git' : '');
    elements.folderStatus.classList.remove('error');
    state.folderBrowsePath = data.path;
    elements.folderChoose.textContent = 'Abrir ' + (baseName(data.path) || data.path);
  } catch (error) {
    elements.folderStatus.textContent = error.message;
    elements.folderStatus.classList.add('error');
  }
}

async function openFolderModal() {
  elements.folderModal.classList.remove('hidden');
  elements.folderStatus.textContent = '';
  elements.folderCurrent.textContent = '';
  elements.folderShortcuts.textContent = '';
  elements.folderRecent.textContent = '';
  elements.folderList.textContent = '';

  try {
    const info = await requestJson('/api/workspace');
    state.workspace = info;
    renderFolderState(info);
    renderWorkspaceLabels(info);
    renderFolderRecent(info.recent, info.root);
    await browseFolder('');
  } catch (error) {
    elements.folderStatus.textContent = 'Erro ao carregar o workspace: ' + error.message;
    elements.folderStatus.classList.add('error');
  }
}

function closeFolderModal() {
  elements.folderModal.classList.add('hidden');
}

async function chooseFolder() {
  const target = (elements.folderPath.value || '').trim() || state.folderBrowsePath;
  if (!target) return;

  const dirty = Object.keys(state.files).filter((name) => !state.media[name] && isDirty(name));
  if (dirty.length > 0) {
    const proceed = window.confirm(
      dirty.length + ' arquivo(s) com alterações não salvas serão fechados ao trocar de pasta. Continuar?'
    );
    if (!proceed) return;
  }

  elements.folderStatus.textContent = 'Abrindo ' + target + '…';

  try {
    const info = await requestJson('/api/workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: target }),
    });

    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(PATHS_STORAGE_KEY);
      localStorage.removeItem(ACTIVE_STORAGE_KEY);
    } catch (error) {
      /* sem localStorage: o reload reabre o estado padrão de qualquer forma */
    }

    state.workspace = info;
    window.location.reload();
  } catch (error) {
    elements.folderStatus.textContent = error.message;
    elements.folderStatus.classList.add('error');
  }
}

function renderWorkspaceLabels(info) {
  const label = info && info.name ? info.name : '';
  if (elements.workspaceMenuName) elements.workspaceMenuName.textContent = label;
  if (elements.fileStatus) elements.fileStatus.title = info && info.root ? info.root : '';
}

async function loadWorkspaceLabel() {
  try {
    const info = await requestJson('/api/workspace');
    state.workspace = info;
    renderWorkspaceLabels(info);
    loadGithubConfig().catch(() => {});
    return info;
  } catch (error) {
    return null;
  }
}

/* ---------- conta do GitHub ---------- */

function maskRemoteUrl(url) {
  return String(url || '').replace(/\/\/[^@/]+@/, '//***@');
}

function renderGithub(github) {
  state.github = github || null;

  if (elements.githubMenuState) {
    elements.githubMenuState.textContent = github && github.hasToken ? '@' + (github.login || 'conta') : 'sem conta';
  }

  const box = elements.githubAccount;
  box.textContent = '';

  const dot = document.createElement('span');
  dot.className = 'github-dot' + (github && github.hasToken ? ' on' : '');

  const label = document.createElement('span');
  if (github && github.hasToken) {
    label.textContent = (github.login ? '@' + github.login : 'token salvo') + ' · ' + github.tokenHint;
    label.className = 'github-login';
  } else {
    label.textContent = 'nenhuma conta conectada — o Git usa as credenciais do sistema, se existirem';
  }

  box.append(dot, label);

  if (github && github.verifiedAt) {
    const when = document.createElement('span');
    when.className = 'github-tag';
    when.textContent = 'validado em ' + new Date(github.verifiedAt).toLocaleString('pt-BR');
    box.appendChild(when);
  }

  if (elements.githubFile && github) {
    elements.githubFile.textContent = (state.githubFile || 'data/config.json');
  }

  if (github) {
    if (!elements.githubName.value) elements.githubName.value = github.name || '';
    if (!elements.githubEmail.value) elements.githubEmail.value = github.email || '';
  }
}

async function loadGithubConfig() {
  const data = await requestJson('/api/config');
  state.githubFile = data.file;
  if (elements.githubFile && data.file) elements.githubFile.textContent = data.file;
  renderGithub(data.github);
  return data;
}

async function openGithubModal() {
  elements.githubModal.classList.remove('hidden');
  elements.githubStatus.textContent = 'Lendo a configuração…';
  elements.githubStatus.classList.remove('error');
  elements.githubToken.value = '';
  elements.githubName.value = '';
  elements.githubEmail.value = '';

  try {
    await loadGithubConfig();
    elements.githubStatus.textContent = state.github && state.github.hasToken
      ? 'Conta conectada. O token não é exibido de volta.'
      : 'Cole um token pessoal com permissão Contents: read and write.';
    elements.githubToken.focus();
  } catch (error) {
    elements.githubStatus.textContent = 'Erro ao ler a configuração: ' + error.message;
    elements.githubStatus.classList.add('error');
  }
}

function closeGithubModal() {
  elements.githubModal.classList.add('hidden');
}

async function saveGithub(event) {
  event.preventDefault();
  elements.githubStatus.textContent = 'Validando token no GitHub…';
  elements.githubStatus.classList.remove('error');
  elements.githubSave.disabled = true;

  const payload = {
    name: elements.githubName.value.trim(),
    email: elements.githubEmail.value.trim(),
  };
  const token = elements.githubToken.value.trim();
  if (token) payload.token = token;

  try {
    const data = await requestJson('/api/config/github', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    elements.githubToken.value = '';
    renderGithub(data.github);
    elements.githubStatus.textContent = data.github.hasToken
      ? 'Conta salva e validada · ' + (data.github.login ? '@' + data.github.login : 'token ok')
      : 'Dados salvos (sem token).';
    if (!elements.farmModal.classList.contains('hidden')) loadGitRemotes().catch(() => {});
  } catch (error) {
    elements.githubStatus.textContent = error.message;
    elements.githubStatus.classList.add('error');
  } finally {
    elements.githubSave.disabled = false;
  }
}

async function removeGithubToken() {
  if (!window.confirm('Remover o token salvo? Os commits continuam usando nome/e-mail configurados.')) return;

  try {
    const data = await requestJson('/api/config/github/token', { method: 'DELETE' });
    renderGithub(data.github);
    elements.githubStatus.textContent = 'Token removido.';
  } catch (error) {
    elements.githubStatus.textContent = error.message;
    elements.githubStatus.classList.add('error');
  }
}

/* ---------- remotes e sincronização ---------- */

function setGitSyncStatus(message, isError) {
  elements.gitSyncStatus.textContent = message || '';
  elements.gitSyncStatus.classList.toggle('error', Boolean(isError));
}

function gitRemoteRow(remote) {
  const row = document.createElement('div');
  row.className = 'git-remote';

  const name = document.createElement('span');
  name.className = 'git-remote-name';
  name.textContent = remote.name;

  const url = document.createElement('span');
  url.className = 'git-remote-url';
  url.textContent = maskRemoteUrl(remote.url);
  url.title = maskRemoteUrl(remote.url);

  const change = document.createElement('button');
  change.type = 'button';
  change.textContent = 'Trocar';
  change.addEventListener('click', () => renderRemoteEditor(remote.name, ''));

  row.append(name, url, change);
  return row;
}

function renderRemoteEditor(name, currentUrl) {
  elements.gitRemote.textContent = '';

  const form = document.createElement('div');
  form.className = 'git-remote';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'git-remote-input';
  input.spellcheck = false;
  input.placeholder = 'https://github.com/usuario/repositorio.git';
  input.value = currentUrl || '';

  const save = document.createElement('button');
  save.type = 'button';
  save.textContent = 'Salvar remote';
  save.addEventListener('click', () => saveGitRemote(name || 'origin', input.value));

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancelar';
  cancel.addEventListener('click', () => loadGitRemotes().catch(() => {}));

  form.append(input, save, cancel);
  elements.gitRemote.appendChild(form);
  input.focus();
}

async function saveGitRemote(name, url) {
  setGitSyncStatus('Salvando remote…');

  try {
    const data = await requestJson('/api/git/remote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name || 'origin', url }),
    });
    setGitSyncStatus('remote ' + data.remote.name + ' → ' + maskRemoteUrl(data.remote.url));
    await loadGitRemotes();
    await loadGit({ quiet: true });
  } catch (error) {
    setGitSyncStatus(error.message, true);
  }
}

function renderGitRemotes(data) {
  elements.gitRemote.textContent = '';

  if (!data.isRepo) {
    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = 'A pasta atual não é um repositório Git — não há remote para sincronizar.';
    elements.gitRemote.appendChild(note);
    setGitSyncButtons(false);
    return;
  }

  const github = data.github || {};
  const account = document.createElement('p');
  account.className = 'hint';
  account.textContent = github.hasToken
    ? 'enviando como @' + (github.login || 'token salvo') + ' (token do app)'
    : 'sem token no app — o Git tenta as credenciais do sistema';
  elements.gitRemote.appendChild(account);

  if (!data.remotes || data.remotes.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'Nenhum remote configurado. Informe a URL do repositório no GitHub:';
    elements.gitRemote.appendChild(empty);
    renderRemoteEditor('origin', '');
    setGitSyncButtons(false);
    return;
  }

  for (const remote of data.remotes) {
    elements.gitRemote.appendChild(gitRemoteRow(remote));

    if (/^(git@|ssh:\/\/)/.test(remote.url)) {
      const warn = document.createElement('p');
      warn.className = 'git-remote-warn';
      warn.textContent = 'remote usa SSH: a autenticação depende da sua chave ssh-agent (o token do app só vale para HTTPS)';
      elements.gitRemote.appendChild(warn);
    }
  }

  const add = document.createElement('button');
  add.type = 'button';
  add.textContent = 'Adicionar/trocar remote…';
  add.addEventListener('click', () => renderRemoteEditor('origin', ''));
  elements.gitRemote.appendChild(add);

  setGitSyncButtons(true);
}

function setGitSyncButtons(enabled) {
  for (const button of [elements.gitFetch, elements.gitPull, elements.gitPush]) {
    if (button) button.disabled = !enabled;
  }
}

async function loadGitRemotes() {
  const data = await requestJson('/api/git/remotes');
  renderGitRemotes(data);
  return data;
}

function setSyncPending(action) {
  state.gitSyncPending = action;
  const isPush = action === 'push';
  const isPull = action === 'pull';

  elements.gitPushConfirm.classList.toggle('hidden', !isPush);
  elements.gitPullConfirm.classList.toggle('hidden', !isPull);
  elements.gitSyncCancel.classList.toggle('hidden', !action);

  if (action) {
    setGitSyncStatus(
      isPush
        ? 'Enviar envia seus commits para o GitHub. Confirme para continuar.'
        : 'Atualizar traz os commits da remota (fast-forward). Confirme para continuar.'
    );
  }
}

async function runGitSync(action) {
  // fetch só lê; push e pull mexem no projeto e no GitHub, então pedem confirmação
  if (action !== 'fetch' && state.gitSyncPending !== action) {
    setSyncPending(action);
    return;
  }

  setSyncPending(null);
  setGitSyncStatus('Executando ' + action + '…');
  elements.gitFetch.disabled = true;
  elements.gitPull.disabled = true;
  elements.gitPush.disabled = true;

  const payload = action === 'fetch' ? {} : { confirm: true, remote: 'origin' };

  try {
    const data = await requestJson('/api/git/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const detail = (data.output || '').split(String.fromCharCode(10)).filter(Boolean).slice(0, 3).join(' · ');
    setGitSyncStatus(action + ' concluído' + (detail ? ' · ' + detail : ''));

    if (data.status) {
      gitState.status = data.status;
      renderGit();
    }
    await loadGit({ quiet: true });
    await loadGitRemotes();
  } catch (error) {
    setGitSyncStatus(error.message, true);
    await loadGitRemotes().catch(() => {});
  }
}

function menuOpen() {
  return !elements.menuPanel.classList.contains('hidden');
}

/**
 * O botão do menu fica à direita da barra; abrir com left:0 empurra o painel para
 * fora da janela em telas estreitas. Alinha pela borda direita e, se ainda faltar
 * espaço, desloca o mínimo necessário (sempre dentro da viewport).
 */
function positionMenu() {
  const panel = elements.menuPanel;
  const wrap = elements.menuToggle.getBoundingClientRect();

  panel.style.left = '0px';
  panel.style.maxWidth = Math.max(220, window.innerWidth - 24) + 'px';

  const width = panel.offsetWidth;
  const margin = 12;
  const rightLimit = window.innerWidth - margin;

  if (wrap.left + width <= rightLimit) return;

  const shifted = Math.max(margin, rightLimit - width);
  panel.style.left = Math.round(shifted - wrap.left) + 'px';
}

function setMenuOpen(open) {
  elements.menuPanel.classList.toggle('hidden', !open);
  elements.menuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) {
    positionMenu();
    const first = elements.menuPanel.querySelector('.menu-item');
    if (first) first.focus();
  }
}

function toggleMenu() {
  setMenuOpen(!menuOpen());
}

function closeMenu() {
  if (menuOpen()) setMenuOpen(false);
}

function syncFilesMenuItem() {
  const visible = filesPanelVisible();
  elements.filesMenuLabel.textContent = visible
    ? 'Ocultar árvore de arquivos'
    : 'Mostrar árvore de arquivos';
  document.getElementById('btn-files').setAttribute('aria-checked', visible ? 'true' : 'false');
}

function bindEvents() {
  document.getElementById('btn-run').addEventListener('click', runActiveViewer);
  elements.saveAction.addEventListener('click', saveActiveFile);
  elements.saveAsButton.addEventListener('click', () => openFileModal('save'));
  elements.openButton.addEventListener('click', () => openFileModal('open'));
  document.getElementById('btn-docs').addEventListener('click', openDocsModal);
  document.getElementById('btn-settings').addEventListener('click', openFarmModal);

  elements.menuToggle.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleMenu();
  });
  elements.menuPanel.addEventListener('click', () => closeMenu());

  document.addEventListener('click', (event) => {
    if (!menuOpen()) return;
    if (!event.target.closest('#menu-wrap')) closeMenu();
  });

  elements.filesToggle.addEventListener('click', () => {
    toggleFilesPanel();
    syncFilesMenuItem();
  });
  document.getElementById('btn-files-hide').addEventListener('click', () => {
    setFilesPanel(false);
    syncFilesMenuItem();
  });
  document.getElementById('btn-files-refresh').addEventListener('click', refreshFileTree);
  document.getElementById('files-root').addEventListener('click', revealActiveInTree);

  elements.execApprove.addEventListener('click', approveExec);
  document.getElementById('btn-exec-close').addEventListener('click', closeExecModal);
  document.getElementById('btn-exec-cancel').addEventListener('click', closeExecModal);
  elements.execModal.addEventListener('click', (event) => {
    if (event.target === elements.execModal) closeExecModal();
  });

  document.getElementById('btn-agents').addEventListener('click', openAgentsModal);
  document.getElementById('btn-agents-close').addEventListener('click', closeAgentsModal);
  elements.agentsModal.addEventListener('click', (event) => {
    if (event.target === elements.agentsModal) closeAgentsModal();
  });

  elements.diffApprove.addEventListener('click', approveDiff);
  elements.diffReject.addEventListener('click', discardDiff);
  document.getElementById('btn-diff-close').addEventListener('click', discardDiff);

  document.getElementById('btn-farm-close').addEventListener('click', closeFarmModal);
  elements.farmRefresh.addEventListener('click', refreshFarm);
  elements.machineForm.addEventListener('submit', addMachine);
  elements.farmModal.addEventListener('click', (event) => {
    if (event.target === elements.farmModal) closeFarmModal();
  });

  document.getElementById('btn-new-file').addEventListener('click', openNewFileModal);
  document.getElementById('btn-new-file-close').addEventListener('click', closeNewFileModal);
  document.getElementById('btn-new-file-cancel').addEventListener('click', closeNewFileModal);
  document.getElementById('btn-new-file-create').addEventListener('click', createNewFile);
  elements.newFileName.addEventListener('input', updateNewFilePreview);
  elements.newFileName.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      createNewFile();
    }
  });
  elements.newFileModal.addEventListener('click', (event) => {
    if (event.target === elements.newFileModal) closeNewFileModal();
  });

  document.getElementById('btn-open-folder').addEventListener('click', openFolderModal);
  document.getElementById('btn-folder-close').addEventListener('click', closeFolderModal);
  document.getElementById('btn-folder-cancel').addEventListener('click', closeFolderModal);
  elements.folderChoose.addEventListener('click', chooseFolder);
  document.getElementById('btn-folder-go').addEventListener('click', () => browseFolder(elements.folderPath.value.trim()));
  elements.folderPath.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      browseFolder(elements.folderPath.value.trim());
    }
  });
  elements.folderModal.addEventListener('click', (event) => {
    if (event.target === elements.folderModal) closeFolderModal();
  });

  document.getElementById('btn-github').addEventListener('click', openGithubModal);
  document.getElementById('btn-github-close').addEventListener('click', closeGithubModal);
  elements.githubForm.addEventListener('submit', saveGithub);
  document.getElementById('btn-github-remove').addEventListener('click', removeGithubToken);
  elements.githubModal.addEventListener('click', (event) => {
    if (event.target === elements.githubModal) closeGithubModal();
  });

  elements.gitFetch.addEventListener('click', () => runGitSync('fetch'));
  elements.gitPull.addEventListener('click', () => runGitSync('pull'));
  elements.gitPush.addEventListener('click', () => runGitSync('push'));
  elements.gitPullConfirm.addEventListener('click', () => runGitSync('pull'));
  elements.gitPushConfirm.addEventListener('click', () => runGitSync('push'));
  elements.gitSyncCancel.addEventListener('click', () => {
    setSyncPending(null);
    setGitSyncStatus('cancelado');
  });

  document.getElementById('btn-git').addEventListener('click', openGitModal);
  document.getElementById('btn-git-close').addEventListener('click', closeGitModal);
  document.getElementById('btn-git-refresh').addEventListener('click', () => {
    loadGit({ quiet: true });
    loadGitRemotes().catch((error) => setGitSyncStatus(error.message, true));
  });
  document.getElementById('btn-git-commit').addEventListener('click', openGitCommitConfirm);
  document.getElementById('btn-git-commit-confirm').addEventListener('click', confirmGitCommit);
  document.getElementById('btn-git-commit-cancel').addEventListener('click', () => {
    resetGitCommitConfirm();
    setGitStatus('Commit cancelado.');
  });
  document.getElementById('btn-ai-talk-clear').addEventListener('click', clearAiTalk);
  document.getElementById('git-modal').addEventListener('click', (event) => {
    if (event.target === document.getElementById('git-modal')) closeGitModal();
  });

  document.getElementById('btn-setup-close').addEventListener('click', closeSetupModal);
  document.getElementById('btn-setup-demo').addEventListener('click', () => {
    selectProvider('demo');
    closeSetupModal();
  });
  document.getElementById('btn-setup-farm').addEventListener('click', () => {
    closeSetupModal();
    openFarmModal();
  });
  elements.setupRefresh.addEventListener('click', () => openSetupModal({ refresh: true }));
  elements.setupModal.addEventListener('click', (event) => {
    if (event.target === elements.setupModal) closeSetupModal();
  });

  elements.provider.addEventListener('click', () => openSetupModal());
  elements.provider.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openSetupModal();
    }
  });
  document.getElementById('btn-chat-setup').addEventListener('click', () => openSetupModal());

  elements.docsFilter.addEventListener('input', () => {
    docsFilterValue = elements.docsFilter.value;
    renderDocsets();
  });

  elements.viewerTabs.addEventListener('click', (event) => {
    const button = event.target.closest('.viewer-tab');
    if (button) switchViewerTab(button.dataset.tab);
  });

  document.getElementById('btn-file-close').addEventListener('click', closeFileModal);
  elements.fileConfirm.addEventListener('click', () => confirmFileAction());
  elements.filePath.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      confirmFileAction();
    }
  });
  elements.fileModal.addEventListener('click', (event) => {
    if (event.target === elements.fileModal) closeFileModal();
  });

  elements.sendButton.addEventListener('click', sendChat);

  elements.chatInput.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      sendChat();
    }
  });

  document.getElementById('btn-docs-close').addEventListener('click', closeDocsModal);
  document.getElementById('btn-docs-search').addEventListener('click', searchDocs);
  elements.docsSearchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      searchDocs();
    }
  });
  elements.docsModal.addEventListener('click', (event) => {
    if (event.target === elements.docsModal) closeDocsModal();
  });

  window.addEventListener('message', (event) => {
    if (event.source !== elements.frame.contentWindow) return;
    const data = event.data;
    if (!data || data.type !== 'CONSOLE_LOG') return;

    const level = data.level === 'error' ? 'error' : 'info';
    addConsoleLine(level, data.data);
  });

  document.addEventListener('keydown', (event) => {
    const modifier = event.ctrlKey || event.metaKey;

    if (modifier && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveActiveFile();
    }

    if (modifier && event.key.toLowerCase() === 'o') {
      event.preventDefault();
      openFileModal('open');
    }

    if (modifier && event.key.toLowerCase() === 'g') {
      event.preventDefault();
      closeMenu();
      openGitModal();
    }

    if (modifier && event.key === 'Enter') {
      event.preventDefault();
      sendChat();
    }

    if (event.altKey && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      openNewFileModal();
      return;
    }

    if (event.altKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      setMenuOpen(true);
      return;
    }

    if (event.key !== 'Escape') return;
    if (menuOpen()) {
      closeMenu();
      elements.menuToggle.focus();
      return;
    }
    if (!elements.diffModal.classList.contains('hidden')) {
      discardDiff();
      return;
    }
    if (!elements.execModal.classList.contains('hidden')) {
      closeExecModal();
      return;
    }
    if (!elements.agentsModal.classList.contains('hidden')) closeAgentsModal();
    if (!elements.fileModal.classList.contains('hidden')) closeFileModal();
    if (!elements.docsModal.classList.contains('hidden')) closeDocsModal();
    if (!elements.farmModal.classList.contains('hidden')) closeFarmModal();
    if (!elements.setupModal.classList.contains('hidden')) closeSetupModal();
    if (!gitElement('git-modal').classList.contains('hidden')) closeGitModal();
    if (!elements.folderModal.classList.contains('hidden')) closeFolderModal();
    if (!elements.githubModal.classList.contains('hidden')) closeGithubModal();
    if (!elements.newFileModal.classList.contains('hidden')) closeNewFileModal();
  });
}

async function init() {
  bindEvents();
  initResizers();
  updateErrorStatus();
  await loadFarm();
  updateDemoHint();
  await loadTools();
  loadAgentsDocument();
  await initEditor();
  renderEditorTabs();
  updateFileStatus();
  renderViewer({ force: true });

  if (localStorage.getItem(FILES_PANEL_STORAGE_KEY) === '1') {
    setFilesPanel(true);
  }

  if (localStorage.getItem(ONBOARD_STORAGE_KEY) !== '1') {
    openSetupModal();
  }

  loadGit({ quiet: true }).catch(() => {});
  loadWorkspaceLabel().catch(() => {});

  loadWorkspaceInfo().catch(() => {
    elements.fileStatus.title = 'Backend de arquivos indisponível';
  });
}

init();
