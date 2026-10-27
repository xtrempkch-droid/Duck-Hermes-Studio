# AGENTS.md

Memória viva do projeto, lida no início de cada turno e atualizada ao fim.

## 1. Onde estou

- **Projeto:** Duck Hermes Studio — editor local (Express + frontend vanilla) com agente de IA. Roda em `:3000` (`npm start`) ou como binário autocontido.
- **Estado:** fases 0–8 do documento **concluídas** + Fase 9 (matriz de visualizadores) + empacotamento multiplataforma + workspace trocável, conta do GitHub e novo arquivo.
- **Última sessão:** auditoria com correções de segurança — symlink fora do workspace (`file-store`), DNS rebinding via `Host` (`local-guard`), CSP `sandbox` em SVG no `/api/fs/raw` e `body-parser` atualizado.
- **Testes:** `npm test` → 74 testes (`scripts/self-test.js`), passando em Node 16 e 22.
- **Pontos abertos:** assinatura/notarização dos binários e push sem token (usa credenciais do sistema); renomear o diretório local/repo para `duck-hermes-studio`.
- **Comandos:** `npm start` (:3000) · `npm test` · `npm run start:app` (entrypoint empacotado) · `npm run build:linux|build:win|build:mac` → `dist/` (workflow: `.github/workflows/build.yml`).

## 2. O que estou construindo

- Editor minimalista de 3 blocos + 2 barras, IA opcional (modo demo sempre disponível), tudo local: o backend faz o que o navegador não pode (CORS, chaves, filesystem, exec, git).
- Regra de ouro: **nada grava ou executa sem aprovação explícita**; o que não existe é mostrado com ❌ e dica de instalação, nunca inventado.

## 3. Ferramentas à disposição

- `read_file` (backend): Lê um arquivo de texto do workspace. Use start/end (1-based, inclusivos) para ler apenas um trecho.
- `write_file` (backend): Propõe o conteúdo completo de um arquivo. A gravação só acontece após aprovação humana no diff.
- `edit_file` (backend): Propõe a substituição de um trecho exato por outro. O trecho antigo deve aparecer uma única vez.
- `run_preview` (navegador): Recarrega o visualizador (Bloco 2) com o estado atual do editor.
- `update_agents_md` (backend): Atualiza uma seção editável do AGENTS.md (1 = onde estou, 5 = decisões recentes).
- `recall_memory` (backend): Lê o AGENTS.md atual (memória viva do projeto).
- `get_errors` (navegador): Retorna os erros atualmente exibidos no console do visualizador.
- `delegate` (backend): Despacha uma tarefa para outro modelo do celeiro (local/cloud/docker/machine/any) e devolve a resposta.

## 4. Convenções

- Código e comentários em português; indentação de 2 espaços; sem bundler e sem framework CSS/JS.
- Dependência de runtime: apenas `express`. Dev: `@yao-pkg/pkg`. Não adicione outras sem necessidade.
- Mudança pequena, verificada de ponta a ponta (teste + API real + navegador quando há UI) e commitada por fase.
- Node mínimo 16: `services/http-client.js` usa `fetch` nativo em 18+ e um cliente próprio em 16 (sempre passe `{ timeout }`).

## 5. Decisões recentes

Mapa do que já existe (para não reimplementar):

