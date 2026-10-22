'use strict';

/**
 * Entrypoint do binário distribuível (pkg/SEA).
 * - escolhe um diretório de dados gravável fora do snapshot
 * - abre o navegador padrão já apontando para o servidor
 * - aceita --port, --workspace, --data, --no-open, --help
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');

const HELP = [
  'Duck Hermes Studio',
  '',
  'Uso: duck-hermes-studio [opções]',
  '',
  '  --port <n>          porta HTTP (padrão 3000)',
  '  --workspace <dir>   pasta de trabalho do editor (padrão: pasta atual)',
  '  --data <dir>        onde ficam histórico/máquinas/devdocs',
  '  --no-open           não abre o navegador automaticamente',
  '  --help              mostra esta ajuda',
].join('\n');

function parseArgs(argv) {
  const options = { port: Number(process.env.PORT) || 3000, workspace: null, data: null, open: true };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--no-open') {
      options.open = false;
      continue;
    }
    if (arg === '--port' || arg === '--workspace' || arg === '--data') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} precisa de um valor`);
      index += 1;
      if (arg === '--port') {
        const port = Number(value);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('porta inválida');
        options.port = port;
      } else if (arg === '--workspace') {
        options.workspace = path.resolve(value);
      } else {
        options.data = path.resolve(value);
      }
      continue;
    }

    throw new Error(`opção desconhecida: ${arg}`);
  }

  return options;
}

function defaultDataDir() {
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(base, 'DuckHermesStudio');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'DuckHermesStudio');
  }
  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'duck-hermes-studio');
}

function defaultWorkspace() {
  const configured = process.env.HERMES_WORKSPACE;
  if (configured) return path.resolve(configured);
  const cwd = process.cwd();
  const insideProgramFiles =
    process.platform === 'win32' && /Program Files|Windows\\System32/i.test(cwd);
  if (cwd === path.parse(cwd).root || insideProgramFiles) return os.homedir();
  return cwd;
}

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    return true;
  } catch (error) {
    return false;
  }
}

function openBrowser(url) {
  const command =
    process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];

  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch (error) {
    return false;
  }
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`duck-hermes-studio: ${error.message}`);
    console.error('Use --help para ver as opções.');
    process.exit(2);
    return;
  }

  if (options.help) {
    console.log(HELP);
    return;
  }

  const dataDir = options.data || process.env.HERMES_DATA_DIR || defaultDataDir();
  if (!ensureDir(dataDir)) {
    console.error(`duck-hermes-studio: não foi possível criar ${dataDir}`);
    process.exit(1);
    return;
  }

  process.env.HERMES_DATA_DIR = dataDir;
  process.env.HERMES_WORKSPACE = options.workspace || defaultWorkspace();
  process.env.PORT = String(options.port);

  require('../server');

  const url = `http://localhost:${options.port}`;
  console.log(`Duck Hermes Studio — ${url}`);
  console.log(`workspace: ${process.env.HERMES_WORKSPACE}`);
  console.log(`dados:     ${dataDir}`);

  if (options.open) {
    setTimeout(() => {
      if (!openBrowser(url)) console.log(`Abra manualmente: ${url}`);
    }, 600);
  }
}

main();
