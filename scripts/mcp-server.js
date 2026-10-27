#!/usr/bin/env node
'use strict';

/**
 * Entrypoint do servidor MCP em stdio.
 *
 * Uso: `npm run mcp` ou `node scripts/mcp-server.js`.
 * Configure o workspace com `HERMES_WORKSPACE=/caminho` e os dados com
 * `HERMES_DATA_DIR=/caminho` (chaves e histórico).
 *
 * Nada além de JSON-RPC pode ir para stdout: use stderr para diagnóstico.
 */

const { serveStdio } = require('../services/mcp');

process.on('uncaughtException', (error) => {
  process.stderr.write(`[mcp] erro não tratado: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});

process.on('unhandledRejection', (error) => {
  process.stderr.write(`[mcp] promise rejeitada: ${(error && error.stack) || error}\n`);
});

serveStdio();
