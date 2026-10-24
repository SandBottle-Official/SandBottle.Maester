import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { CLI } from './support/system.ts';

describe('statusline 接到 Maester', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'maester-statusline-'));
  after(() => fs.rmSync(home, { recursive: true, force: true }));
  process.env.MAESTER_HOME = path.join(home, 'maester');
  process.env.CLAUDE_CONFIG_DIR = path.join(home, 'claude');
  const settings = path.join(home, 'claude', 'settings.json');
  const read = () => JSON.parse(fs.readFileSync(settings, 'utf8'));
  const env = { ...process.env, MAESTER_PORT: '1' };

  test('安裝_保留原本指令並照跑_還原後回到原樣', async () => {
    const { installStatusline, statuslineInstalled } = await import('../src/server/statusline.ts');
    fs.mkdirSync(path.dirname(settings), { recursive: true });
    fs.writeFileSync(settings, JSON.stringify({ model: 'x', statusLine: { type: 'command', command: 'cat >/dev/null; echo mine', padding: 1 } }));
    installStatusline();
    installStatusline(); // 再按一次不能把自己存成原本的指令
    assert.equal(statuslineInstalled(), true);
    assert.match(read().statusLine.command, /maester\.mjs" statusline$/);
    assert.deepEqual([read().model, read().statusLine.padding], ['x', 1]);

    const run = spawnSync(process.execPath, [CLI, 'statusline'], { cwd: home, env, input: '{"workspace":{}}', encoding: 'utf8' });
    assert.equal(run.stdout.trim(), 'mine');

    spawnSync(process.execPath, [CLI, 'statusline', '--uninstall'], { cwd: home, env, encoding: 'utf8' });
    assert.deepEqual(read().statusLine, { type: 'command', command: 'cat >/dev/null; echo mine', padding: 1 });
    assert.equal(statuslineInstalled(), false);
  });

  test('SessionStart 自動接上_還原過或換掉過就不再接', async () => {
    const { statuslineInstalled } = await import('../src/server/statusline.ts');
    const backup = path.join(home, 'maester', 'statusline.json');
    fs.rmSync(backup, { force: true });
    fs.writeFileSync(settings, JSON.stringify({ statusLine: { type: 'command', command: 'echo mine' } }));
    const hook = (extra = {}) => spawnSync(process.execPath, [CLI, 'ensure', '--hook'], { cwd: home, env: { ...env, ...extra }, input: '{"source":"startup"}', encoding: 'utf8' });
    hook({ CLAUDECODE: '', CLAUDE_PLUGIN_ROOT: '' });
    assert.equal(read().statusLine.command, 'echo mine', '不是 Claude Code 的 hook 不接');
    hook({ CLAUDECODE: '1', CLAUDE_PLUGIN_ROOT: 'x' });
    assert.match(read().statusLine.command, /maester\.mjs" statusline$/);
    assert.equal(hook().stdout, '', '不輸出提示');

    fs.writeFileSync(settings, JSON.stringify({ statusLine: { type: 'command', command: 'echo other' } }));
    hook({ CLAUDECODE: '1', CLAUDE_PLUGIN_ROOT: 'x' });
    assert.equal(read().statusLine.command, 'echo other', '使用者換掉了就不再接');
    assert.equal(statuslineInstalled(), false);
  });

  test('settings 不是純 JSON_拒絕且不改檔', async () => {
    const { installStatusline } = await import('../src/server/statusline.ts');
    fs.writeFileSync(settings, '{ // comment\n}');
    assert.throws(() => installStatusline(), /不是純 JSON/);
    assert.equal(fs.readFileSync(settings, 'utf8'), '{ // comment\n}');
  });
});
