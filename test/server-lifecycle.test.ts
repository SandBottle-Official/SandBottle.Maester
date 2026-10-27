import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { openerFor, serverSpawnOptions } from '../src/server/client.ts';
import { PLUGIN_ROOT, PLUGIN_VERSION } from '../src/server/protocol.ts';
import { GIT_SPAWN } from '../src/view/git.ts';
import { scenario, submit, tempRepo } from './support/scenario.ts';
import { CLI } from './support/system.ts';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHIPPED = ['bin', 'src', 'web', 'package.json'];

function listenOnFreePort(server: net.Server): Promise<string> {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(String((server.address() as net.AddressInfo).port))));
}

async function freePort() {
  const probe = net.createServer();
  const port = await listenOnFreePort(probe);
  await new Promise(resolve => probe.close(resolve));
  return port;
}

function isolatedServerEnv(port: string) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'maester-lifecycle-home-'));
  after(() => fs.rmSync(home, { recursive: true, force: true }));
  return { home, env: { ...process.env, MAESTER_HOME: home, MAESTER_PORT: port } };
}

async function pingAt(port: string) {
  return (await fetch(`http://127.0.0.1:${port}/api/ping`)).json();
}

function copyOfPlugin(version: string) {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'maester-other-root-'));
  for (const entry of SHIPPED) fs.cpSync(path.join(REPO_ROOT, entry), path.join(copy, entry), { recursive: true });
  const manifest = path.join(copy, 'package.json');
  fs.writeFileSync(manifest, JSON.stringify({ ...JSON.parse(fs.readFileSync(manifest, 'utf8')), version }));
  after(() => fs.rmSync(copy, { recursive: true, force: true }));
  return copy;
}

