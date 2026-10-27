# AGENTS.md

Memória viva do projeto, lida no início de cada turno e atualizada ao fim.

## 1. Onde estou

- **Projeto:** Duck Hermes Studio — editor local (Express + frontend vanilla) com agente de IA. Roda em `:3000` (`npm start`) ou como binário autocontido.
- **Estado:** fases 0–9 **concluídas** + empacotamento multiplataforma, workspace trocável, conta do GitHub, novo arquivo e **Fase 10 — paridade com o NexusAgent Studio** (MCP stdio, sandbox Docker, LSP, diagnósticos/log, plugins, contexto do editor, loop do agente no servidor, .gitignore).
- **Última sessão:** correções de segurança (symlink + TOCTOU, DNS rebinding, SVG, `data/`/`.env` fora do file-store, cabeçalhos, boot), porte dos recursos do `nexus-agent-studio` e fechamento das 7 recomendações da auditoria (risco do exec, módulos do frontend, fallback offline do CodeMirror, contrato HTTP).
- **Testes:** `npm test` → 100 testes (`scripts/self-test.js`), passando em Node 16 e 22 (inclui contrato HTTP com servidor real).
- **Pontos abertos:** assinatura/notarização dos binários e push sem token (usa credenciais do sistema); renomear o diretório local/repo para `duck-hermes-studio`; UI ainda não consome `/api/agent/run` (o loop do navegador continua sendo o padrão do chat).
- **Comandos:** `npm start` (:3000) · `npm test` · `npm run mcp` (servidor MCP stdio) · `npm run start:app` · `npm run build:linux|build:win|build:mac` → `dist/` (workflow: `.github/workflows/build.yml`).

## 2. O que estou construindo

- Editor minimalista de 3 blocos + 2 barras, IA opcional (modo demo sempre disponível), tudo local: o backend faz o que o navegador não pode (CORS, chaves, filesystem, exec, git).
- Regra de ouro: **nada grava ou executa sem aprovação explícita**; o que não existe é mostrado com ❌ e dica de instalação, nunca inventado.

## 3. Ferramentas à disposição

- `read_file` (backend): Lê um arquivo de texto do workspace. Use start/end (1-based, inclusivos) para ler apenas um trecho.
- `list_directory` (backend): Árvore recursiva com teto, ocultando `.git`, `node_modules`, caches e `.gitignore`.
- `write_file` (backend): Propõe o conteúdo completo de um arquivo. A gravação só acontece após aprovação humana no diff.
- `edit_file` (backend): Propõe a substituição de um trecho exato por outro. O trecho antigo deve aparecer uma única vez.
- `run_preview` (navegador): Recarrega o visualizador (Bloco 2) com o estado atual do editor.
- `update_agents_md` (backend): Atualiza uma seção editável do AGENTS.md (1 = onde estou, 5 = decisões recentes).
- `recall_memory` (backend): Lê o AGENTS.md atual (memória viva do projeto).
- `get_errors` (navegador): Retorna os erros atualmente exibidos no console do visualizador.
- `delegate` (backend): Despacha uma tarefa para outro modelo do celeiro (local/cloud/docker/machine/any) e devolve a resposta.
- `get_editor_context` (backend): Arquivo ativo, cursor, seleção, abas e estado de salvamento (a UI empurra via `POST /api/editor/context`).
- `list_models` (backend): Lista modelos de um servidor local (Ollama `/api/tags` ou OpenAI `/v1/models`); só loopback/rede privada.

## 4. Convenções

- Código e comentários em português; indentação de 2 espaços; sem bundler e sem framework CSS/JS.
- Dependência de runtime: apenas `express`. Dev: `@yao-pkg/pkg`. Não adicione outras sem necessidade.
- Mudança pequena, verificada de ponta a ponta (teste + API real + navegador quando há UI) e commitada por fase.
- Node mínimo 16: `services/http-client.js` usa `fetch` nativo em 18+ e um cliente próprio em 16 (sempre passe `{ timeout }`).

## 5. Decisões recentes

Mapa do que já existe (para não reimplementar):

