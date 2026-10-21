# Duck Hermes Studio

Editor minimalista com agente de IA. 3 blocos, 2 barras, backend local, frontend no navegador.

## Requisitos

- Node.js 22+ (LTS; o backend usa `fetch` e `AbortSignal.timeout` nativos)
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
| `public/` | Frontend vanilla: layout 3 blocos + 2 barras, CodeMirror 6, preview/console, chat |

## Licença

MIT
