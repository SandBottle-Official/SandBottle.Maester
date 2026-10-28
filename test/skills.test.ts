import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { COMMAND_NAMES } from '../src/cli/commands.ts';

const SKILLS_ROOT = fileURLToPath(new URL('../skills/', import.meta.url));
const SKILL_NAMES = ['council', 'forge', 'open', 'stop'];
const MAX_DESCRIPTION_LENGTH = 1024;

const skillText = (name: string) => fs.readFileSync(path.join(SKILLS_ROOT, name, 'SKILL.md'), 'utf8');

function frontmatter(name: string): Record<string, string> {
  const block = skillText(name).match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '';
  return Object.fromEntries(block.split('\n').map(line => line.match(/^(\w[\w-]*):\s*(.*)$/)).filter(m => m !== null).map(m => [m[1], m[2].replace(/^"|"$/g, '')]));
}

function filesUnder(dir: string): string[] {
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => path.join(e.parentPath, e.name));
}

describe('skills', () => {
  test('every_skill_has_frontmatter_name_and_description', () => {
    for (const name of SKILL_NAMES) {
      const meta = frontmatter(name);
      assert.equal(meta.name, name);
      assert.ok(meta.description, `${name} needs a description`);
      assert.ok(meta.description.length <= MAX_DESCRIPTION_LENGTH, `${name} description too long`);
    }
  });

  test('every_skill_declares_zh_tw_default', () => {
    for (const name of SKILL_NAMES) assert.match(skillText(name), /Traditional Chinese \(zh-TW\)/, name);
  });

  test('descriptions_keep_chinese_triggers', () => {
    assert.match(frontmatter('council').description, /大師圓桌/);
    for (const trigger of ['開始 Task', '下一個測試', '由我實作']) assert.match(frontmatter('forge').description, new RegExp(trigger));
    assert.match(frontmatter('open').description, /打開網頁看進度/);
  });

  test('no_personal_or_legacy_names', () => {
    for (const file of filesUnder(SKILLS_ROOT)) {
      const text = fs.readFileSync(file, 'utf8');
      for (const banned of ['shouji', '手跡', 'Newton', '/Users/', '~/.claude/skills']) assert.ok(!text.includes(banned), `${path.relative(SKILLS_ROOT, file)} contains ${banned}`);
    }
  });

  test('only_open_and_stop_are_slash_commands', () => {
    assert.equal(frontmatter('council')['user-invocable'], 'false');
    assert.equal(frontmatter('forge')['user-invocable'], 'false');
    for (const name of ['open', 'stop']) assert.equal(frontmatter(name)['user-invocable'], undefined);
  });

  test('state_spec_lists_every_cli_command', () => {
    const spec = fs.readFileSync(path.join(SKILLS_ROOT, 'open', 'references', 'state-spec.md'), 'utf8');
    for (const command of COMMAND_NAMES) assert.match(spec, new RegExp(`\`maester ${command}\\b`), command);
  });
});
