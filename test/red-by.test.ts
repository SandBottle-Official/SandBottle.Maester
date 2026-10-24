import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Fixtures } from './support/fixtures.ts';
import { scenario, submit } from './support/scenario.ts';

function setRedBy(S: ReturnType<typeof scenario>, value: unknown) {
  const db = S.db();
  try { return db.setRedBy(value); } finally { db.close(); }
}

describe('紅燈測試由誰寫', () => {
  test('沒設過_AI寫紅燈', () => {
    const S = scenario();
    S.inTdd();
    assert.equal(S.view().redBy, 'ai');
    assert.equal(S.ok(['progress']), `${Fixtures.客戶訂閱} · Task 00 · 1／2 · 🔴 紅：AI 寫測試`);
  });

  test('切成使用者寫_畫面進度與show都看得到', () => {
    const S = scenario();
    S.inTdd();
    setRedBy(S, 'user');
    assert.equal(S.view().redBy, 'user');
    assert.equal(S.ok(['progress']), `${Fixtures.客戶訂閱} · Task 00 · 1／2 · 🔴 紅：等使用者寫測試`);
    assert.match(S.ok(['show']), /紅燈測試：使用者自己寫/);
  });

  test('設定跟著repo_換功能也還在', () => {
    const S = scenario();
    S.inTdd();
    setRedBy(S, 'user');
    S.start(Fixtures.門市權限);
    assert.equal(S.view().redBy, 'user');
  });

  test('不認得的值_拒絕', () => {
    const S = scenario();
    S.inTdd();
    assert.throws(() => setRedBy(S, 'codex'), /只能由 ai、user 寫/);
  });

  test('紅燈時按測試寫好了_存成待處理事件', () => {
    const S = scenario();
    S.inTdd();
    setRedBy(S, 'user');
    submit(S, 'red_written');
    assert.deepEqual(S.view().pending.map((e: any) => [e.type, e.ctx.phase]), [['red_written', 'red']]);
  });
});
