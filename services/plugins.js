'use strict';

const fs = require('fs');
const path = require('path');

const activity = require('./activity-log');
const fileStore = require('./file-store');
const sandbox = require('./sandbox');
const tools = require('./tools');
const { dataDir } = require('./paths');

const ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[\w.]+)?(?:\+[\w.]+)?$/;
const RESERVED_ID = 'core';
const ENTRY_EXTENSION = '.plg.js';
const MAX_PLUGIN_BYTES = 512 * 1024;

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/** Pastas onde plugins são descobertos: dados do usuário e `plugins/` do workspace. */
function pluginDirs() {
  return [path.join(dataDir(), 'plugins'), path.join(fileStore.workspaceRoot(), 'plugins')];
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** Só carrega arquivo que está numa das pastas permitidas — nada de caminho arbitrário. */
function resolvePluginFile(rawPath) {
  const requested = path.resolve(String(rawPath || ''));
  for (const dir of pluginDirs()) {
    const root = path.resolve(dir);
    if (isInside(root, requested)) {
      let real;
      try {
        real = fs.realpathSync(requested);
      } catch (error) {
        throw httpError('plugin não encontrado', 404);
      }
      if (!isInside(fs.existsSync(root) ? fs.realpathSync(root) : root, real)) {
        throw httpError('link simbólico fora da pasta de plugins', 403);
      }
      return real;
    }
  }
  throw httpError('plugin fora das pastas permitidas', 403);
}

function validateManifest(manifest) {
  const issues = [];
  const body = manifest || {};

  if (typeof body.id !== 'string' || !ID_PATTERN.test(body.id)) {
    issues.push('id: use minúsculas, números e separadores . _ -');
  } else if (body.id === RESERVED_ID) {
    issues.push('id: "core" é reservado');
  }
  if (typeof body.name !== 'string' || !body.name.trim()) issues.push('name: obrigatório');
  if (typeof body.version !== 'string' || !SEMVER_PATTERN.test(body.version)) {
    issues.push('version: semver (ex.: 1.0.0)');
  }
  if (body.permissions !== undefined && (typeof body.permissions !== 'object' || body.permissions === null)) {
    issues.push('permissions: deve ser objeto');
  }

  return issues;
}

/** Descobre plugins sem executar nada: só lê os arquivos e confia no manifest declarado. */
function discover() {
  const found = [];

  for (const dir of pluginDirs()) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(ENTRY_EXTENSION)) continue;

      const absolute = path.join(dir, entry.name);
      let stat;
      try {
        stat = fs.statSync(absolute);
      } catch (error) {
        continue;
      }
      if (stat.size > MAX_PLUGIN_BYTES) continue;

      found.push({
        id: entry.name.slice(0, -ENTRY_EXTENSION.length),
        file: absolute,
        source: dir === pluginDirs()[0] ? 'dados' : 'workspace',
        size: stat.size,
        loaded: false,
        error: null,
      });
    }
  }

  return found;
}

/**
 * Gerencia ciclo de vida com isolamento de erro: um plugin que lança não pode
 * derrubar o app, e um `onLoad` que falhou não deixa ferramenta registrada.
 */
class PluginManager {
  constructor() {
    this.loaded = new Map();
  }

