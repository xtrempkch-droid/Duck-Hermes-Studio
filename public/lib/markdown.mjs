/**
 * Renderizador Markdown mínimo (sem dependências) usado pelo visualizador.
 * Escapa HTML antes de qualquer formatação: o documento vem do workspace e pode
 * conter `<script>`, que precisa virar texto.
 */

import { escapeHtml } from './html.mjs';

export function renderInlineMarkdown(text) {
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

export function renderMarkdown(markdown) {
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

export function buildMarkdownDocument(markdown) {
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
