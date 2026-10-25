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

  test('卡住的事_同一階段可清掉_換階段自動清掉', () => {
    const S = scenario();
    const { tests } = S.inTdd();
    const problem = { title: '回歸測試失敗', why: '舊的測試變紅', fix: '檢查 Fixtures', output: 'FAILED' };
    S.toPhase(tests[0].id, 'green');
    S.ok(['phase'], { test: tests[0].id, phase: 'green', problem });
    assert.deepEqual(S.view().state.tdd.problem, problem);
    S.ok(['phase'], { test: tests[0].id, phase: 'green', problem: null });
    assert.equal(S.view().state.tdd.problem, null);
    S.ok(['phase'], { test: tests[0].id, phase: 'green', problem });
    S.ok(['phase'], { test: tests[0].id, phase: 'refactor' });
    assert.equal(S.view().state.tdd.problem, null);
  });

  test('卡住的事沒有 title_拒絕', () => {
    const S = scenario();
    const { tests } = S.inTdd();
    S.rejected(['phase'], { test: tests[0].id, phase: 'red', problem: { why: 'x' } }, /title/);
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

  test('重構範例_單一或多個檔案都讀回成陣列', () => {
    const S = scenario();
    const { tests } = S.inTdd();
    S.toPhase(tests[0].id, 'green', 'refactor');
    assert.deepEqual(S.view().state.tdd.refactorFiles, []);
    const files = [{ file: 'a.ts', lang: 'ts', code: 'a' }, { file: 'a.test.ts', lang: 'ts', code: 'b', added: [1] }];
    S.ok(['phase'], { test: tests[0].id, phase: 'refactor', refactor: '產品碼：抽常數', refactorExample: files });
    assert.deepEqual(S.view().state.tdd.refactorFiles, files);
    S.ok(['phase'], { test: tests[0].id, phase: 'refactor', refactorExample: { file: 'c.ts', code: 'c' } });
    assert.deepEqual(S.view().state.tdd.refactorFiles, [{ file: 'c.ts', code: 'c' }]);
  });

  test('版本 1 的 DB_開啟時補上新欄位', () => {
    const S = scenario();
    S.inTdd();
    const db = S.db();
    db.connection.exec('ALTER TABLE steps DROP COLUMN lesson; ALTER TABLE steps DROP COLUMN test_files; ALTER TABLE steps DROP COLUMN green_files; ALTER TABLE events DROP COLUMN text; ALTER TABLE steps DROP COLUMN refactor_files; ALTER TABLE steps DROP COLUMN problem; PRAGMA user_version = 1;');
    db.close();
    const again = S.db();
    try {
      assert.equal(again.get('PRAGMA user_version').user_version, SCHEMA);
      const columns = again.all('PRAGMA table_info(steps)').map((c: any) => c.name);
      assert.deepEqual(['lesson', 'test_files', 'green_files', 'refactor_files', 'problem'].filter(n => columns.includes(n)).length, 5);
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

  test('只給檔名不給程式碼_從 repo 讀檔存成快照', () => {
    const S = scenario();
    const { tests } = S.inTdd();
    S.w('test/a.test.ts', 'expect(a).toBe(1)\n');
    S.w('src/a.ts', 'export const a = 1\n');
    S.ok(['phase'], { test: tests[0].id, phase: 'red', testCode: { file: 'test/a.test.ts' } });
    S.toPhase(tests[0].id, 'green');
    S.ok(['phase'], { test: tests[0].id, phase: 'green', greenExample: [{ file: 'src/a.ts', added: [1] }] });
    S.w('test/a.test.ts', '改過了\n');
    const t = S.view().state.tdd;
    assert.deepEqual(t.testCode, { file: 'test/a.test.ts', lang: 'ts', code: 'expect(a).toBe(1)\n' });
    assert.deepEqual(t.greenFiles, [{ file: 'src/a.ts', lang: 'ts', code: 'export const a = 1\n', added: [1] }]);
  });

  test('只給檔名加行號範圍_只存那幾行_added 用檔案行號', () => {
    const S = scenario();
    const { tests } = S.inTdd();
    S.w('test/a.test.ts', 'import\n\ntest 1\ntest 2\nend\n');
    S.ok(['phase'], { test: tests[0].id, phase: 'red', testCode: { file: 'test/a.test.ts', lines: [3, 4] } });
    S.toPhase(tests[0].id, 'green');
    S.ok(['phase'], { test: tests[0].id, phase: 'green', greenExample: [{ file: 'test/a.test.ts', lines: [3, 5], added: [4] }] });
    const t = S.view().state.tdd;
    assert.deepEqual(t.testCode, { file: 'test/a.test.ts', lang: 'ts', code: 'test 1\ntest 2' });
    assert.deepEqual(t.greenFiles, [{ file: 'test/a.test.ts', lang: 'ts', code: 'test 1\ntest 2\nend', added: [2] }]);
  });

  test('行號範圍不合理_拒絕', () => {
    const S = scenario();
    const { tests } = S.inTdd();
    S.w('test/a.test.ts', 'a\nb\n');
    for (const lines of [[2, 1], [0, 1], [1, 9], ['1', 2]])
      S.rejected(['phase'], { test: tests[0].id, phase: 'red', testCode: { file: 'test/a.test.ts', lines } }, /lines/);
  });

  test('只給檔名_檔案不在 repo 裡或不存在就拒絕', () => {
    const S = scenario();
    const { tests } = S.inTdd();
    S.rejected(['phase'], { test: tests[0].id, phase: 'red', testCode: { file: '../outside.ts' } }, /repo/);
    S.rejected(['phase'], { test: tests[0].id, phase: 'red', testCode: { file: 'missing.ts' } }, /missing\.ts/);
  });
});
