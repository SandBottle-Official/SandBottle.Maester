import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Fixtures } from './support/fixtures.ts';
import { scenario } from './support/scenario.ts';
import { openStore } from './support/system.ts';

function importTwoStepFeature(repo: string, finishedStep: { done: true; sha?: string }) {
  const db = openStore(repo, { write: true })!;
  db.importFeature({ name: Fixtures.客戶訂閱, stage: 'tdd', docs: [], decisions: [], tasks: [{ code: '00', title: 't', tests: [{ name: '舊的', step: finishedStep }, { name: '新的', step: { phase: 'red' } }] }] });
  db.close();
}

describe('網頁顯示', () => {
  test('R35 明確綁定_view帶git的標題GreenBy與檔案行數', () => {
    const S = scenario();
    const { tests } = S.inTdd();
    S.finish(tests[0].id, 'test: ConfigureServices\n\nGreen-By: user');
    const c = S.view().history['00-01'].commit;
    assert.deepEqual([c.subject, c.greenBy, c.missing], ['test: ConfigureServices', 'user', undefined]);
    assert.deepEqual(c.files.map((f: any) => f.file), ['src/main/A.java']);
  });

  test('R36 sha不在git_view標commit已不存在且保留步驟內容', () => {
    const S = scenario();
    const { tests } = S.inTdd();
    S.ok(['phase'], { test: tests[0].id, phase: 'red', story: '組情境' });
    S.finish(tests[0].id);
    S.g('reset', '-q', '--hard', 'HEAD~1');
    S.g('reflog', 'expire', '--expire=now', '--all');
    S.g('gc', '-q', '--prune=now');
    const h = S.view().history['00-01'];
    assert.equal(h.commit.missing, true);
    assert.equal(h.story, '組情境');
  });

  test('R37 推測綁定_view標推測', () => {
    const S = scenario();
    importTwoStepFeature(S.repo, { done: true, sha: S.g('rev-parse', 'HEAD') });
    assert.equal(S.view().history['00-01'].commit.inferred, true);
  });

  test('R38 遷移來沒有快照_view標沒有步驟內容', () => {
    const S = scenario();
    importTwoStepFeature(S.repo, { done: true });
    const h = S.view().history['00-01'];
    assert.equal(h.empty, true);
    assert.equal(h.commit, null);
  });

  test('非目前功能的view標唯讀並列出所有功能', () => {
    const S = scenario();
    const first = S.start();
    S.start(Fixtures.門市權限);
    const v = S.view(first);
    assert.equal(v.readonly, true);
    assert.deepEqual(v.features.map((f: any) => [f.name, f.current]), [[Fixtures.客戶訂閱, false], [Fixtures.門市權限, true]]);
  });

  test('counts_ai_and_legacy_claude_greens_as_ai', () => {
    const S = scenario();
    const { tests } = S.inTdd();
    ['user', 'ai', 'claude'].forEach((author, i) => S.finish(tests[i].id, `test: ${i}\n\nGreen-By: ${author}`));
    const v = S.view();
    assert.deepEqual(v.greens, { user: 1, total: 3 });
    assert.deepEqual(['00-01', '00-02', '01-01'].map(key => v.history[key].commit.greenBy), ['user', 'ai', 'ai']);
  });
});