- **Backend** `server.js`: `/api/health`, `/api/farm`(+refresh), `/api/llm` (JSON/SSE, relay), `/api/machines*`, `/api/runner/history`, `/api/fs/{info,list,read,write,raw}`, `/api/workspace*`, `/api/config*`, `/api/patch/*`, `/api/tools*`, `/api/agents*`, `/api/devdocs/*`, `/api/exec*`, `/api/git/*` (status/diff/log/stage/unstage/discard/commit/remotes/remote/fetch/pull/push), `/api/ai-talk`, `/api/relay`.
- **Serviços**: `web` (fetch/search com bloqueio de rede local, 2 MB, 15 s, HTML→texto sem dependências), `detect-providers` (celeiro em camadas + demo + relays), `llm-proxy`, `relay` (OpenRouter/Gemini), `file-store` (raiz do workspace, 2 MB leitura / 5 MB escrita / 8 MB mídia, valida `realpath` contra symlink), `local-guard` (Host contra DNS rebinding), `paths` (workspace trocável + `dataDir()` com `HERMES_DATA_DIR`), `config` (token GitHub validado, `http.extraHeader` no git), `patches`+`diff` (Myers, TTL 15 min), `tools`, `agents`, `exec`, `machines`, `git`, `ai-talk`.
- **Internet**: `web_fetch`/`web_search` no `services/web.js`, desligáveis no ⚙; busca via DuckDuckGo ou `HERMES_SEARCH_URL` (SearXNG).
- **Chaves**: coladas no ⚙ (`POST /api/config/keys`), aplicadas em `process.env`, prioridade sobre `.env`, remoção restaura o ambiente; não são validadas na hora (erro aparece no primeiro uso).
- **Docs**: `README.md` = usuário (com prints em `docs/img/`); `README-TECNICO.md` = arquitetura/endpoints/travas. Prints são capturados do app real via CDP a 1440x900 e otimizados com Pillow.
- **Frontend** `public/app.js`: CodeMirror 6 via import map (esm.sh) com fallback textarea; abas por tipo (html/css/js/json/md/py/yaml/toml/código/imagem/pdf/binário); árvore de arquivos; modais de arquivo, diff, exec, AGENTS, celeiro, diagnóstico e Git; chat com loop de tool-use (6 passos, fallback por texto).
- **Rede**: servidor escuta em `127.0.0.1` por padrão (`HERMES_HOST` para sobrescrever) porque há endpoints de arquivo/exec.
- **Travas**: patch obrigatório para gravar; exec só com allowlist, sem shell, timeout 30 s, cwd no workspace, sudo/`rm -rf /` bloqueados; Git sem `reset --hard`/`merge`/`rebase`/`config`, commit e `push`/`pull` exigem `confirm: true`, `pull` é `--ff-only`; trocar de pasta descarta abas não salvas (com aviso); `local-guard` valida o `Host` (DNS rebinding) e `file-store` bloqueia symlink que sai da raiz; `/api/fs/raw` usa `nosniff` e CSP `sandbox` em SVG.
- **Tema**: diff Myers, aprovação humana, detecção honesta de provedores, modo demo explícito, documentação viva (README + AGENTS.md).
- **Empacotamento**: `@yao-pkg/pkg` (node22, via npx) gera `dist/duck-hermes-studio-<alvo>`; o snapshot é read-only, então `scripts/packaged.js` define `HERMES_DATA_DIR` no perfil do usuário e `HERMES_WORKSPACE` na pasta atual. O `.env` **não** entra no binário.
- **Armadilhas conhecidas**: `:has()` no CSS é só reforço (a classe `.configured` faz o trabalho); esm.sh precisa de `?external=` para não duplicar `@codemirror/state`; `agents.js` ↔ `tools.js` têm require tardio (ciclo); Ollama local pode levar minutos (use o LLM de teste em `:8090`); chat do Playwright/headless exige `page.evaluate(() => el.click())`.

## 6. O que NÃO fazer

- Não gravar arquivos sem aprovação no diff.
- Não executar comandos fora do runner (`/api/exec` ou `/api/machines`); no Git, não usar `reset --hard`, `merge`, `rebase` nem `config`, e nunca enviar `push`/`pull` sem confirmação explícita.
- Não adicionar dependências sem necessidade; não usar framework CSS/JS.
- Não inventar provedor: se não respondeu, mostre ❌ com motivo e dica.

## 7. Como me situar se eu (IA) me perder

- Leia este arquivo inteiro, depois `README.md` (tem o detalhe de cada fase e endpoint).
- Confirme o estado real com `read_file`/`git status`/`npm test` antes de mudar qualquer coisa.
- Se o contexto estourar: resuma a seção 5 em 3 linhas e continue dali.
