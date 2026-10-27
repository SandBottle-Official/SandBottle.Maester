import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { Fixtures } from './support/fixtures.ts';
import { scenario } from './support/scenario.ts';
import { CLI, KEY_HEADER, PROTOCOL } from './support/system.ts';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function freePort() {
  const probe = net.createServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as net.AddressInfo;
  await new Promise(resolve => probe.close(resolve));
  return String(port);
}

describe('server 與端到端', () => {
  test('R48 常駐server協定版本不同_ensure重啟 與 open→寫入→/api/view', async () => {
    const S = scenario();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'maester-server-home-'));
    const port = await freePort();
    const env = { ...process.env, SHOUJI_HOME: home, SHOUJI_PORT: port, MAESTER_HOME: home, MAESTER_PORT: port };
    let serverPid = 0;
    after(() => {
      try { process.kill(serverPid); } catch {}
      fs.rmSync(home, { recursive: true, force: true });
    });
    const outdated = spawn(process.execPath, ['-e', `require('http').createServer((q,r)=>r.end(JSON.stringify({ok:true,protocol:2,pid:process.pid}))).listen(${port},'127.0.0.1')`], { stdio: 'ignore' });
    await sleep(300);
    execFileSync(process.execPath, [CLI, 'ensure'], { cwd: S.repo, env });
    const ping = await (await fetch(`http://127.0.0.1:${port}/api/ping`)).json();
    serverPid = ping.pid;
    assert.equal(ping.protocol, PROTOCOL);
    assert.notEqual(ping.pid, outdated.pid);

    execFileSync(process.execPath, [CLI, 'start'], { cwd: S.repo, env, input: JSON.stringify({ name: Fixtures.客戶訂閱 }) });
    execFileSync(process.execPath, [CLI, 'ensure'], { cwd: S.repo, env });
    const repo = encodeURIComponent(S.g('rev-parse', '--show-toplevel'));
    const key = fs.readFileSync(path.join(home, 'key'), 'utf8').trim();
    const view = await (await fetch(`http://127.0.0.1:${port}/api/view?repo=${repo}&key=${key}`)).json();
    assert.equal(view.state.feature, Fixtures.客戶訂閱);

    const post = (body: unknown) => fetch(`http://127.0.0.1:${port}/api/event?repo=${repo}`, { method: 'POST', headers: { [KEY_HEADER]: key }, body: JSON.stringify(body) });
    assert.equal((await post({ type: 'approve_design', feature: view.featureId, ctx: { stage: 'roundtable' } })).status, 200);
    const stale = await post({ type: 'tests_ran', feature: view.featureId, ctx: { stage: 'tdd' } });
    assert.equal(stale.status, 409);
    assert.match((await stale.json()).error, /過期/);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/event?repo=${repo}`, { method: 'POST', body: '{}' })).status, 403);

    const redBy = (value: string, headers: Record<string, string> = { [KEY_HEADER]: key }) =>
      fetch(`http://127.0.0.1:${port}/api/red-by?repo=${repo}`, { method: 'POST', headers, body: JSON.stringify({ value }) });
    assert.equal((await redBy('user', {})).status, 403);
    assert.equal((await redBy('codex')).status, 409);
    assert.equal((await redBy('user')).status, 200);
    assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/view?repo=${repo}&key=${key}`)).json()).redBy, 'user');
  });

  test('reads_require_the_key_and_pages_carry_security_headers', async () => {
    const S = scenario();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'maester-headers-home-'));
    const port = await freePort();
    const env = { ...process.env, MAESTER_HOME: home, MAESTER_PORT: port };
    execFileSync(process.execPath, [CLI, 'start'], { cwd: S.repo, env, input: JSON.stringify({ name: Fixtures.客戶訂閱 }) });
    execFileSync(process.execPath, [CLI, 'ensure'], { cwd: S.repo, env });
    const running = await (await fetch(`http://127.0.0.1:${port}/api/ping`)).json();
    after(() => { try { process.kill(running.pid); } catch {} fs.rmSync(home, { recursive: true, force: true }); });
    const key = fs.readFileSync(path.join(home, 'key'), 'utf8').trim();
    const repo = encodeURIComponent(S.g('rev-parse', '--show-toplevel'));
    const base = `http://127.0.0.1:${port}`;

    for (const endpoint of [`/api/view?repo=${repo}`, `/api/stream?repo=${repo}`, '/api/projects']) {
      assert.equal((await fetch(base + endpoint)).status, 403, endpoint);
    }
    assert.equal((await fetch(`${base}/api/projects?key=${key}`)).status, 200);

    const page = await fetch(`${base}/`);
    const csp = page.headers.get('content-security-policy') ?? '';
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /script-src 'self' 'sha256-[^']+' 'sha256-[^']+'/);
    assert.doesNotMatch(csp, /unsafe-inline'[^;]*script|script-src[^;]*'unsafe-inline'/);
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  });

  test('stream_pushes_file_edits_without_waiting_for_a_poll', async () => {
    const S = scenario();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'maester-stream-home-'));
    const port = await freePort();
    const env = { ...process.env, MAESTER_HOME: home, MAESTER_PORT: port };
    execFileSync(process.execPath, [CLI, 'start'], { cwd: S.repo, env, input: JSON.stringify({ name: Fixtures.客戶訂閱 }) });
    execFileSync(process.execPath, [CLI, 'ensure'], { cwd: S.repo, env });
    const running = await (await fetch(`http://127.0.0.1:${port}/api/ping`)).json();
    const abort = new AbortController();
    after(() => { abort.abort(); try { process.kill(running.pid); } catch {} fs.rmSync(home, { recursive: true, force: true }); });
    const key = fs.readFileSync(path.join(home, 'key'), 'utf8').trim();
    const repo = encodeURIComponent(S.g('rev-parse', '--show-toplevel'));
    const res = await fetch(`http://127.0.0.1:${port}/api/stream?repo=${repo}&key=${key}`, { signal: abort.signal });
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let received = '';
    const until = async (text: string, ms: number) => {
      const deadline = Date.now() + ms;
      while (!received.includes(text)) {
        const chunk = await Promise.race([reader.read(), sleep(deadline - Date.now()).then(() => null)]);
        if (!chunk || chunk.done) return false;
        received += chunk.value;
      }
      return true;
    };
    assert.ok(await until('data:', 5000));
    await sleep(300);
    fs.writeFileSync(path.join(S.repo, 'watched.txt'), 'hello\n');
    assert.ok(await until('watched.txt', 3000), 'file edit should reach the page well before the fallback poll');
  });
});
