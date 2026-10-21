const STORAGE_KEY = 'duck-hermes-files';
const LEGACY_STORAGE_KEY = 'win98-hermes-files';

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
};

function loadFiles() {
  const files = { ...DEFAULT_FILES };

  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return files;
    const saved = JSON.parse(raw);
    for (const name of Object.keys(files)) {
      if (saved && typeof saved[name] === 'string') {
        files[name] = saved[name];
      }
    }
  } catch (error) {
    console.warn('Não foi possível restaurar os arquivos salvos.', error);
  }

  return files;
}

const state = {
  files: loadFiles(),
  activeFile: 'index.html',
  activeProvider: 'demo',
  activeModel: null,
  errorCount: 0,
};

const elements = {
  frame: document.getElementById('preview-frame'),
  consolePanel: document.getElementById('console-panel'),
  consoleTab: document.querySelector('.viewer-tab[data-tab="console"]'),
  previewTab: document.querySelector('.viewer-tab[data-tab="preview"]'),
  cursor: document.getElementById('status-cursor'),
  provider: document.getElementById('status-provider'),
  errors: document.getElementById('status-errors'),
  saveButton: document.getElementById('btn-save'),
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
      if (fileName.endsWith('.html')) return htmlModule.html();
      if (fileName.endsWith('.css')) return cssModule.css();
      return javascriptModule.javascript();
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

function setActiveFile(fileName) {
  if (typeof state.files[fileName] !== 'string') return;

  state.activeFile = fileName;
  document.querySelectorAll('.editor-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.file === fileName);
  });

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
    editorView.focus();
  } else if (fallbackEditor) {
    fallbackEditor.value = state.files[fileName];
    fallbackEditor.focus();
    updateFallbackCursor();
  }
}

function buildPreviewDocument() {
  const interceptor = `<script>
(function(){const _l=console.log;console.log=function(...a){window.parent.postMessage({type:'CONSOLE_LOG',level:'info',data:a.join(' ')},'*');_l.apply(console,a)};window.onerror=function(m){window.parent.postMessage({type:'CONSOLE_LOG',level:'error',data:m},'*')}})();
</script>`;

  const style = `<style>${state.files['style.css'].replace(/<\/style/gi, '<\\/style')}</style>`;
  const script = `<script>${state.files['script.js'].replace(/<\/script/gi, '<\\/script')}</script>`;

  const headInjection = interceptor + style;
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

function updatePreview() {
  clearConsole();
  elements.frame.srcdoc = buildPreviewDocument();
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

function saveFiles() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.files));
    elements.saveButton.textContent = 'Salvo';
    clearTimeout(saveStatusTimer);
    saveStatusTimer = setTimeout(() => {
      elements.saveButton.textContent = 'Salvar';
    }, 1500);
  } catch (error) {
    elements.saveButton.textContent = 'Erro ao salvar';
    clearTimeout(saveStatusTimer);
    saveStatusTimer = setTimeout(() => {
      elements.saveButton.textContent = 'Salvar';
    }, 1500);
  }
}

function switchViewerTab(tab) {
  const showConsole = tab === 'console';
  document.querySelectorAll('.viewer-tab').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tab);
  });
  elements.frame.classList.toggle('hidden', showConsole);
  elements.consolePanel.classList.toggle('hidden', !showConsole);
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
  document.getElementById('btn-run').addEventListener('click', updatePreview);
  document.getElementById('btn-save').addEventListener('click', saveFiles);
  document.getElementById('btn-docs').addEventListener('click', openDocsModal);
  document.getElementById('btn-settings').addEventListener('click', () => {
    window.alert('Configurações em breve');
  });

  document.querySelectorAll('.viewer-tab').forEach((button) => {
    button.addEventListener('click', () => switchViewerTab(button.dataset.tab));
  });

  document.querySelectorAll('.editor-tab').forEach((button) => {
    button.addEventListener('click', () => setActiveFile(button.dataset.file));
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
      saveFiles();
    }

    if (modifier && event.key === 'Enter') {
      event.preventDefault();
      sendChat();
    }

    if (event.key === 'Escape' && !elements.docsModal.classList.contains('hidden')) {
      closeDocsModal();
    }
  });
}

async function init() {
  bindEvents();
  initResizers();
  updateErrorStatus();
  await loadFarm();
  await initEditor();
  updatePreview();
}

init();
