# Duck Hermes Studio

Editor minimalista com agente de IA. 3 blocos, 2 barras, backend local, frontend no navegador.

## Requisitos

- Node.js 16+ (em Node 18+ usa `fetch` nativo; em Node 16 há um cliente HTTP interno de compatibilidade)
- (Opcional) Ollama, llama.cpp, LM Studio, Deep Rock IA ou chave DeepSeek
- Navegador com suporte a ES modules e import maps para carregar o CodeMirror 6

## Instalação

```bash
git clone https://github.com/SEU_USUARIO/duck-hermes-studio.git
cd duck-hermes-studio && npm install && npm start
```

Acesse http://localhost:3000.

## Provedores de IA

Detecção automática: Deep_Rock_IA (8080), Ollama (11434), llama.cpp (8081), LM Studio (1234), DeepSeek (chave).

Copie `config/providers.example.json` como referência de configuração. A chave da DeepSeek é lida de `DEEPSEEK_API_KEY`, definida no ambiente ou em um arquivo `.env` na raiz do projeto.

**Nota DeepSeek:** o modelo padrão no código é `deepseek-flash`. Não use `deepseek-chat` nem `deepseek-coder` (descontinuados); consulte a documentação oficial antes de trocar o identificador.

## Visualizador contextual (Bloco 2)

As abas do Bloco 2 mudam conforme o tipo do arquivo ativo:

| Arquivo | Abas | Comportamento |
|---|---|---|
| `index.html` | Preview / Console | iframe sandbox com CSS e JS do projeto injetados |
| `style.css` | Preview / Console | iframe com o HTML do projeto |
| `script.js` | Executar / Console | executa o script num iframe isolado |
| `data.json` | Árvore / Texto | árvore colapsável (`<details>`) ou JSON formatado |
| `notes.md` | Preview / Texto | Markdown renderizado no navegador ou fonte |
| outros | Texto | conteúdo bruto, somente leitura |

O botão "Executar" da barra superior atualiza o visualizador do arquivo ativo. O Console mostra `console.log`, `console.warn`, `console.error`, exceções e promises rejeitadas vindas do iframe, com timestamp, e alimenta o contador "Erros" da barra inferior.

## Celeiro de IAs (⚙)

O botão **⚙** abre o **Celeiro de IAs**, que mostra todos os candidatos com ✅/❌ e a dica de instalação:

| Ordem | Provedor | Endpoint |
|---|---|---|
| 1 | Deep Rock IA | `127.0.0.1:8080/health` |
| 2 | Ollama | `127.0.0.1:11434/api/tags` |
| 3 | llama.cpp | `127.0.0.1:8081/v1/models` |
| 4 | LM Studio | `127.0.0.1:1234/v1/models` |
| 5 | Docker (teste) | `127.0.0.1:8090/v1/models` |
| 6 | DeepSeek (nuvem) | chave `DEEPSEEK_API_KEY` |
| 7 | Máquinas da rede | cadastradas por você |

Cada provedor disponível pode ser escolhido com **Usar**; a escolha fica salva e aparece na barra inferior e no chat. **Redetectar** refaz a detecção sem reiniciar o app.

### Docker de teste

O projeto inclui um LLM simulado compatível com OpenAI para testar o celeiro sem gastar tokens:

```bash
docker compose -f docker/test-llm/docker-compose.yml up -d --build
```

Sobe em `http://127.0.0.1:8090/v1` (modelo `docker-test`) e passa a aparecer como ✅ no Celeiro.
Para derrubar: `docker compose -f docker/test-llm/docker-compose.yml down`.
Personalize com `HERMES_DOCKER_LLM_URL` e `HERMES_DOCKER_LLM_MODEL`.

### Máquinas e runner (rede local)

No Celeiro, em **Máquinas da rede local**, cadastre uma máquina com nome, host/IP, usuário SSH, porta e papel:

| Papel | O que faz |
|---|---|
| `runner` | Executa o comando de teste no projeto — localmente se o host for `127.0.0.1`/`localhost`, ou via SSH na máquina da rede |
| `llm` | Entra no celeiro como provedor OpenAI-compatible (`llmUrl`) |
| `both` | As duas coisas |

O runner é pensado para a máquina que tem Docker: o comando padrão é `npm test`, mas pode ser algo como
`docker compose run --rm tests`. Cada execução mostra saída, código de saída, duração e modo (`local`/`ssh`),
e fica registrada em `GET /api/runner/history` (últimas 20).

**Travas do runner:** comandos só podem começar com `npm`, `node`, `npx`, `docker`, `python3`, `pytest`, `make`, `bash` ou `sh`;
caracteres de encadeamento (`;`, `&&`, `|`, crases, `$`, redirecionamentos) são recusados; timeout de 180s;
conexão SSH não interativa (`BatchMode`) com `ConnectTimeout=5`. As máquinas ficam em `data/machines.json`.