  list() {
    const entries = new Map();

    for (const item of discover()) {
      entries.set(item.id, item);
    }

    for (const [id, plugin] of this.loaded) {
      entries.set(id, {
        ...(entries.get(id) || { id, source: 'dados', size: 0 }),
        loaded: true,
        name: plugin.manifest.name,
        version: plugin.manifest.version,
        description: plugin.manifest.description || null,
        permissions: plugin.manifest.permissions || {},
        tools: plugin.tools,
        loadedAt: plugin.loadedAt,
        error: null,
      });
    }

    return [...entries.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  get(id) {
    return this.loaded.get(String(id || '')) || null;
  }

  contextFor(manifest) {
    const permissions = manifest.permissions || {};
    const owner = manifest.id;

    return Object.freeze({
      manifest,
      logger: activity.log,
      registerTool(definition, handler) {
        return tools.registerDynamicTool(owner, definition, handler);
      },
      terminal: Object.freeze({
        run(command, options) {
          if (!permissions.terminal) {
            throw httpError('o plugin não declarou a permissão "terminal"', 403);
          }
          const overrides = options || {};
          const network =
            overrides.network && overrides.network !== 'none'
              ? permissions.network
                ? overrides.network
                : 'none'
              : 'none';
          return sandbox.run({
            image: overrides.image,
            command,
            workspaceDir: fileStore.workspaceRoot(),
            network,
            timeoutMs: overrides.timeoutMs,
          });
        },
      }),
      files: Object.freeze({
        read: (requestedPath) => {
          if (!permissions.filesystem) {
            throw httpError('o plugin não declarou a permissão "filesystem"', 403);
          }
          return fileStore.readFile(requestedPath);
        },
        list: (requestedPath) => {
          if (!permissions.filesystem) {
            throw httpError('o plugin não declarou a permissão "filesystem"', 403);
          }
          return fileStore.listDirectory(requestedPath);
        },
      }),
    });
  }

  async load(rawPath) {
    const absolute = resolvePluginFile(rawPath);
    if (!absolute.endsWith(ENTRY_EXTENSION)) {
      throw httpError(`plugin precisa terminar em ${ENTRY_EXTENSION}`, 400);
    }

    delete require.cache[require.resolve(absolute)];
    let module;
    try {
      module = require(absolute);
    } catch (error) {
      activity.log.record({
        filePath: `plugin://${path.basename(absolute)}`,
        author: 'SYSTEM',
        action: 'plugin_load_failed',
        delta: { before: '', after: error.message },
        metadata: { stack: String(error.stack || '').slice(0, 2000) },
      });
      throw httpError(`falha ao carregar plugin: ${error.message}`, 422);
    }

    const manifest = module && module.manifest;
    const lifecycle = module && (module.lifecycle || module);
    const issues = validateManifest(manifest);
    if (issues.length > 0) throw httpError(`manifest inválido: ${issues.join('; ')}`, 400);
    if (typeof lifecycle.onLoad !== 'function') {
      throw httpError('plugin precisa expor lifecycle.onLoad', 400);
    }
    if (this.loaded.has(manifest.id)) throw httpError(`plugin ${manifest.id} já está carregado`, 409);

    const registered = [];
    const context = this.contextFor(manifest);
    const wrappedContext = Object.freeze({
      ...context,
      registerTool(definition, handler) {
        const name = context.registerTool(definition, handler);
        registered.push(name);
        return name;
      },
    });

    try {
      await lifecycle.onLoad(wrappedContext);
    } catch (error) {
      tools.unregisterToolsByPlugin(manifest.id);
      activity.log.record({
        filePath: `plugin://${manifest.id}`,
        author: 'SYSTEM',
        action: 'plugin_load_failed',
        delta: { before: '', after: error.message },
        metadata: { stack: String(error.stack || '').slice(0, 2000) },
      });
      throw httpError(`plugin ${manifest.id} falhou ao iniciar: ${error.message}`, 422);
    }

    const plugin = {
      manifest,
      lifecycle,
      file: absolute,
      tools: registered,
      loadedAt: Date.now(),
    };

    this.loaded.set(manifest.id, plugin);
    activity.log.record({
      filePath: `plugin://${manifest.id}`,
      author: 'SYSTEM',
      action: 'plugin_loaded',
      delta: { before: '', after: JSON.stringify(manifest) },
      metadata: { tools: registered, file: absolute },
    });

    return {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      tools: registered,
    };
  }

  async unload(id) {
    const plugin = this.loaded.get(String(id || ''));
    if (!plugin) throw httpError('plugin não está carregado', 404);

    this.loaded.delete(plugin.manifest.id);
    tools.unregisterToolsByPlugin(plugin.manifest.id);

    if (typeof plugin.lifecycle.onUnload === 'function') {
      try {
        await plugin.lifecycle.onUnload();
      } catch (error) {
        activity.log.record({
          filePath: `plugin://${plugin.manifest.id}`,
          author: 'SYSTEM',
          action: 'plugin_unload_failed',
          delta: { before: '', after: error.message },
        });
      }
    }

    activity.log.record({
      filePath: `plugin://${plugin.manifest.id}`,
      author: 'SYSTEM',
      action: 'plugin_unloaded',
      delta: { before: JSON.stringify(plugin.manifest), after: '' },
      metadata: { tools: plugin.tools },
    });

    delete require.cache[require.resolve(plugin.file)];
    return { id: plugin.manifest.id, unloaded: true };
  }
}

const manager = new PluginManager();

module.exports = {
  PluginManager,
  manager,
  discover,
  validateManifest,
  pluginDirs,
  ENTRY_EXTENSION,
  RESERVED_ID,
};
