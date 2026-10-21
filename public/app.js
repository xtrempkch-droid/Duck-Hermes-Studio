const STORAGE_KEY = 'duck-hermes-files';
const LEGACY_STORAGE_KEY = 'win98-hermes-files';
const PATHS_STORAGE_KEY = 'duck-hermes-paths';
const ACTIVE_STORAGE_KEY = 'duck-hermes-active';

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
  diskPaths: initialStorage.diskPaths,
  savedSnapshots: { ...initialStorage.files },
  workspace: null,
  fileModalMode: 'open',
  fileModalDir: '',
  activeFile: initialStorage.activeFile,
  activeProvider: 'demo',
  activeModel: null,
  viewerTab: 'preview',
  errorCount: 0,
};

const elements = {
  frame: document.getElementById('preview-frame'),
  viewerTabs: document.getElementById('viewer-tabs'),
  consolePanel: document.getElementById('console-panel'),
  treePanel: document.getElementById('tree-panel'),
  textPanel: document.getElementById('text-panel'),
  cursor: document.getElementById('status-cursor'),
  provider: document.getElementById('status-provider'),
  errors: document.getElementById('status-errors'),
  fileStatus: document.getElementById('status-file'),
  editorTabs: document.getElementById('editor-tabs'),
  saveButton: document.getElementById('btn-save'),
  saveAsButton: document.getElementById('btn-save-as'),
  openButton: document.getElementById('btn-open'),
  fileModal: document.getElementById('file-modal'),
  fileModalTitle: document.getElementById('file-modal-title'),
  fileRoot: document.getElementById('file-root'),
  filePath: document.getElementById('file-path'),
  fileList: document.getElementById('file-list'),
  fileStatusText: document.getElementById('file-status'),
  fileConfirm: document.getElementById('btn-file-confirm'),
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
};

let editorView = null;
let fallbackEditor = null;
let languageCompartment = null;
let makeLanguageExtension = null;
let sendInFlight = false;
let saveStatusTimer = null;
let docsets = [];
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
  text: [{ id: 'text', label: 'Texto' }],
};

function fileKind(fileName) {
  const ext = String(fileName).split('.').pop().toLowerCase();
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'css') return 'css';
  if (['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx'].includes(ext)) return 'javascript';
  if (ext === 'json') return 'json';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
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

async function sendChat() {
  const text = elements.chatInput.value.trim();
  if (!text || sendInFlight) return;

  sendInFlight = true;
  elements.sendButton.disabled = true;
  elements.chatInput.value = '';
  addChatMessage('user', text);

  try {
    const response = await fetch('/api/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: state.activeProvider,
        model: state.activeModel || undefined,
        messages: [{ role: 'user', content: text }],
        stream: false,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    addChatMessage('assistant', data.content || '(resposta vazia)');
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.files));
    localStorage.setItem(PATHS_STORAGE_KEY, JSON.stringify(state.diskPaths));
    localStorage.setItem(ACTIVE_STORAGE_KEY, state.activeFile);
    return true;
  } catch (error) {
    console.warn('Não foi possível salvar no armazenamento local.', error);
    return false;
  }
}

