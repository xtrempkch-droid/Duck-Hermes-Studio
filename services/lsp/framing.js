'use strict';

/**
 * Framing do protocolo base do LSP: cabeçalhos no estilo HTTP seguidos do corpo
 * JSON, separados por uma linha em branco. `Content-Length` conta **bytes**.
 */

const HEADER_SEPARATOR = '\r\n\r\n';
const MAX_HEADER_BYTES = 8 * 1024;
const MAX_BODY_BYTES = 8 * 1024 * 1024;

function encode(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]);
}

/** Parser incremental: aceita pedaços arbitrários e devolve mensagens completas. */
function createParser(onMessage, onError) {
  let buffer = Buffer.alloc(0);

  function fail(message) {
    buffer = Buffer.alloc(0);
    if (onError) onError(new Error(message));
  }

  return {
    feed(chunk) {
      buffer = Buffer.concat([buffer, Buffer.from(chunk)]);

      for (;;) {
        const headerEnd = buffer.indexOf(HEADER_SEPARATOR, 0, 'ascii');
        if (headerEnd === -1) {
          if (buffer.length > MAX_HEADER_BYTES) fail('cabeçalho LSP grande demais');
          return;
        }

        const headerText = buffer.subarray(0, headerEnd).toString('ascii');
        const match = headerText.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
          fail('mensagem LSP sem Content-Length');
          return;
        }

        const length = Number(match[1]);
        if (length > MAX_BODY_BYTES) {
          fail('mensagem LSP grande demais');
          return;
        }

        const bodyStart = headerEnd + HEADER_SEPARATOR.length;
        if (buffer.length < bodyStart + length) return;

        const body = buffer.subarray(bodyStart, bodyStart + length).toString('utf8');
        buffer = buffer.subarray(bodyStart + length);

        try {
          onMessage(JSON.parse(body));
        } catch (error) {
          if (onError) onError(new Error('JSON inválido na mensagem LSP'));
        }
      }
    },
    get pendingBytes() {
      return buffer.length;
    },
  };
}

module.exports = { encode, createParser, HEADER_SEPARATOR };
