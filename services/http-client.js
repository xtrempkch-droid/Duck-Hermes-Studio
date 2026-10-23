'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

const MAX_REDIRECTS = 5;

function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  if (typeof timer.unref === 'function') timer.unref();
  return controller.signal;
}

function abortError() {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

function createReader(stream) {
  const queue = [];
  let ended = false;
  let failure = null;
  let notify = null;

  const wake = () => {
    if (!notify) return;
    const resolve = notify;
    notify = null;
    resolve();
  };

  stream.on('data', (chunk) => {
    queue.push(chunk);
    wake();
  });
  stream.on('end', () => {
    ended = true;
    wake();
  });
  stream.on('error', (error) => {
    failure = error;
    wake();
  });

  const reader = {
    async read() {
      for (;;) {
        if (queue.length > 0) return { done: false, value: new Uint8Array(queue.shift()) };
        if (failure) throw failure;
        if (ended) return { done: true, value: undefined };
        await new Promise((resolve) => {
          notify = resolve;
        });
      }
    },
    async collect() {
      const parts = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(Buffer.from(value));
      }
      return Buffer.concat(parts);
    },
  };

  return reader;
}

function createResponse(response) {
  const reader = createReader(response);
  const headers = {
    get(name) {
      const value = response.headers[String(name).toLowerCase()];
      if (Array.isArray(value)) return value.join(', ');
      return value === undefined ? null : value;
    },
  };

  return {
    status: response.statusCode,
    ok: response.statusCode >= 200 && response.statusCode < 300,
    headers,
    body: reader,
    text: async () => (await reader.collect()).toString('utf8'),
    json: async () => JSON.parse((await reader.collect()).toString('utf8')),
    arrayBuffer: async () => {
      const buffer = await reader.collect();
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    },
  };
}

function nodeFetch(url, options, redirectsLeft) {
  const remaining = redirectsLeft === undefined ? MAX_REDIRECTS : redirectsLeft;
  const settings = options || {};

  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const headers = { ...(settings.headers || {}) };
    const method = settings.method || 'GET';

    let payload = settings.body;
    if (
      payload !== undefined &&
      payload !== null &&
      typeof payload !== 'string' &&
      !Buffer.isBuffer(payload)
    ) {
      payload = JSON.stringify(payload);
    }

    if (payload !== undefined && payload !== null) {
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const request = transport.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers,
      },
      (response) => {
        const location = response.headers.location;
        const isRedirect = [301, 302, 303, 307, 308].includes(response.statusCode);

        // redirect: 'manual' devolve o 3xx (mesma semântica do fetch nativo),
        // para quem precisa validar cada salto antes de seguir
        if (isRedirect && settings.redirect === 'manual') {
          response.resume();
          resolve(createResponse(response));
          return;
        }

        if (isRedirect && location && remaining > 0) {
          response.resume();
          const nextUrl = new URL(location, parsed).toString();
          const nextMethod = response.statusCode === 303 ? 'GET' : method;
          resolve(nodeFetch(nextUrl, { ...settings, method: nextMethod }, remaining - 1));
          return;
        }

        resolve(createResponse(response));
      }
    );

    request.on('error', reject);

    const signal = settings.signal;
    if (signal) {
      if (signal.aborted) {
        request.destroy(abortError());
        return;
      }
      const onAbort = () => request.destroy(abortError());
      signal.addEventListener('abort', onAbort, { once: true });
      request.on('close', () => signal.removeEventListener('abort', onAbort));
    }

    if (payload !== undefined && payload !== null) request.write(payload);
    request.end();
  });
}

function fetchUrl(url, options) {
  const settings = { ...(options || {}) };
  if (settings.timeout && !settings.signal) {
    settings.signal = timeoutSignal(settings.timeout);
  }
  if (typeof globalThis.fetch === 'function') return globalThis.fetch(url, settings);
  return nodeFetch(url, settings);
}

module.exports = { fetch: fetchUrl, timeoutSignal };
