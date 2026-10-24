import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MANIFESTS = ['.claude-plugin/plugin.json', '.claude-plugin/marketplace.json', '.codex-plugin/plugin.json', '.agents/plugins/marketplace.json'];
const readJson = (file: string) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const ALLOWED_LEGACY_MENTIONS = new Set(['src/migrate/legacy-workbench.ts', 'test/adopt-shouji.test.ts', 'test/server-lifecycle.test.ts', 'test/skills.test.ts', 'test/manifests.test.ts', 'CHANGELOG.md']);
const BANNED = ['shouji', '手跡', '/Users/', 'Newton 的'];

describe('plugin manifests', () => {
  test('manifests_agree_on_name_and_version', () => {
    const [claudePlugin, claudeMarket, codexPlugin, codexMarket] = MANIFESTS.map(readJson);
    assert.equal(claudePlugin.name, 'maester');
    assert.equal(codexPlugin.name, 'maester');
    assert.equal(claudeMarket.plugins[0].name, 'maester');
    assert.equal(codexMarket.plugins[0].name, 'maester');
    assert.equal(claudePlugin.version, readJson('package.json').version);
    assert.equal(codexPlugin.version, readJson('package.json').version);
  });

  test('hook_points_at_existing_launcher', () => {
    const commands = readJson('hooks/hooks.json').hooks.SessionStart.flatMap((entry: { hooks: { command: string }[] }) => entry.hooks.map(h => h.command));
    assert.equal(commands.length, 1);
    const launcher = commands[0].match(/"\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)"/)?.[1];
    assert.ok(launcher && fs.existsSync(path.join(ROOT, launcher)), commands[0]);
    assert.match(commands[0], /ensure --hook$/);
  });

  test('hook_mode_is_silent_outside_git', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'maester-no-git-'));
    after(() => fs.rmSync(outside, { recursive: true, force: true }));
    const result = spawnSync(process.execPath, [path.join(ROOT, 'bin/maester.mjs'), 'ensure', '--hook'], { cwd: outside, encoding: 'utf8', env: { ...process.env, MAESTER_HOME: outside, MAESTER_PORT: '1' } });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  });

  test('repo_has_no_personal_paths', () => {
    const tracked = execFileSync('git', ['-C', ROOT, 'ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\n').filter(Boolean);
    const offenders = tracked.filter(file => !ALLOWED_LEGACY_MENTIONS.has(file) && !file.startsWith('docs/superpowers/') && !/\.(png|ico|icns)$/.test(file))
      .flatMap(file => BANNED.filter(word => fs.readFileSync(path.join(ROOT, file), 'utf8').includes(word)).map(word => `${file}: ${word}`));
    assert.deepEqual(offenders, []);
  });
});
