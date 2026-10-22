# AGENTS.md

Memória viva do projeto, lida no início de cada turno e atualizada ao fim.

## 1. Onde estou

- Máquina: workstation Linux (Ubuntu 25.10), Node 16+ e Docker disponíveis.
- Papel: editor local com agente; backend Express em :3000 e frontend vanilla.
- Estado atual: Fases 0, 0.5, 1, 2, 3, 4, 5, 6, 7 e 8 do documento + Fase 9 (matriz de visualizadores).
- Última sessão: Fase 9 (imagem, PDF, binário com "abrir externo", YAML/TOML e código com highlight).

## 2. O que estou construindo

- Objetivo: evoluir o Duck Hermes Studio em fases pequenas e verificáveis.

## 3. Ferramentas à disposição

- `read_file` (backend): Lê um arquivo de texto do workspace. Use start/end (1-based, inclusivos) para ler apenas um trecho.
- `write_file` (backend): Propõe o conteúdo completo de um arquivo. A gravação só acontece após aprovação humana no diff.
- `edit_file` (backend): Propõe a substituição de um trecho exato por outro. O trecho antigo deve aparecer uma única vez.
- `run_preview` (navegador): Recarrega o visualizador (Bloco 2) com o estado atual do editor.
- `update_agents_md` (backend): Atualiza uma seção editável do AGENTS.md (1 = onde estou, 5 = decisões recentes).
- `recall_memory` (backend): Lê o AGENTS.md atual (memória viva do projeto).
- `get_errors` (navegador): Retorna os erros atualmente exibidos no console do visualizador.
- `delegate` (backend): Despacha uma tarefa para outro modelo do celeiro (ai-talk); `prefer_role` = local, cloud, docker, machine ou any.

## 4. Convenções

- Código e comentários em português.
- Indentação de 2 espaços, sem ponto e vírgula opcional fora do padrão do arquivo.
- Mudanças pequenas, sempre verificadas.

## 5. Decisões recentes

- 2026 · Fase 0 + 0.5: backend Express, layout 3 blocos + 2 barras, CodeMirror, DevDocs offline.
- 2026 · Fase 1: Bloco 2 contextual (HTML/CSS/JS/JSON/Markdown) com console unificado.
- 2026 · Fase 2: Celeiro de IAs, máquina runner com Docker e LLM de teste em container.
- 2026 · Fase 3: diff Myers + modal de aprovação obrigatório antes de gravar.
- 2026 · Fase 4: ferramentas read_file/write_file/edit_file e loop de tool-use.
- 2026 · Fase 5: AGENTS.md com 7 seções, edição das seções 1 e 5 e injeção de contexto.
- 2026 · Fase 6: viewer Python e execução aprovada com allowlist, timeout e cwd restrito.
- 2026 · Fase 7: diagnóstico inicial com ✅/❌ e dicas copiáveis; modo demo sempre disponível e explícito.
- 2026 · Fase 8: plugin Git (status/diff/log/stage/commit com confirmação), delegação `delegate` (ai-talk) e relay OpenRouter/Gemini.
- 2026 · Fase 9: matriz de visualizadores completa (imagem/PDF/binário via /api/fs/raw, outline YAML/TOML, código read-only com highlight).
- 2026 · Interface: menu Arquivo (Executar/Abrir/Salvar/Salvar como/Árvore) e árvore lateral oculta por padrão.
- Nome do projeto: Duck Hermes Studio (o prompt original dizia Win98).
- Node mínimo 16; em Node 18+ usa fetch nativo, em Node 16 usa cliente HTTP interno.

## 6. O que NÃO fazer

- Não gravar arquivos sem aprovação no diff.
- Não executar comandos fora do runner (nem `git push/pull/config` pelo plugin).
- Não adicionar dependências sem necessidade.

## 7. Como me situar se eu (IA) me perder

- Leia este arquivo inteiro antes de agir.
- Use read_file para confirmar o estado real.
- Se o contexto estourar, resuma a seção 5 e continue.