// macOS keeps `open` next to git in /usr/bin, so link git alone; on Windows git's folder never holds rundll32.
function pathWithGitButNoBrowserOpener() {
  const git = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['git'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim();
  if (process.platform === 'win32') return path.dirname(git);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maester-path-'));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.symlinkSync(git, path.join(dir, 'git'));
  return dir;
}

// Windows refuses to delete a folder while a process still runs from it.
async function waitUntilPortIsFree(port: string) {
  for (let i = 0; i < 50; i++) {
    try { await pingAt(port); } catch { return; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

async function serverStartedFrom(root: string, repo: string, env: NodeJS.ProcessEnv, port: string) {
  execFileSync(process.execPath, [path.join(root, 'bin/maester.mjs'), 'ensure'], { cwd: repo, env });
  const running = await pingAt(port);
  after(() => { try { process.kill(running.pid); } catch {} });
  return running;
}

describe('server 生命週期', () => {
  test('restarts_server_of_another_version', async () => {
    const r = tempRepo();
    const port = await freePort();
    const { env } = isolatedServerEnv(port);
    const outdated = await serverStartedFrom(copyOfPlugin('0.0.1'), r.repo, env, port);

    const current = await serverStartedFrom(REPO_ROOT, r.repo, env, port);

    assert.equal(outdated.version, '0.0.1');
    assert.equal(current.version, PLUGIN_VERSION);
    assert.notEqual(current.pid, outdated.pid);
  });

  test('keeps_server_of_same_version_from_another_install', async () => {
    const r = tempRepo();
    const port = await freePort();
    const { env } = isolatedServerEnv(port);
    const otherInstall = await serverStartedFrom(copyOfPlugin(PLUGIN_VERSION), r.repo, env, port);

    const afterEnsure = await serverStartedFrom(REPO_ROOT, r.repo, env, port);
    process.kill(otherInstall.pid);
    await waitUntilPortIsFree(port);

    assert.equal(afterEnsure.pid, otherInstall.pid);
  });

  test('reports_port_and_log_when_port_is_taken', async () => {
    const r = tempRepo();
    const blocker = net.createServer(socket => socket.destroy());
    const port = await listenOnFreePort(blocker);
    after(() => blocker.close());
    const { env } = isolatedServerEnv(port);

    const startedAt = Date.now();
    const failed = spawnSync(process.execPath, [CLI, 'ensure'], { cwd: r.repo, env, encoding: 'utf8' });
    const hooked = spawnSync(process.execPath, [CLI, 'ensure', '--hook'], { cwd: r.repo, env, encoding: 'utf8' });

    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /MAESTER_PORT/);
    assert.match(failed.stderr, /server\.log/);
    assert.ok(Date.now() - startedAt < 10_000);
    assert.equal(hooked.status, 0);
    assert.equal(hooked.stdout, '');
  });

  test('新session開始時_退回中斷session的處理中事件並提醒AI', async () => {
    const S = scenario();
    S.inTdd();
    const { env } = isolatedServerEnv(await freePort());
    const hook = (source: string) => spawnSync(process.execPath, [CLI, 'ensure', '--hook'], { cwd: S.repo, env, encoding: 'utf8', input: JSON.stringify({ source }) });
    after(async () => { try { process.kill((await pingAt(env.MAESTER_PORT)).pid); } catch {} });
    const id = submit(S, 'tests_ran').id;
    S.ok(['wait']);

    const compacted = hook('compact');
    assert.match(compacted.stdout, new RegExp(`${id} tests_ran（處理中）`));
    assert.equal(S.view().processing.length, 1);

    const started = hook('startup');
    assert.match(started.stdout, new RegExp(`maester\\.mjs" wait[\\s\\S]*${id} tests_ran（待處理）`));
    assert.deepEqual(S.ok(['wait']).id, id);
  });

  test('openerFor_picks_platform_command', () => {
    const url = 'http://127.0.0.1:4848/?repo=x';
    assert.deepEqual(openerFor('darwin', url), { command: 'open', args: [url] });
    assert.deepEqual(openerFor('linux', url), { command: 'xdg-open', args: [url] });
    assert.deepEqual(openerFor('win32', url), { command: 'rundll32', args: ['url.dll,FileProtocolHandler', url] });
  });

  test('server_window_is_hidden_on_windows', () => {
    assert.equal(serverSpawnOptions(1).windowsHide, true);
    assert.equal(serverSpawnOptions(1).cwd, PLUGIN_ROOT);
  });

  test('git_polled_by_server_does_not_flash_windows_on_windows', () => {
    assert.equal(GIT_SPAWN.windowsHide, true);
  });

  // Windows keeps both PATH and Path; replacing one does not hide the system opener reliably.
  test('open_prints_url_even_without_a_browser_opener', { skip: process.platform === 'win32' }, async () => {
    const r = tempRepo();
    const port = await freePort();
    const { env, home } = isolatedServerEnv(port);
    const onlyGit = pathWithGitButNoBrowserOpener();

    const opened = spawnSync(process.execPath, [CLI, 'open'], { cwd: r.repo, env: { ...env, PATH: onlyGit }, encoding: 'utf8' });
    after(async () => { try { process.kill((await pingAt(port)).pid); } catch {} });

    assert.equal(opened.status, 0, opened.stderr);
    assert.match(opened.stdout, new RegExp(`http://127\\.0\\.0\\.1:${port}/\\?key=`));
    assert.ok(home);
  });

  test('rejects_requests_for_foreign_hosts', async () => {
    const r = tempRepo();
    const port = await freePort();
    const { env } = isolatedServerEnv(port);
    await serverStartedFrom(REPO_ROOT, r.repo, env, port);

    const status = await new Promise<number>(resolve => {
      http.get({ host: '127.0.0.1', port: Number(port), path: '/api/projects', headers: { host: `evil.example:${port}` } }, res => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
    });

    assert.equal(status, 403);
  });

  test('never_kills_a_foreign_program_on_the_port', async () => {
    const r = tempRepo();
    const foreign = http.createServer((_, res) => res.end(JSON.stringify({ ok: true, pid: process.pid })));
    const port = await listenOnFreePort(foreign);
    after(() => foreign.close());
    const { env } = isolatedServerEnv(port);

    const ensured = spawnSync(process.execPath, [CLI, 'ensure'], { cwd: r.repo, env, encoding: 'utf8' });

    assert.equal(ensured.status, 1);
    assert.match(ensured.stderr, /MAESTER_PORT/);
    assert.ok(foreign.listening);
  });
});