### Endpoints do celeiro

`GET /api/farm`, `POST /api/farm/refresh`, `GET|POST /api/machines`,
`DELETE /api/machines/:id`, `POST /api/machines/:id/probe`, `POST /api/machines/:id/run-tests`,
`GET /api/runner/history`.

## Abrir e salvar arquivos

A barra superior tem **Abrir**, **Salvar** e **Salvar como**. Ambos os diálogos mostram a
**raiz do workspace** no topo e o caminho relativo do arquivo escolhido.

| Ação | O que faz |
|---|---|
| **Abrir** | Navega o workspace (pastas e arquivos) ou aceita um caminho digitado; o arquivo abre numa aba do editor |
| **Salvar** | Grava a aba ativa no caminho mostrado na barra inferior; se a aba ainda não tem caminho, abre o diálogo "Salvar como" |
| **Salvar como** | Escolhe a pasta e o nome do arquivo e grava no disco |
| `Ctrl+S` | Mesmo comportamento de **Salvar** (também persiste no `localStorage`) |

O caminho em disco aparece na barra inferior (ex.: `src/app.js`) e, ao passar o mouse,
mostra o caminho absoluto. Abas sem caminho exibem "Sem arquivo em disco" e um ponto
laranja indica alterações não salvas. A aba `×` fecha o arquivo (pedindo confirmação se
houver alterações pendentes).

**Onde os arquivos são gravados:** a raiz do workspace é o diretório de onde o servidor
foi iniciado (por padrão, a pasta do projeto). Defina `HERMES_WORKSPACE=/caminho` para
apontar para outro diretório. Caminhos fora da raiz são recusados (HTTP 403), assim como
gravações em `.git`. Limites: leitura de 2 MB e escrita de 5 MB por arquivo; arquivos
binários são recusados.

Endpoints usados pelo frontend: `GET /api/fs/info`, `GET /api/fs/list?path=`,
`POST /api/fs/read { path }` e `POST /api/fs/write { path, content }`.

## AGENTS.md — memória viva (Fase 5)

O botão **memória** no cabeçalho do chat abre o `AGENTS.md` do workspace. O arquivo é criado
automaticamente com **sete seções fixas**:

1. **Onde estou** — máquina, papel, estado atual, última sessão *(editável)*
2. **O que estou construindo** — objetivo da sessão
3. **Ferramentas à disposição** — gerada dinamicamente a partir do registro de ferramentas
4. **Convenções** — idioma, indentação, tamanho das mudanças
5. **Decisões recentes** — mantidas em no máximo 12 linhas, mais novas por último *(editável)*
6. **O que NÃO fazer** — limites explícitos
7. **Como me situar se eu (IA) me perder** — passos de recuperação

**Injeção de contexto:** no início de cada turno o app busca `/api/agents/context` e envia o
conteúdo como mensagem `system` (truncado em 8.000 caracteres, com aviso para usar `read_file`
no restante). Assim o modelo sempre vê as seções 6 e 7 antes de agir.

**Atualização ao fim:** quando o turno usou uma ferramenta que muda arquivos (`write_file`,
`edit_file`, `update_agents_md`), o app acrescenta uma linha datada na seção 5 via
`POST /api/agents/log`. As seções 1 e 5 também podem ser editadas à mão no modal.

Endpoints: `GET /api/agents`, `POST /api/agents { section, content }` (só seções **1 e 5**,
com `403` para as demais), `POST /api/agents/log { summary }` e `GET /api/agents/context`.
O arquivo é limitado a 64 KB e o README recomenda mantê-lo abaixo de 200 linhas.

## Ferramentas do Hermes (Fase 4)

O chat não é só conversa: o agente pode **ler arquivos e propor alterações**. O loop de tool-use roda no
navegador e cada passo aparece no feed como `🔧 ferramenta(arg=...)`.

| Ferramenta | Onde roda | Aprovação |
|---|---|---|
| `read_file(path, start?, end?)` | backend | Não |
| `write_file(path, content)` | backend (gera diff) | **Sim** |
| `edit_file(path, old, new)` | backend (gera diff) | **Sim** |
| `run_preview()` | navegador (recarrega o Bloco 2) | Não |
| `get_errors()` | navegador (erros do console) | Não |
| `update_agents_md(section, content)` | backend (`AGENTS.md` seções 1 e 5) | Não |
| `recall_memory()` | backend (lê `AGENTS.md`) | Não |

Como funciona:

