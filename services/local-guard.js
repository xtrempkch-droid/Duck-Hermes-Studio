'use strict';

const LOOPBACK_BINDINGS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0']);

function bindHost(env) {
  const configured = String((env && env.HERMES_HOST) || '').trim().toLowerCase();
  return configured || '127.0.0.1';
}

/** Tira a porta (inclusive em IPv6: "[::1]:3000") e normaliza. */
function normalizeHostHeader(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    return end === -1 ? raw : raw.slice(0, end + 1);
  }
  const lastColon = raw.lastIndexOf(':');
  return lastColon === -1 ? raw : raw.slice(0, lastColon);
}

function isLoopbackBind(env) {
  return LOOPBACK_BINDINGS.has(bindHost(env));
}

/**
 * Defesa contra DNS rebinding: com o servidor preso ao loopback, só o próprio
 * loopback pode aparecer no Host. Quem expõe de propósito (HERMES_HOST fora do
 * loopback) assume o risco e fica liberado, para não quebrar acesso por IP/LAN.
 */
function hostAllowed(hostHeader, env) {
  if (!isLoopbackBind(env)) return true;
  const host = normalizeHostHeader(hostHeader);
  return Boolean(host) && LOOPBACK_HOSTS.has(host);
}

module.exports = {
  bindHost,
  normalizeHostHeader,
  isLoopbackBind,
  hostAllowed,
};
