import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { openStore } from '../src/core/store.ts';
import { cli, tempRepo } from './support/scenario.ts';

const LEGACY_DIR = '.shouji';
const LEGACY_DB = path.join(LEGACY_DIR, 'shouji.db');

function seedLegacyDb(repo: string, featureName: string) {
  const store = openStore(repo, { write: true, file: path.join(repo, LEGACY_DB) })!;
  try { store.startFeature({ name: featureName }); } finally { store.close(); }
}

function fingerprints(dir: string): Record<string, string> {
  return Object.fromEntries(fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter(e => e.isFile())
    .map(e => {
      const file = path.join(e.parentPath, e.name);
      return [path.relative(dir, file), crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')];
    }));
}

const temporaryHome = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maester-adopt-home-'));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

describe('舊的手跡資料', () => {
  test('copies_shouji_db_into_maester_and_leaves_original_untouched', () => {
    const r = tempRepo();
    r.w('.git/info/exclude', `${LEGACY_DIR}/\n`);
    seedLegacyDb(r.repo, '客戶訂閱');
    r.w(`${LEGACY_DIR}/roundtable/01-discover.json`, { kind: 'discover', summary: '現況' });
    const before = fingerprints(path.join(r.repo, LEGACY_DIR));

    const shown = cli(r.repo, ['show']);

    assert.equal(shown.code, 0, shown.err);
    assert.match(shown.out, /客戶訂閱/);
    assert.ok(fs.existsSync(path.join(r.repo, '.maester', 'maester.db')));
    assert.ok(fs.existsSync(path.join(r.repo, '.maester', 'roundtable', '01-discover.json')));
    assert.deepEqual(fingerprints(path.join(r.repo, LEGACY_DIR)), before);
    assert.ok(fs.readFileSync(path.join(r.repo, '.git/info/exclude'), 'utf8').split('\n').includes('.maester/'));
  });

  test('skips_when_maester_already_exists', () => {
    const r = tempRepo();
    seedLegacyDb(r.repo, '舊的功能');
    const current = openStore(r.repo, { write: true })!;
    try { current.startFeature({ name: '新的功能' }); } finally { current.close(); }

    const shown = cli(r.repo, ['show']);

    assert.match(shown.out, /新的功能/);
    assert.doesNotMatch(shown.out, /舊的功能/);
  });

  test('copies_legacy_json_without_db_so_migrate_still_works', () => {
    const r = tempRepo();
    r.w(`${LEGACY_DIR}/plan.json`, { schemaVersion: 1, feature: '門市權限', tasks: [{ id: '00', title: '基礎建設', tests: [{ name: 'Scenario' }] }] });

    assert.match(cli(r.repo, ['show']).out, /maester migrate/);
    const migrated = cli(r.repo, ['migrate']);
    assert.equal(migrated.code, 0, migrated.err);
    assert.equal(migrated.out.feature, '門市權限');
  });

  test('copies_project_list_but_not_key_from_shouji_home', () => {
    const r = tempRepo();
    const legacyHome = temporaryHome(), home = temporaryHome();
    fs.writeFileSync(path.join(legacyHome, 'projects.json'), JSON.stringify(['/somewhere/repo']));
    fs.writeFileSync(path.join(legacyHome, 'key'), 'legacy-key');

    const result = cli(r.repo, ['url'], undefined, { ...process.env, SHOUJI_HOME: legacyHome, MAESTER_HOME: home });

    assert.equal(result.code, 0, result.err);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, 'projects.json'), 'utf8')), ['/somewhere/repo']);
    assert.notEqual(fs.readFileSync(path.join(home, 'key'), 'utf8').trim(), 'legacy-key');
  });

  test('failed_adoption_leaves_no_partial_maester_folder', () => {
    const r = tempRepo();
    r.w(`${LEGACY_DIR}/shouji.db`, 'not a database');
    r.w(`${LEGACY_DIR}/roundtable/01-discover.json`, { kind: 'discover', summary: '現況' });

    const failed = cli(r.repo, ['show']);

    assert.equal(failed.code, 1);
    assert.match(failed.err, /\.shouji/);
    assert.equal(fs.existsSync(path.join(r.repo, '.maester')), false);
    assert.equal(fs.readFileSync(path.join(r.repo, LEGACY_DIR, 'shouji.db'), 'utf8'), 'not a database');
  });
});
