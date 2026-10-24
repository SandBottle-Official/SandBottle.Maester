import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { messageOf, Rejected } from '../core/errors.ts';
import { maesterHome, port } from '../core/paths.ts';
import { openStore, type Store } from '../core/store.ts';
import type { EventInput } from '../core/types.ts';
import { buildView } from '../view/build-view.ts';
import { type AgentInfo, pickAgent } from './agent.ts';
import { KEY_HEADER, type Ping, PLUGIN_ROOT, PLUGIN_VERSION, PROTOCOL } from './protocol.ts';
import { readKey, readProjects } from './projects.ts';
import { installStatusline, statuslineInstalled } from './statusline.ts';

const WEB_ROOT = path.join(PLUGIN_ROOT, 'web');
const KEY = readKey();
const PORT = port();
const MAX_EVENT_BYTES = 64_000;
const STREAM_INTERVAL_MS = 1000;
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const LOCAL_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const LOCAL_ORIGINS = new Set([...LOCAL_HOSTS].map(host => `http://${host}`));
const streams = new Map<string, Set<http.ServerResponse>>();
// shortcut: one agent per repo, last statusline wins; key by session_id if several sessions on one repo need their own row.
const agents = new Map<string, AgentInfo>();

const isKnownRepo = (repo: string | null): repo is string => !!repo && readProjects().includes(repo);
const hasKey = (candidate: string | string[] | null | undefined) => {
  const given = Buffer.from(String(candidate ?? '')), expected = Buffer.from(KEY);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
};
const inlineScriptHashes = () => [...fs.readFileSync(path.join(WEB_ROOT, 'index.html'), 'utf8').matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
  .map(([, body]) => `'sha256-${crypto.createHash('sha256').update(body).digest('base64')}'`);
// Page scripts come only from this server, two pinned CDNs and the hashed inline scripts in index.html.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' ${inlineScriptHashes().join(' ')} 'wasm-unsafe-eval' https://cdn.jsdelivr.net https://esm.sh`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "connect-src 'self' https://cdn.jsdelivr.net https://esm.sh",
  "img-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');
const SECURITY_HEADERS = { 'content-security-policy': CONTENT_SECURITY_POLICY, 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' };

function send(res: http.ServerResponse, status: number, body: unknown, type = 'application/json') {
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': type });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function serializedView(repo: string, featureId: string | null) {
  try { return JSON.stringify({ ...buildView(repo, featureId), agent: agents.get(repo) ?? null, statusline: statuslineInstalled() }); }
  catch (error) { return JSON.stringify({ repo, error: messageOf(error) }); }
}

function pingBody(): Ping {
  return { ok: true, protocol: PROTOCOL, version: PLUGIN_VERSION, pid: process.pid, root: PLUGIN_ROOT, clients: Object.fromEntries([...streams].map(([repo, set]) => [repo, set.size])) };
}

// shortcut: re-renders every second instead of fs.watch; switch to watching when many tabs or huge repos make this costly.
function streamView(req: http.IncomingMessage, res: http.ServerResponse, repo: string, featureId: string | null) {
  res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  let last = '';
  const tick = () => {
    const view = serializedView(repo, featureId);
    if (view === last) return;
    last = view;
    res.write(`data: ${view}\n\n`);
  };
  tick();
  const timer = setInterval(tick, STREAM_INTERVAL_MS);
  if (!streams.has(repo)) streams.set(repo, new Set());
  streams.get(repo)!.add(res);
  req.on('close', () => {
    clearInterval(timer);
    streams.get(repo)?.delete(res);
  });
}

const isTrustedEventRequest = (req: http.IncomingMessage) => {
  const origin = req.headers.origin;
  return hasKey(req.headers[KEY_HEADER]) && (!origin || LOCAL_ORIGINS.has(origin));
};

function submitEvent(repo: string, body: string, res: http.ServerResponse) {
  let event: EventInput;
  try { event = JSON.parse(body); }
  catch { return send(res, 400, { error: 'bad json' }); }
  let store: Store | null = null;
  try {
    store = openStore(repo);
    if (!store) return send(res, 409, { error: '這個 repo 還沒有 maester.db' });
    send(res, 200, store.submit(event));
  } catch (error) {
    send(res, error instanceof Rejected ? 409 : 500, { error: messageOf(error) });
  } finally { store?.close(); }
}

function receiveAgent(req: http.IncomingMessage, res: http.ServerResponse, repo: string) {
  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > MAX_EVENT_BYTES) req.destroy();
  });
  req.on('end', () => {
    try { agents.set(repo, pickAgent(JSON.parse(body))); }
    catch { return send(res, 400, { error: 'bad json' }); }
    send(res, 200, { ok: true });
  });
}

function receiveEvent(req: http.IncomingMessage, res: http.ServerResponse, repo: string) {
  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > MAX_EVENT_BYTES) req.destroy();
  });
  req.on('end', () => submitEvent(repo, body, res));
}

function serveStatic(pathname: string, res: http.ServerResponse) {
  const file = path.join(WEB_ROOT, path.normalize(pathname === '/' ? 'index.html' : pathname.slice(1)));
  if (!file.startsWith(WEB_ROOT + path.sep)) return send(res, 404, 'not found', 'text/plain');
  fs.readFile(file, (error, data) => error ? send(res, 404, 'not found', 'text/plain') : send(res, 200, data, MIME[path.extname(file)] ?? 'application/octet-stream'));
}

const server = http.createServer((req, res) => {
  // Rejecting other Host names blocks DNS rebinding from reading repos through a malicious page.
  if (!LOCAL_HOSTS.has(req.headers.host ?? '')) return send(res, 403, { error: 'forbidden host' });
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  const repo = url.searchParams.get('repo'), featureId = url.searchParams.get('feature');
  const isRead = ['/api/projects', '/api/view', '/api/stream'].includes(url.pathname);
  if (isRead && !hasKey(url.searchParams.get('key'))) return send(res, 403, { error: 'forbidden' });
  switch (url.pathname) {
    case '/api/ping': return send(res, 200, pingBody());
    case '/api/projects': return send(res, 200, readProjects().map(r => ({ repo: r, name: path.basename(r) })));
    case '/api/view': return isKnownRepo(repo) ? send(res, 200, serializedView(repo, featureId)) : send(res, 404, { error: 'unknown repo' });
    case '/api/stream': return isKnownRepo(repo) ? streamView(req, res, repo, featureId) : send(res, 404, { error: 'unknown repo' });
    case '/api/event':
      if (req.method !== 'POST') break;
      if (!isTrustedEventRequest(req)) return send(res, 403, { error: 'forbidden' });
      return isKnownRepo(repo) ? receiveEvent(req, res, repo) : send(res, 404, { error: 'unknown repo' });
    case '/api/statusline':
      if (req.method !== 'POST') break;
      if (!isTrustedEventRequest(req)) return send(res, 403, { error: 'forbidden' });
      try { installStatusline(); return send(res, 200, { ok: true }); }
      catch (error) { return send(res, error instanceof Rejected ? 409 : 500, { error: messageOf(error) }); }
    case '/api/agent':
      if (req.method !== 'POST') break;
      if (!isTrustedEventRequest(req)) return send(res, 403, { error: 'forbidden' });
      return isKnownRepo(repo) ? receiveAgent(req, res, repo) : send(res, 404, { error: 'unknown repo' });
  }
  serveStatic(url.pathname, res);
});

server.listen(PORT, '127.0.0.1', () => console.log(`maester on http://127.0.0.1:${PORT} (home ${maesterHome()})`));
