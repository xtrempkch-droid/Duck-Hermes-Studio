'use strict';

const { LanguageServerManager, DEFAULT_SERVERS, commandExists, languageIdForPath } = require('./manager');
const { LspClient, LspRequestError, createStdioTransport } = require('./client');
const framing = require('./framing');

let instance = null;

/** Uma instância por processo; dispose() zera para permitir reconfigurar. */
function getManager() {
  if (!instance) {
    instance = new LanguageServerManager({ workspaceRoot: require('../file-store').workspaceRoot() });
  }
  return instance;
}

function resetManager() {
  if (instance) instance.dispose();
  instance = null;
}

module.exports = {
  getManager,
  resetManager,
  LanguageServerManager,
  DEFAULT_SERVERS,
  commandExists,
  languageIdForPath,
  LspClient,
  LspRequestError,
  createStdioTransport,
  framing,
};