function flashSaveButton(label) {
  elements.saveButton.textContent = label;
  clearTimeout(saveStatusTimer);
  saveStatusTimer = setTimeout(() => {
    elements.saveButton.textContent = 'Salvar';
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
}

function renderEditorTabs() {
  const names = Object.keys(state.files);
  elements.editorTabs.textContent = '';

  for (const name of names) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'editor-tab';
    tab.dataset.file = name;
    tab.title = state.diskPaths[name] || `${name} — sem arquivo em disco`;

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
  if (editorView) {
    editorView.dispatch({
      changes: {
        from: 0,
        to: editorView.state.doc.length,
        insert: state.files[fileName],
      },
      selection: { anchor: 0 },
      effects: languageCompartment.reconfigure(makeLanguageExtension(fileName)),
    });
  } else if (fallbackEditor) {
    fallbackEditor.value = state.files[fileName];
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

async function writeActiveFileTo(targetPath) {
  const data = await requestJson('/api/fs/write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: targetPath, content: state.files[state.activeFile] }),
  });

  const name = baseName(data.path);
  const newName = renameTab(state.activeFile, uniqueTabName(name, data.path));
  if (newName === state.activeFile) state.activeFile = newName;

  state.diskPaths[state.activeFile] = data.path;
  state.savedSnapshots[state.activeFile] = state.files[state.activeFile];

  renderEditorTabs();
  updateFileStatus();
  persistLocal();
  flashSaveButton('Salvo');
  closeFileModal();
  return data;
}

function saveActiveFile() {
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

async function openFileFromPath(targetPath) {
  const data = await requestJson('/api/fs/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: targetPath }),
  });

  const existing = Object.keys(state.files).find((name) => state.diskPaths[name] === data.path);

  if (existing && isDirty(existing)) {
    if (!window.confirm(`${existing} tem alterações não salvas. Recarregar do disco?`)) {
      setActiveFile(existing);
      closeFileModal();
      return;
    }
  }

  const name = existing || uniqueTabName(baseName(data.path), data.path);

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
  const kind = fileKind(state.activeFile);
  if (options.force) {
    rendered.preview = null;
    rendered.run = null;
  }

  renderViewerTabs(kind);

  const tab = state.viewerTab;
  elements.frame.classList.toggle('hidden', tab !== 'preview' && tab !== 'run');
  elements.consolePanel.classList.toggle('hidden', tab !== 'console');
  elements.treePanel.classList.toggle('hidden', tab !== 'tree');
  elements.textPanel.classList.toggle('hidden', tab !== 'text');

  if (tab === 'console') return;
  if (tab === 'tree') {
    renderJsonTree();
    return;
  }
  if (tab === 'text') {
    renderTextView(kind);
    return;
  }
  if (tab === 'run') {
    runJavascript(Boolean(options.force));
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
  renderViewer();
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
  const kind = fileKind(state.activeFile);

  if (kind === 'javascript') state.viewerTab = 'run';
  else if (kind === 'json') state.viewerTab = 'tree';
  else if (kind === 'text') state.viewerTab = 'text';
  else state.viewerTab = 'preview';

  renderViewer({ force: true });
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

function renderDocsets() {
  const fragment = document.createDocumentFragment();

  for (const doc of docsets) {
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

async function openDocsModal() {
  elements.docsModal.classList.remove('hidden');
  elements.docsResults.textContent = '';
  elements.docsList.textContent = '';
  elements.docsSearchArea.classList.add('hidden');
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
      button.addEventListener('click', () => {
        showDocsStatus(`${result.name} — ${result.path || ''}`);
      });
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

async function loadFarm() {
  try {
    const response = await fetch('/api/farm');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const farm = await response.json();
    state.activeProvider = farm.activeProvider || 'demo';

    const active = Array.isArray(farm.providers)
      ? farm.providers.find((provider) => provider.id === state.activeProvider)
      : null;
    state.activeModel = active ? pickModel(active.models) : null;
  } catch (error) {
    state.activeProvider = 'demo';
    state.activeModel = null;
  }

  elements.provider.textContent = `Provedor: ${state.activeProvider}`;
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

function bindEvents() {
  document.getElementById('btn-run').addEventListener('click', runActiveViewer);
  elements.saveButton.addEventListener('click', saveActiveFile);
  elements.saveAsButton.addEventListener('click', () => openFileModal('save'));
  elements.openButton.addEventListener('click', () => openFileModal('open'));
  document.getElementById('btn-docs').addEventListener('click', openDocsModal);
  document.getElementById('btn-settings').addEventListener('click', () => {
    window.alert('Configurações em breve');
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

    if (modifier && event.key === 'Enter') {
      event.preventDefault();
      sendChat();
    }

    if (event.key !== 'Escape') return;
    if (!elements.fileModal.classList.contains('hidden')) closeFileModal();
    if (!elements.docsModal.classList.contains('hidden')) closeDocsModal();
  });
}

async function init() {
  bindEvents();
  initResizers();
  updateErrorStatus();
  await loadFarm();
  await initEditor();
  renderEditorTabs();
  updateFileStatus();
  renderViewer({ force: true });
  loadWorkspaceInfo().catch(() => {
    elements.fileStatus.title = 'Backend de arquivos indisponível';
  });
}

init();
