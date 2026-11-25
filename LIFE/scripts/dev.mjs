#!/usr/bin/env node
/**
 * Development mode in one command: API server (auto-restart on change) + dashboard with hot
 * reload. Open http://localhost:5173. Ctrl+C stops both.
 */

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const children = [];

function start(name, color, command, args, cwd) {
  const child = spawn(command, args, { cwd, shell: process.platform === 'win32', env: process.env });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = stream => stream.on('data', chunk => {
    for (const line of chunk.toString().split(/\r?\n/)) if (line.trim()) process.stdout.write(prefix + line + '\n');
  });
  pipe(child.stdout);
  pipe(child.stderr);
  child.on('exit', code => {
    console.log(`${prefix}exited (${code ?? 'signal'})`);
    stopAll();
  });
  children.push(child);
}

let stopping = false;
function stopAll() {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null) continue;
    // On Windows npm runs through a shell; kill the whole tree so Vite does not keep running.
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill();
  }
  setTimeout(() => process.exit(0), 500);
}

process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);

start('server', '36', process.execPath, ['--watch', 'index.js'], join(ROOT, 'server'));
start('dashboard', '35', 'npm', ['run', 'dev'], join(ROOT, 'dashboard'));
console.log('Development mode: open http://localhost:5173 (API on http://localhost:3001). Ctrl+C stops both.');
