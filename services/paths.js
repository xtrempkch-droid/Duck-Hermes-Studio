'use strict';

const path = require('path');

/**
 * Diretório de dados graváveis (histórico, máquinas, devdocs, ai-talk).
 * Em execução normal é <repo>/data; no binário empacotado o entrypoint
 * aponta HERMES_DATA_DIR para uma pasta do usuário (o snapshot é somente leitura).
 */
function dataDir() {
  const configured = process.env.HERMES_DATA_DIR;
  if (configured && String(configured).trim()) return path.resolve(String(configured).trim());
  return path.join(__dirname, '..', 'data');
}

module.exports = { dataDir };
