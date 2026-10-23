'use strict';

const dns = require('dns').promises;
const net = require('net');
const { fetch: fetchUrl } = require('./http-client');

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_CHARS = 20000;
const TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 3;
const MAX_RESULTS = 8;
const SEARCH_TIMEOUT_MS = 12000;

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'metadata',
  'metadata.google.internal',
  'instance-data',
]);

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.lan'];

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isPrivateIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;

  return false;
}

function isPrivateIpv6(address) {
  const value = String(address).toLowerCase().split('%')[0];

  if (value === '::' || value === '::1') return true;
  if (value.startsWith('fe80')) return true;
  if (/^f[cd][0-9a-f]{2}:/.test(value)) return true;
  if (value.startsWith('ff')) return true;

  // IPv4 mapeado (::ffff:192.168.0.1)
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);

  return false;
}

function isPrivateAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return true;
}

function assertHostnameAllowed(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');

  if (!host) throw httpError('URL sem host', 400);
  if (BLOCKED_HOSTNAMES.has(host)) throw httpError('acesso à rede local não é permitido: ' + host, 403);
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw httpError('acesso à rede local não é permitido: ' + host, 403);
  }
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw httpError('acesso à rede local não é permitido: ' + host, 403);
    return;
  }
}

/** Resolve o DNS e recusa qualquer endereço privado (evita SSRF com nome público apontando para dentro). */
async function assertResolvesPublic(hostname) {
  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch (error) {
    throw httpError('não foi possível resolver ' + hostname, 404);
  }

  if (!addresses || addresses.length === 0) throw httpError('não foi possível resolver ' + hostname, 404);

  for (const entry of addresses) {
    if (isPrivateAddress(entry.address)) {
      throw httpError('acesso à rede local não é permitido: ' + hostname, 403);
    }
  }
}

function normalizeUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw httpError('informe a URL', 400);

  let text = raw.trim();
  if (!/^https?:\/\//i.test(text)) {
    if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(text)) text = 'https://' + text;
    else throw httpError('a URL precisa começar com http:// ou https://', 400);
  }
  if (text.length > 2000) throw httpError('URL longa demais', 400);

  let parsed;
  try {
    parsed = new URL(text);
  } catch (error) {
    throw httpError('URL inválida', 400);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw httpError('só http e https são permitidos', 400);
  }
  if (parsed.username || parsed.password) {
    throw httpError('não envie usuário/senha na URL', 400);
  }

  parsed.hash = '';
  assertHostnameAllowed(parsed.hostname);

  return parsed;
}

async function readBounded(response, maxBytes) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared && declared > maxBytes) {
    throw httpError('página grande demais (' + Math.round(declared / 1024) + ' KB)', 413);
  }

  if (!response.body) {
    const text = await response.text();
    return { text: text.slice(0, maxBytes), truncated: text.length > maxBytes, bytes: text.length };
  }

  const parts = [];
  let total = 0;
  let truncated = false;

  // fetch nativo (ReadableStream) e shim do Node 16 (reader próprio) expõem APIs diferentes
  if (typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        truncated = true;
        parts.push(Buffer.from(value).subarray(0, value.byteLength - (total - maxBytes)));
        try {
          await reader.cancel();
        } catch (error) {
          /* cancelar é melhor esforço */
        }
        break;
      }
      parts.push(Buffer.from(value));
    }
  } else if (typeof response.body.read === 'function') {
    for (;;) {
      const { done, value } = await response.body.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        truncated = true;
        parts.push(Buffer.from(value).subarray(0, value.byteLength - (total - maxBytes)));
        break;
      }
      parts.push(Buffer.from(value));
    }
  } else {
    const text = await response.text();
    return { text: text.slice(0, maxBytes), truncated: text.length > maxBytes, bytes: text.length };
  }

  return { text: Buffer.concat(parts).toString('utf8'), truncated, bytes: Math.min(total, maxBytes) };
}

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  deg: '°',
  middot: '·',
  eacute: 'é',
  atilde: 'ã',
  ccedil: 'ç',
  otilde: 'õ',
};

