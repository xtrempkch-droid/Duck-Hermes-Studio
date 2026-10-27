'use strict';

/**
 * Plugin de exemplo do contrato `.plg.js`.
 *
 * Ele NÃO é carregado no boot: em ⚙ → Plugins (ou em POST /api/plugins/load) o
 * usuário escolhe carregar. Isso é deliberado — um plugin é código que roda no
 * processo do app, então carregar sozinho ao abrir um repositório seria execução
 * silenciosa.
 *
 * Ferramenta exposta: `package_info` — lê o package.json do workspace e devolve
 * nome, versão, scripts e dependências. Sem terminal, sem escrita.
 */

const manifest = {
  id: 'duck.package-info',
  name: 'Package Info',
  version: '1.0.0',
  description: 'Mostra nome, versão, scripts e dependências do package.json do workspace.',
  entryPoint: __filename,
  permissions: { filesystem: true, terminal: false, network: false, mcpTools: true },
};

const lifecycle = {
  async onLoad(context) {
    context.registerTool(
      {
        type: 'function',
        function: {
          name: 'package_info',
          description: 'Lê o package.json do workspace e devolve nome, versão, scripts e dependências.',
          parameters: { type: 'object', properties: {} },
        },
      },
      async () => {
        const file = await context.files.read('package.json');
        const data = JSON.parse(file.content);

        return {
          ok: true,
          name: data.name || null,
          version: data.version || null,
          scripts: data.scripts || {},
          dependencies: Object.keys(data.dependencies || {}),
          devDependencies: Object.keys(data.devDependencies || {}),
          engines: data.engines || {},
        };
      }
    );
  },

  async onUnload() {
    /* nada pendente: as ferramentas são revogadas pelo PluginManager */
  },
};

module.exports = { manifest, lifecycle };
