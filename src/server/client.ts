import { spawn, type SpawnOptions } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { maesterHome, port } from '../core/paths.ts';
import { KEY_HEADER, type Ping, PLUGIN_ROOT, PLUGIN_VERSION, PROTOCOL } from './protocol.ts';

const PING_TIMEOUT_MS = 500;
const POLL_INTERVAL_MS = 100;
const POLL_ATTEMPTS = 20;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const serverLog = () => path.join(maesterHome(), 'server.log');

// Claude Code and Codex install the same version in different folders; only a version change should replace a running server.
const isMaester = (p: Ping | null): p is Ping => p?.ok === true && typeof p.protocol === 'number';
const isCurrent = (p: Ping | null) => isMaester(p) && p.protocol === PROTOCOL && p.version === PLUGIN_VERSION;

// Not fetch: its pooled sockets throw uncatchable errors when the old server is killed mid-request.
export function ping(): Promise<Ping | null> {
  return new Promise(resolve => {
    const request = http.get({ host: '127.0.0.1', port: port(), path: '/api/ping', agent: false, timeout: PING_TIMEOUT_MS }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { resolve(null); }
      });
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(null));
  });
}

// statusline 每次更新都會呼叫：server 沒開就丟掉，不啟動、不等。
export function postAgent(repo: string, key: string, body: string): Promise<void> {
  return new Promise(resolve => {
    const request = http.request({ host: '127.0.0.1', port: port(), method: 'POST', path: `/api/agent?repo=${encodeURIComponent(repo)}`, agent: false, timeout: PING_TIMEOUT_MS,
      headers: { 'content-type': 'application/json', [KEY_HEADER]: key } }, response => { response.resume(); response.on('end', resolve); });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve());
    request.end(body);
  });
}

async function stopOutdated(running: Ping) {
  if (running.pid) {
    try { process.kill(running.pid); } catch {}
  }
  for (let i = 0; i < POLL_ATTEMPTS && await ping(); i++) await sleep(POLL_INTERVAL_MS);
}

export function serverSpawnOptions(log: number): SpawnOptions {
  return { cwd: PLUGIN_ROOT, detached: true, windowsHide: true, stdio: ['ignore', log, log], env: process.env };
}

function spawnServer() {
  fs.mkdirSync(maesterHome(), { recursive: true });
  const log = fs.openSync(serverLog(), 'a');
  const child = spawn(process.execPath, [path.join(PLUGIN_ROOT, 'src/server/server.ts')], serverSpawnOptions(log));
  const exited = { value: false };
  child.on('exit', () => { exited.value = true; });
  child.unref();
  return exited;
}

export async function ensureServer() {
  const running = await ping();
  if (isCurrent(running)) return;
  if (isMaester(running)) await stopOutdated(running);
  const exited = spawnServer();
  for (let i = 0; i < POLL_ATTEMPTS && !exited.value; i++) {
    await sleep(POLL_INTERVAL_MS);
    if (isCurrent(await ping())) return;
  }
  throw new Error(`server 沒有在 port ${port()} 啟動（被占用時用 MAESTER_PORT 換一個），看 ${serverLog()}`);
}

export function openerFor(platform: NodeJS.Platform, url: string): { command: string; args: string[] } {
  if (platform === 'darwin') return { command: 'open', args: [url] };
  if (platform === 'win32') return { command: 'rundll32', args: ['url.dll,FileProtocolHandler', url] };
  return { command: 'xdg-open', args: [url] };
}
