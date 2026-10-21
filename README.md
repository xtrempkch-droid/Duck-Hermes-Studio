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

## DevDocs Offline

Clique em "Docs" na barra superior para baixar docsets e consultar offline. Os arquivos são gravados em `./data/devdocs/{slug}/` (`index.json` e `db.json`), servidos pelo manifesto `https://devdocs.io/docs.json` e pelo repositório de documentos `https://documents.devdocs.io`.

## CodeMirror

O CodeMirror 6 é carregado como ES modules via CDN (esm.sh) através de um import map em `public/index.html`. Não há bundler no projeto.

## Estrutura

| Caminho | Papel |
|---|---|
| `server.js` | Backend Express: `/api/health`, `/api/farm`, `/api/llm`, `/api/devdocs/*` |
| `services/detect-providers.js` | Detecção do celeiro de IAs em camadas |
| `services/llm-proxy.js` | Proxy OpenAI-compatible (DeepSeek, Ollama, llama.cpp, LM Studio) |
| `services/http-client.js` | `fetch` nativo em Node 18+ e cliente HTTP de compatibilidade em Node 16 |
| `public/` | Frontend vanilla: layout 3 blocos + 2 barras, CodeMirror 6, visualizador contextual, chat |

## Licença

MIT
