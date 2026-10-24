import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { scenario } from './support/scenario.ts';
import { SCHEMA } from './support/system.ts';

describe('換階段', () => {
  test('R18 紅到綠與綠到重構_更新階段與內容', () => {
    const S = scenario();
    const { tests } = S.inTdd();
    S.ok(['phase'], { test: tests[0].id, phase: 'red', story: '測試要能組情境', testCode: { file: 'ATest.java', lang: 'java', code: 'assert x' }, failure: 'FAILED' });
    S.ok(['phase'], { test: tests[0].id, phase: 'green', greenExample: { file: 'A.java', lang: 'java', code: 'a\nb', added: [2] } });
    S.ok(['phase'], { test: tests[0].id, phase: 'refactor', refactor: '抽出 helper' });
    const t = S.view().state.tdd;
    assert.equal(t.phase, 'refactor');
    assert.equal(t.story, '測試要能組情境');
    assert.deepEqual(t.testCode, { file: 'ATest.java', lang: 'java', code: 'assert x' });
    assert.deepEqual(t.greenExample, { file: 'A.java', lang: 'java', code: 'a\nb', added: [2] });
    assert.equal(t.refactor, '抽出 helper');
  });

  test('R19 同一階段_只更新內容', () => {
    const S = scenario();
    const { tests } = S.inTdd();
    S.toPhase(tests[0].id, 'green');
    S.ok(['phase'], { test: tests[0].id, phase: 'green', hint: '先看 Fixtures' });
    const t = S.view().state.tdd;
    assert.deepEqual([t.phase, t.hint], ['green', '先看 Fixtures']);
  });

  test('教學內容_寫入後讀回同樣的結構', () => {
    const S = scenario();
    const { tests } = S.inTdd();
    const lesson = { intro: '路由', topics: [{ name: 'Hono', points: [{ term: 'app.post()', analog: 'C#：[HttpPost]', text: '註冊路由' }] }] };
    S.ok(['phase'], { test: tests[0].id, phase: 'red', lesson });
    assert.deepEqual(S.view().state.tdd.lesson, lesson);
  });

  test('多個檔案的綠燈範例_各自讀回', () => {
    const S = scenario();
    const { tests } = S.inTdd();
    const files = [{ file: 'a.ts', lang: 'ts', code: 'a' }, { file: 'b.ts', lang: 'ts', code: 'b', added: [1] }];
    S.toPhase(tests[0].id, 'green');
    S.ok(['phase'], { test: tests[0].id, phase: 'green', greenExample: files });
    assert.deepEqual(S.view().state.tdd.greenFiles, files);
    S.ok(['phase'], { test: tests[0].id, phase: 'green', greenExample: { file: 'c.ts', lang: 'ts', code: 'c' } });
    assert.deepEqual(S.view().state.tdd.greenFiles, [{ file: 'c.ts', lang: 'ts', code: 'c', added: [] }]);
  });

  test('版本 1 的 DB_開啟時補上新欄位', () => {
    const S = scenario();
    S.inTdd();
    const db = S.db();
    db.connection.exec('ALTER TABLE steps DROP COLUMN lesson; ALTER TABLE steps DROP COLUMN test_files; ALTER TABLE steps DROP COLUMN green_files; ALTER TABLE events DROP COLUMN text; PRAGMA user_version = 1;');
    db.close();
    const again = S.db();
    try {
      assert.equal(again.get('PRAGMA user_version').user_version, SCHEMA);
      const columns = again.all('PRAGMA table_info(steps)').map((c: any) => c.name);
      assert.deepEqual(['lesson', 'test_files', 'green_files'].filter(n => columns.includes(n)).length, 3);
    } finally { again.close(); }
  });

  test('R20 其他跳法_拒絕', () => {
    const S = scenario();
    const { tests } = S.inTdd();
    S.rejected(['phase'], { test: tests[0].id, phase: 'refactor' }, /red 換到 refactor/);
    S.toPhase(tests[0].id, 'green', 'refactor');
    S.rejected(['phase'], { test: tests[0].id, phase: 'green' });
    S.rejected(['phase'], { test: tests[0].id, phase: 'red' });
  });

  test('rejects_added_lines_that_are_not_line_numbers', () => {
    const S = scenario();
    const { tests } = S.inTdd();
    S.toPhase(tests[0].id, 'green');
    const markup = '"><img src=x onerror=alert(1)>';
    S.rejected(['phase'], { test: tests[0].id, phase: 'green', greenExample: { file: 'a.ts', lang: 'ts', code: 'a', added: [markup] } }, /added/);
    S.rejected(['phase'], { test: tests[0].id, phase: 'green', greenExample: [{ file: 'a.ts', lang: 'ts', code: 'a', added: [1, markup] }] }, /added/);
  });
});