1. O app envia o histórico + as definições das ferramentas para `/api/llm` (formato OpenAI `tools`).
2. Se o modelo responde `tool_calls`, cada chamada é executada e o resultado volta como mensagem `tool`.
3. `write_file`/`edit_file` nunca gravam direto: o backend devolve um **patch pendente** e o app abre o
   modal de revisão da Fase 3. Ao aprovar, o patch é aplicado e o agente recebe `{ applied: true }`;
   ao descartar, recebe `{ rejected: true }` e o arquivo fica intacto.
4. O loop continua até o modelo responder sem ferramentas (limite de 6 passos).

`edit_file` exige que o trecho antigo apareça **exatamente uma vez** (erro `409` se aparecer 0 ou N vezes),
e todo caminho passa pelas travas do workspace da Fase 3.

**Modelos sem suporte a `tools`:** se o provedor recusar o parâmetro, o app tenta de novo com um protocolo
de texto — o modelo responde um bloco `{"tool": "...", "arguments": {...}}` e o loop interpreta. Funciona
com qualquer provedor compatível com chat completion, inclusive os locais mais simples.

Endpoints: `GET /api/tools` (definições + quais são de servidor/cliente) e
`POST /api/tools/execute { name, arguments }`.

## Diff e aprovação (Fase 3)

Nenhuma gravação em arquivo existente acontece sem revisão. Ao salvar (ou ao gravar por um
patch proposto), o backend calcula um **diff por linhas** e o app abre o modal **Revisar alterações**:

- linhas removidas em vermelho (`−`) e adicionadas em verde (`+`), com número de linha antigo/novo;
- resumo `+N −N` e caminho do arquivo (marcado como *arquivo novo* quando ainda não existe);
- **Aprovar e gravar** aplica o patch; **Descartar** (ou `Esc`) joga o patch fora e o arquivo fica intocado;
- se nada mudou, o modal nem aparece.

O diff usa o algoritmo de **Myers** (O(ND)) em `services/diff.js`.
Os patches ficam pendentes em memória com TTL de 15 minutos e limite de 20; o `apply` confere o hash do
conteúdo lido na revisão e recusa com `409` se o arquivo mudou no disco nesse meio-tempo — nesse caso é
preciso gerar o diff de novo.

Endpoints: `POST /api/patch/preview { path, content }` → `{ id, path, exists, changed, stats, diff }`,
`POST /api/patch/apply { id }`, `POST /api/patch/reject { id }` e `GET /api/patch/pending`.
Esse é o mesmo caminho que as ferramentas do agente usarão na Fase 4.

## DevDocs Offline

Clique em **Docs** na barra superior. O modal lista os docsets do manifesto
`https://devdocs.io/docs.json`, com **filtro por nome/slug**, tamanho do docset e botão
**Baixar** (ou **Baixado ✓**). Os arquivos vêm de `https://documents.devdocs.io/{slug}/{index,db}.json`
e são gravados em `./data/devdocs/{slug}/`.

Com um docset baixado, use a busca (`/api/devdocs/search`, ranqueada por prefixo) e clique em um
resultado para **ler o conteúdo** da entrada, renderizado a partir do `db.json` em um iframe isolado
(`/api/devdocs/entry`). Um docset só é considerado baixado quando `index.json` **e** `db.json` existem,
e os dois são cacheados em memória para acelerar busca e leitura.

## CodeMirror

O CodeMirror 6 é carregado como ES modules via CDN (esm.sh) através de um import map em `public/index.html`. Não há bundler no projeto.

## Estrutura

| Caminho | Papel |
|---|---|
| `server.js` | Backend Express: `/api/health`, `/api/farm`, `/api/llm`, `/api/devdocs/*` |
| `services/detect-providers.js` | Detecção do celeiro de IAs em camadas |
| `services/llm-proxy.js` | Proxy OpenAI-compatible (DeepSeek, Ollama, llama.cpp, LM Studio) |
| `services/http-client.js` | `fetch` nativo em Node 18+ e cliente HTTP de compatibilidade em Node 16 |
| `services/file-store.js` | Leitura/escrita real de arquivos com raiz de workspace e travas de segurança |
| `services/machines.js` | Registro de máquinas, probe (LLM/Docker) e execução de testes no runner |
| `services/diff.js` | Diff por linhas (Myers) e estatísticas de adições/remoções |
| `services/patches.js` | Patches pendentes de aprovação (TTL, hash do original, apply/reject) |
| `services/tools.js` | Ferramentas do Hermes (`read_file`, `write_file`, `edit_file`, memória) e definições JSON Schema |
| `services/agents.js` | `AGENTS.md`: 7 seções, leitura/atualização, decisões recentes e injeção de contexto |
| `docker/test-llm/` | LLM simulado em container para testar o celeiro (porta 8090) |
| `scripts/self-test.js` | Testes rápidos (`npm test`) usados também pelo runner e no CI |
| `public/` | Frontend vanilla: layout 3 blocos + 2 barras, CodeMirror 6, visualizador contextual, chat |

## Licença

MIT
