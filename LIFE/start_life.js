#!/usr/bin/env node
/**
 * L.I.F.E. launcher (used by run_life.bat, or `npm start` in this folder).
 *
 *  1. Checks the Node.js version.
 *  2. Installs server/dashboard dependencies only if they are missing.
 *  3. Rebuilds the dashboard only if its source is newer than the last build.
 *  4. Starts the server (it creates/migrates the database and the first admin itself).
 *  5. Waits until the server answers, then opens the browser.
 *
 * Options: --no-browser (or LIFE_NO_BROWSER=1), --rebuild (force a dashboard build).
 * The port comes from PORT (default 3001).
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;
const URL_BASE = `http://localhost:${PORT}`;
const args = new Set(process.argv.slice(2));
const openBrowserAfterStart = !args.has('--no-browser') && process.env.LIFE_NO_BROWSER !== '1';
const MIN_NODE_MAJOR = 20;
const HEALTH_TIMEOUT_MS = 30_000;

const log = (scope, message) => console.log(`[${scope}] ${message}`);

function run(command, commandArgs, cwd) {
  return new Promise((resolve, reject) => {
    // npm is a .cmd script on Windows, which needs a shell to run.
    const child = spawn(command, commandArgs, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', reject);
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`${command} ${commandArgs.join(' ')} failed (exit ${code})`))));
  });
}

async function ensureDependencies(folder, label) {
  if (existsSync(join(ROOT, folder, 'node_modules'))) return;
  log(label, 'Installing dependencies (first run only)...');
  await run('npm', ['install', '--no-audit', '--no-fund'], join(ROOT, folder));
}

/** Newest modification time of a file or of anything inside a folder. */
function newestMtime(path) {
  if (!existsSync(path)) return 0;
  const stats = statSync(path);
  if (!stats.isDirectory()) return stats.mtimeMs;
  let newest = stats.mtimeMs;
  for (const entry of readdirSync(path)) newest = Math.max(newest, newestMtime(join(path, entry)));
  return newest;
}

async function ensureDashboardBuild() {
  const dashboard = join(ROOT, 'dashboard');
  const builtIndex = join(dashboard, 'dist', 'index.html');
  const builtAt = existsSync(builtIndex) ? statSync(builtIndex).mtimeMs : 0;
  const sourceAt = Math.max(
    ...['src', 'public', 'index.html', 'vite.config.ts', 'package.json', 'tsconfig.json'].map(name => newestMtime(join(dashboard, name)))
  );

  if (!args.has('--rebuild') && builtAt > 0 && builtAt >= sourceAt) {
    log('Dashboard', 'Build is up to date');
    return;
  }
  log('Dashboard', builtAt ? 'Source changed; rebuilding...' : 'Building (first run only)...');
  await run('npm', ['run', 'build'], dashboard);
}

async function isHealthy() {
  try {
    const response = await fetch(`${URL_BASE}/api/health`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForHealth(server) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) return false;
    if (await isHealthy()) return true;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

function openBrowser(url) {
  const [command, commandArgs] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] :
    process.platform === 'darwin' ? ['open', [url]] :
    ['xdg-open', [url]];
  try {
    const child = spawn(command, commandArgs, { stdio: 'ignore', detached: true, windowsVerbatimArguments: process.platform === 'win32' });
    child.on('error', () => log('System', `Open ${url} in your browser.`));
    child.unref();
  } catch {
    log('System', `Open ${url} in your browser.`);
  }
}

async function main() {
  console.log('');
  console.log('  L.I.F.E. - Localized Intelligent First-aid Evaluator');
  console.log('');

  const major = Number(process.versions.node.split('.')[0]);
  if (major < MIN_NODE_MAJOR) {
    throw new Error(`Node.js ${MIN_NODE_MAJOR} or newer is required (found ${process.version}). Install the LTS version from https://nodejs.org/`);
  }
  log('System', `Node.js ${process.version}`);

  if (await isHealthy()) {
    log('System', `L.I.F.E. is already running at ${URL_BASE}`);
    if (openBrowserAfterStart) openBrowser(URL_BASE);
    return;
  }

  await ensureDependencies('server', 'Server');
  await ensureDependencies('dashboard', 'Dashboard');
  await ensureDashboardBuild();

  log('Server', 'Starting...');
  const server = spawn(process.execPath, ['index.js'], { cwd: join(ROOT, 'server'), stdio: 'inherit', env: process.env });

  const stop = () => {
    if (server.exitCode === null) server.kill();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  const exited = new Promise(resolve => server.on('exit', code => resolve(code)));

  if (await waitForHealth(server)) {
    console.log('');
    log('System', `Ready: ${URL_BASE}`);
    log('System', 'First time? Sign in as "admin" with the initial password from the README; you will be asked to choose your own.');
    log('System', 'Keep this window open while using L.I.F.E. Press Ctrl+C to stop.');
    console.log('');
    if (openBrowserAfterStart) openBrowser(URL_BASE);
  } else if (server.exitCode === null) {
    log('System', `The server did not respond within ${HEALTH_TIMEOUT_MS / 1000} s. Check the messages above, or open ${URL_BASE} manually.`);
  }

  const code = await exited;
  process.exitCode = code ?? 0;
}

main().catch(error => {
  console.error(`[System] ${error.message}`);
  process.exitCode = 1;
});
