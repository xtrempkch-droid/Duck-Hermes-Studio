'use strict';

const http = require('http');

const PORT = Number(process.env.PORT) || 8090;
const MODEL = process.env.MODEL || 'docker-test';

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, { status: 'ok', model: MODEL });
    return;
  }

  if (req.method === 'GET' && req.url === '/v1/models') {
    sendJson(res, 200, { object: 'list', data: [{ id: MODEL, object: 'model' }] });
    return;
  }

  if (req.method === 'POST' && req.url === '/v1/chat/completions') {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      let payload = {};
      try {
        payload = JSON.parse(raw || '{}');
      } catch (error) {
        sendJson(res, 400, { error: { message: 'JSON inválido' } });
        return;
      }

      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      const last = messages.filter((message) => message.role === 'user').pop();
      const prompt = last && typeof last.content === 'string' ? last.content : '';
      const content = `[docker-test] resposta simulada para: ${prompt.slice(0, 200) || '(vazio)'}`;

      if (payload.stream) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        const chunk = {
          id: 'chatcmpl-docker-test',
          object: 'chat.completion.chunk',
          model: MODEL,
          choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      sendJson(res, 200, {
        id: 'chatcmpl-docker-test',
        object: 'chat.completion',
        model: MODEL,
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      });
    });
    return;
  }

  sendJson(res, 404, { error: { message: 'rota não encontrada' } });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`mock LLM ouvindo em http://0.0.0.0:${PORT}/v1 (modelo ${MODEL})`);
});
