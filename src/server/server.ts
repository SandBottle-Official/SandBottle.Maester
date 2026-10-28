import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { messageOf, Rejected } from '../core/errors.ts';
import { maesterHome, port } from '../core/paths.ts';
import { openStore, type Store } from '../core/store.ts';
import type { EventInput } from '../core/types.ts';
import { buildView } from '../view/build-view.ts';
import { type AccountLimits, type AgentInfo, nextAgent, nextLimits, pickAgent, withLimits } from './agent.ts';
import { KEY_HEADER, type Ping, PLUGIN_ROOT, PLUGIN_VERSION, PROTOCOL } from './protocol.ts';
import { readKey, readProjects } from './projects.ts';
import { installStatusline, statuslineInstalled } from './statusline.ts';

const WEB_ROOT = path.join(PLUGIN_ROOT, 'web');
const KEY = readKey();
const PORT = port();
const MAX_EVENT_BYTES = 64_000;
const STREAM_DEBOUNCE_MS = 200;
// 監看漏接的（例如 worktree 的 .git 在 repo 外）靠慢速輪詢補；監看不了才退回每秒輪詢
const STREAM_FALLBACK_MS = 10_000;
const STREAM_POLL_MS = 1000;
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const LOCAL_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const LOCAL_ORIGINS = new Set([...LOCAL_HOSTS].map(host => `http://${host}`));
const streams = new Map<string, Set<() => void>>();
const watchers = new Map<string, fs.FSWatcher>();
const pendingRefresh = new Set<string>();
// shortcut: one agent per repo, last statusline wins; key by session_id if several sessions on one repo need their own row.
const agents = new Map<string, AgentInfo>();
let limits: AccountLimits | undefined;

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
  try { return JSON.stringify({ ...buildView(repo, featureId), agent: withLimits(agents.get(repo), limits), statusline: statuslineInstalled() }); }
  catch (error) { return JSON.stringify({ repo, error: messageOf(error) }); }
}

function pingBody(): Ping {
  return { ok: true, protocol: PROTOCOL, version: PLUGIN_VERSION, pid: process.pid, root: PLUGIN_ROOT, clients: Object.fromEntries([...streams].map(([repo, set]) => [repo, set.size])) };
}

const refresh = (repo: string) => streams.get(repo)?.forEach(tick => tick());
const refreshAll = () => [...streams.keys()].forEach(refresh);

function refreshSoon(repo: string) {
  if (pendingRefresh.has(repo)) return;
  pendingRefresh.add(repo);
  setTimeout(() => { pendingRefresh.delete(repo); refresh(repo); }, STREAM_DEBOUNCE_MS);
}

// 重算畫面本身會碰到的檔案：開關 maester.db 會建刪 -shm/-wal，git 會碰 index 和 lock；算進去就自己觸發自己。
// 真正的寫入在最後一個連線關閉時會寫回 maester.db 本體，所以不會漏
const isOwnNoise = (file: string) => /^\.git[\\/](index|.*\.lock$)|maester\.db-(shm|wal)$/.test(file);

function watchRepo(repo: string) {
  try {
    const watcher = fs.watch(repo, { recursive: true }, (_event, file) => { if (!file || !isOwnNoise(file)) refreshSoon(repo); });
    watcher.on('error', () => { watcher.close(); watchers.delete(repo); });
    watchers.set(repo, watcher);
  } catch {}
}

function unwatchRepo(repo: string) {
  streams.delete(repo);
  watchers.get(repo)?.close();
  watchers.delete(repo);
}

// 檔案有變才重算畫面：每次重算要跑好幾個 git，固定輪詢在 Windows 和大 repo 上太貴
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
  if (!streams.has(repo)) {
    streams.set(repo, new Set());
    watchRepo(repo);
  }
  streams.get(repo)!.add(tick);
  const timer = setInterval(tick, watchers.has(repo) ? STREAM_FALLBACK_MS : STREAM_POLL_MS);
  req.on('close', () => {
    clearInterval(timer);
    const ticks = streams.get(repo);
    ticks?.delete(tick);
    if (ticks?.size === 0) unwatchRepo(repo);
  });
}

const isTrustedEventRequest = (req: http.IncomingMessage) => {
  const origin = req.headers.origin;
  return hasKey(req.headers[KEY_HEADER]) && (!origin || LOCAL_ORIGINS.has(origin));
};

function applyToStore(repo: string, body: string, res: http.ServerResponse, apply: (store: Store, input: any) => unknown) {
  let input: unknown;
  try { input = JSON.parse(body); }
  catch { return send(res, 400, { error: 'bad json' }); }
  let store: Store | null = null;
  try {
    store = openStore(repo);
    if (!store) return send(res, 409, { error: '這個 repo 還沒有 maester.db' });
    send(res, 200, apply(store, input));
  } catch (error) {
    send(res, error instanceof Rejected ? 409 : 500, { error: messageOf(error) });
  } finally { store?.close(); }
}

// 不是 Maester 的 repo 也收：只拿帳號用量，不記 agent
function receiveAgent(req: http.IncomingMessage, res: http.ServerResponse, repo: string | null) {
  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > MAX_EVENT_BYTES) req.destroy();
  });
  req.on('end', () => {
    try {
      const info = pickAgent(JSON.parse(body));
      limits = nextLimits(limits, info);
      if (repo) agents.set(repo, nextAgent(agents.get(repo), info));
    }
    catch { return send(res, 400, { error: 'bad json' }); }
    send(res, 200, { ok: true });
    refreshAll();
  });
}

function receiveJson(req: http.IncomingMessage, res: http.ServerResponse, repo: string, apply: (store: Store, input: any) => unknown) {
  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > MAX_EVENT_BYTES) req.destroy();
  });
  req.on('end', () => applyToStore(repo, body, res, apply));
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
      return isKnownRepo(repo) ? receiveJson(req, res, repo, (store, event: EventInput) => store.submit(event)) : send(res, 404, { error: 'unknown repo' });
    case '/api/red-by':
      if (req.method !== 'POST') break;
      if (!isTrustedEventRequest(req)) return send(res, 403, { error: 'forbidden' });
      return isKnownRepo(repo) ? receiveJson(req, res, repo, (store, input) => store.setRedBy(input?.value)) : send(res, 404, { error: 'unknown repo' });
    case '/api/start':
    case '/api/resume':
      if (req.method !== 'POST') break;
      if (!isTrustedEventRequest(req)) return send(res, 403, { error: 'forbidden' });
      return isKnownRepo(repo) ? receiveJson(req, res, repo, (store, input) => url.pathname === '/api/start' ? store.startFromPage(input?.text) : store.resumeFromPage(input?.feature))
        : send(res, 404, { error: 'unknown repo' });
    case '/api/statusline':
      if (req.method !== 'POST') break;
      if (!isTrustedEventRequest(req)) return send(res, 403, { error: 'forbidden' });
      try { installStatusline(); send(res, 200, { ok: true }); return refreshAll(); }
      catch (error) { return send(res, error instanceof Rejected ? 409 : 500, { error: messageOf(error) }); }
    case '/api/agent':
      if (req.method !== 'POST') break;
      if (!isTrustedEventRequest(req)) return send(res, 403, { error: 'forbidden' });
      return receiveAgent(req, res, isKnownRepo(repo) ? repo : null);
  }
  serveStatic(url.pathname, res);
});

server.listen(PORT, '127.0.0.1', () => console.log(`maester on http://127.0.0.1:${PORT} (home ${maesterHome()})`));