- **Backend** `server.js`: `/api/health`, `/api/farm`(+refresh), `/api/llm` (JSON/SSE, relay), `/api/machines*`, `/api/runner/history`, `/api/fs/{info,list,read,write,raw}`, `/api/workspace*`, `/api/config*`, `/api/patch/*`, `/api/tools*`, `/api/agents*`, `/api/devdocs/*`, `/api/exec*`, `/api/git/*` (status/diff/log/stage/unstage/discard/commit/remotes/remote/fetch/pull/push), `/api/ai-talk`, `/api/relay`.
- **Serviços**: `web` (fetch/search com bloqueio de rede local, 2 MB, 15 s, HTML→texto sem dependências), `detect-providers` (celeiro em camadas + demo + relays), `llm-proxy`, `relay` (OpenRouter/Gemini), `file-store` (raiz do workspace, 2 MB leitura / 5 MB escrita / 8 MB mídia, valida `realpath` contra symlink e bloqueia `data/`/`.env`), `local-guard` (Host contra DNS rebinding), `paths` (workspace trocável + `dataDir()` com `HERMES_DATA_DIR`), `config` (token GitHub validado, `http.extraHeader` no git), `patches`+`diff` (Myers, TTL 15 min), `tools`, `agents`, `exec`, `machines`, `git`, `ai-talk`.
- **Fase 10 (Nexus)**: `sandbox` (docker run descartável; `mode:"sandbox"` no `/api/exec`), `activity-log` (log append-only em `data/activity.jsonl` + hints), `diagnostics` (gcc/tsc/rustc/python), `gitignore`, `lsp/*` (framing, cliente, stdio, gerente), `editor-context`, `plugins` (`.plg.js`, carga explícita, permissões), `mcp` (`npm run mcp`, JSON-RPC por linha), `agent-loop` (`POST /api/agent/run`). Endpoints novos: `/api/sandbox*`, `/api/activity*`, `/api/editor/context`, `/api/lsp*`, `/api/plugins*`, `/api/agent/run`.
- **Internet**: `web_fetch`/`web_search` no `services/web.js`, desligáveis no ⚙; busca via DuckDuckGo ou `HERMES_SEARCH_URL` (SearXNG).
- **Chaves**: coladas no ⚙ (`POST /api/config/keys`), aplicadas em `process.env`, prioridade sobre `.env`, remoção restaura o ambiente; não são validadas na hora (erro aparece no primeiro uso).
- **Docs**: `README.md` = usuário (com prints em `docs/img/`); `README-TECNICO.md` = arquitetura/endpoints/travas. Prints são capturados do app real via CDP a 1440x900 e otimizados com Pillow.
- **Frontend** `public/app.js`: módulo ES (importa `public/lib/*.mjs`); CodeMirror 6 via import map (esm.sh, versões pinadas) com fallback textarea em 5 s e upgrade automático; abas por tipo (html/css/js/json/md/py/yaml/toml/código/imagem/pdf/binário); árvore de arquivos (◉ oculta ignorados); modais de arquivo, diff, exec (mostra isolamento), AGENTS, celeiro (com plugins), diagnóstico e Git; chat com loop de tool-use (6 passos, fallback por texto); diagnósticos clicáveis no Console; modal de exec mostra `Isolamento` e `Risco`.
- **Rede**: servidor escuta em `127.0.0.1` por padrão (`HERMES_HOST` para sobrescrever) porque há endpoints de arquivo/exec.
- **Travas**: patch obrigatório para gravar; exec local só com allowlist, sem shell, timeout 30 s, cwd no workspace, sudo/`rm -rf /` bloqueados, e o payload diz `isolation: "none"` e `risk.level` (`interpreter` para bash/node/python — a aprovação é a trava real); exec `sandbox` usa Docker com caps dropadas e rede off; Git sem `reset --hard`/`merge`/`rebase`/`config`, commit e `push`/`pull` exigem `confirm: true`, `pull` é `--ff-only`; trocar de pasta descarta abas não salvas (com aviso); `local-guard` valida o `Host` (DNS rebinding) e `file-store` bloqueia symlink que sai da raiz (realpath + `lstat` do componente final) e o diretório de dados; `/api/fs/raw` usa `nosniff` e CSP `sandbox` em SVG; cabeçalhos de enquadramento/CSP curta em todas as respostas.
- **Tema**: diff Myers, aprovação humana, detecção honesta de provedores, modo demo explícito, documentação viva (README + AGENTS.md).
- **Empacotamento**: `@yao-pkg/pkg` (node22, via npx) gera `dist/duck-hermes-studio-<alvo>`; o snapshot é read-only, então `scripts/packaged.js` define `HERMES_DATA_DIR` no perfil do usuário e `HERMES_WORKSPACE` na pasta atual. O `.env` **não** entra no binário.
- **Armadilhas conhecidas**: `public/lib/*.mjs` são ESM servidos por extensão (teste importa via `pathToFileURL`); o CodeMirror depende do esm.sh, então o fallback de 5 s é intencional; `:has()` no CSS é só reforço (a classe `.configured` faz o trabalho); esm.sh precisa de `?external=` para não duplicar `@codemirror/state`; `agents.js` ↔ `tools.js` têm require tardio (ciclo); Ollama local pode levar minutos (use o LLM de teste em `:8090`); chat do Playwright/headless exige `page.evaluate(() => el.click())`; plugins e LSP só rodam com binário/arquivo presentes — nunca baixar sozinho; `no-new-privileges` + `--user` quebra em alguns kernels (o sandbox repete sem a flag e avisa); workspace em `/tmp` privado do shell de teste não é visível ao daemon Docker (use pasta no home).

## 6. O que NÃO fazer

- Não gravar arquivos sem aprovação no diff.
- Não executar comandos fora do runner (`/api/exec` ou `/api/machines`); no Git, não usar `reset --hard`, `merge`, `rebase` nem `config`, e nunca enviar `push`/`pull` sem confirmação explícita.
- Não adicionar dependências sem necessidade; não usar framework CSS/JS.
- Não inventar provedor: se não respondeu, mostre ❌ com motivo e dica.
- Não carregar plugin sem escolha explícita do usuário, nem instalar language server/ferramenta sozinho: o app explica o que falta.
- Não chamar de "isolado" o modo `local` do exec: o payload e a UI dizem `sem isolamento`.

## 7. Como me situar se eu (IA) me perder

- Leia este arquivo inteiro, depois `README.md` (tem o detalhe de cada fase e endpoint).
- Confirme o estado real com `read_file`/`git status`/`npm test` antes de mudar qualquer coisa.
- Se o contexto estourar: resuma a seção 5 em 3 linhas e continue dali.