function decodeEntities(text) {
  return String(text).replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (match, code) => {
    if (code[0] === '#') {
      const value = code[1] === 'x' || code[1] === 'X'
        ? Number.parseInt(code.slice(2), 16)
        : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(value) && value > 0 && value < 0x110000 ? String.fromCodePoint(value) : match;
    }
    const named = ENTITIES[code.toLowerCase()];
    return named === undefined ? match : named;
  });
}

/** HTML → texto legível, sem dependências: remove ruído e preserva quebras de bloco. */
function htmlToText(html) {
  let text = String(html).replace(/<!--[\s\S]*?-->/g, ' ');
  text = text.replace(/<(script|style|noscript|template|svg|canvas)\b[\s\S]*?<\/\1>/gi, ' ');
  text = text.replace(/<head\b[\s\S]*?<\/head>/gi, ' ');
  text = text.replace(/<\/(p|div|section|article|header|footer|li|tr|h[1-6]|blockquote|pre)>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<li\b[^>]*>/gi, '\n- ');
  text = text.replace(/<h([1-6])\b[^>]*>/gi, (match, level) => '\n' + '#'.repeat(Number(level)) + ' ');
  text = text.replace(/<[^>]+>/g, ' ');
  text = decodeEntities(text);
  text = text.replace(/[ \t\f\v\u00a0]+/g, ' ');
  text = text.replace(/ *\n */g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

function extractTitle(html) {
  const match = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeEntities(match[1]).replace(/\s+/g, ' ').trim().slice(0, 200) : null;
}

async function followOnce(parsed) {
  await assertResolvesPublic(parsed.hostname);

  const response = await fetchUrl(parsed.toString(), {
    redirect: 'manual',
    headers: {
      'User-Agent': 'DuckHermesStudio/0.1 (+consulta do agente)',
      Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    },
    timeout: TIMEOUT_MS,
  });

  return response;
}

async function fetchPage(rawUrl, options) {
  const settings = options || {};
  const maxBytes = settings.maxBytes || MAX_BYTES;

  let parsed = normalizeUrl(rawUrl);
  let response;
  let hops = 0;

  for (;;) {
    try {
      response = await followOnce(parsed);
    } catch (error) {
      if (error.name === 'AbortError') throw httpError('a página não respondeu em ' + TIMEOUT_MS / 1000 + 's', 504);
      throw error.status ? error : httpError('não foi possível acessar: ' + error.message, 502);
    }

    const location = response.headers.get('location');
    if ([301, 302, 303, 307, 308].includes(response.status) && location) {
      if (hops >= MAX_REDIRECTS) throw httpError('redirecionamentos demais', 508);
      hops += 1;
      parsed = normalizeUrl(new URL(location, parsed).toString());
      continue;
    }

    break;
  }

  if (response.status === 404) throw httpError('a página não existe (404)', 404);
  if (response.status === 401 || response.status === 403) {
    throw httpError('o site bloqueou o acesso (HTTP ' + response.status + ')', 403);
  }
  if (response.status === 429) throw httpError('o site pediu para esperar (HTTP 429)', 429);
  if (!response.ok) throw httpError('o site respondeu HTTP ' + response.status, 502);

  const contentType = response.headers.get('content-type') || '';
  if (/^(image|audio|video|font)\//i.test(contentType) || /octet-stream/i.test(contentType)) {
    throw httpError('conteúdo binário (' + contentType.split(';')[0] + ') não é suportado', 415);
  }

  const body = await readBounded(response, maxBytes);

  if (/^(application|text)\/(json|xml)/i.test(contentType)) {
    return {
      url: parsed.toString(),
      status: response.status,
      contentType: contentType.split(';')[0],
      title: null,
      text: body.text.slice(0, settings.maxChars || MAX_TEXT_CHARS),
      truncated: body.truncated || body.text.length > (settings.maxChars || MAX_TEXT_CHARS),
      bytes: body.bytes,
    };
  }

  const title = extractTitle(body.text);
  const text = htmlToText(body.text);
  const limit = settings.maxChars || MAX_TEXT_CHARS;

  return {
    url: parsed.toString(),
    status: response.status,
    contentType: contentType.split(';')[0] || 'text/html',
    title,
    text: text.slice(0, limit),
    truncated: body.truncated || text.length > limit,
    bytes: body.bytes,
  };
}

function decodeDuckUrl(href) {
  const match = String(href).match(/[?&]uddg=([^&]+)/);
  if (match) {
    try {
      return decodeURIComponent(match[1]);
    } catch (error) {
      return href;
    }
  }
  return href.startsWith('//') ? 'https:' + href : href;
}

function parseDuckDuckGo(html, limit) {
  const results = [];
  const linkPattern = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetPattern = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;

  const snippets = [];
  let snippetMatch;
  while ((snippetMatch = snippetPattern.exec(html)) !== null) {
    snippets.push(htmlToText(snippetMatch[1]).slice(0, 300));
  }

  let match;
  let index = 0;
  while ((match = linkPattern.exec(html)) !== null && results.length < limit) {
    const url = decodeDuckUrl(match[1]);
    if (!/^https?:\/\//i.test(url)) continue;
    results.push({
      title: htmlToText(match[2]).slice(0, 200),
      url,
      snippet: snippets[index] || '',
    });
    index += 1;
  }

  return results;
}

function parseSearxng(payload, limit) {
  const items = Array.isArray(payload && payload.results) ? payload.results : [];
  return items.slice(0, limit).map((item) => ({
    title: String(item.title || '').slice(0, 200),
    url: String(item.url || ''),
    snippet: String(item.content || '').slice(0, 300),
  }));
}

async function search(rawQuery, options) {
  const settings = options || {};
  const query = typeof rawQuery === 'string' ? rawQuery.trim() : '';

  if (query.length < 2) throw httpError('consulta curta demais', 400);
  if (query.length > 300) throw httpError('consulta limitada a 300 caracteres', 400);

  const limit = Math.min(Math.max(Number(settings.limit) || 5, 1), MAX_RESULTS);
  const searx = process.env.HERMES_SEARCH_URL;

  if (searx) {
    const base = searx.replace(/\/$/, '');
    const target = normalizeUrl(base + '/search?q=' + encodeURIComponent(query) + '&format=json');
    await assertResolvesPublic(target.hostname);

    const response = await fetchUrl(target.toString(), { timeout: SEARCH_TIMEOUT_MS });
    if (!response.ok) throw httpError('busca respondeu HTTP ' + response.status, 502);
    const payload = await response.json().catch(() => null);
    const results = parseSearxng(payload, limit);
    return { query, engine: 'searxng', results, empty: results.length === 0 };
  }

  const target = normalizeUrl('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query));
  await assertResolvesPublic(target.hostname);

  const response = await fetchUrl(target.toString(), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; DuckHermesStudio/0.1)',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    },
    timeout: SEARCH_TIMEOUT_MS,
  });

  if (!response.ok) {
    throw httpError(
      'a busca gratuita respondeu HTTP ' + response.status + '. Configure HERMES_SEARCH_URL (SearXNG) ou use web_fetch numa URL conhecida.',
      502
    );
  }

  const html = await response.text();
  const results = parseDuckDuckGo(html, limit);

  return {
    query,
    engine: 'duckduckgo',
    results,
    empty: results.length === 0,
    note: results.length === 0 ? 'nenhum resultado extraído; o buscador pode ter mudado o formato' : null,
  };
}

module.exports = {
  fetchPage,
  search,
  normalizeUrl,
  isPrivateAddress,
  htmlToText,
  extractTitle,
  readBounded,
  MAX_BYTES,
  MAX_TEXT_CHARS,
  MAX_RESULTS,
  TIMEOUT_MS,
  MAX_REDIRECTS,
};
