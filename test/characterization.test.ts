import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Fixtures } from './support/fixtures.ts';
import { scenario } from './support/scenario.ts';
import { SCHEMA, TEST_PATH } from './support/system.ts';

describe('Characterization：畫面資料格式（app.js 依賴的形狀）', () => {
  test('測試碼路徑判斷', () => {
    assert.equal(TEST_PATH.test('Shop.Admin.Test.Unit/Support/Scenario.cs'), true);
    assert.equal(TEST_PATH.test('src/main/A.java'), false);
  });

  test('view 頂層欄位、你改的檔案與綠燈統計', () => {
    const S = scenario();
    S.inTdd();
    S.w('src/main/A.java', 'a\nb\n');
    S.w('src/test/ATest.java', 't\n');
    const v = S.view();
    for (const key of ['repo', 'name', 'branch', 'errors', 'state', 'plan', 'history', 'roundtable', 'greens', 'changes', 'pending']) assert.ok(key in v, key);
    assert.deepEqual(v.changes.map((c: any) => [c.file, c.add, c.test]), [['src/main/A.java', 1, false], ['src/test/ATest.java', 2, true]]);
    S.g('add', '.');
    S.g('commit', '-qm', 'test: x\n\nGreen-By: user');
    assert.deepEqual(S.view().greens, { user: 1, total: 1 });
    assert.deepEqual(Object.keys(v.state.tdd).filter(k => ['task', 'test', 'phase'].includes(k)), ['task', 'test', 'phase']);
    assert.equal(v.state.tdd.task, '00');
    assert.equal(v.state.tdd.test, 1);
  });
});

describe('非 ASCII 檔名', () => {
  test('changed_files_keep_cjk_names', () => {
    const S = scenario();
    S.inTdd();
    S.w('tests/訂單.test.ts', 'a\nb\n');
    assert.deepEqual(S.view().changes.map((c: any) => [c.file, c.add, c.test]), [['tests/訂單.test.ts', 3, true]]);
  });
});

describe('契約：CLI', () => {
  test('寫入成功時exit0並印出結果JSON', () => {
    const S = scenario();
    const x = S.run(['start'], { name: Fixtures.客戶訂閱 });
    assert.equal(x.code, 0);
    assert.equal(typeof x.out.feature, 'number');
  });

  test('拒絕時exit1且stderr印出原因且DB不變', () => {
    const S = scenario();
    S.start();
    const before = S.snapshot();
    S.rejected(['stage'], { state: 'REVIEWING' }, /圓桌階段只能是/);
    assert.equal(S.snapshot(), before);
  });

  test('store開檔啟用WAL與foreign_keys並記版本', () => {
    const S = scenario();
    S.start();
    const db = S.db();
    try {
      assert.equal(db.get('PRAGMA journal_mode').journal_mode, 'wal');
      assert.equal(db.get('PRAGMA foreign_keys').foreign_keys, 1);
      assert.equal(db.get('PRAGMA user_version').user_version, SCHEMA);
    } finally { db.close(); }
  });
});
