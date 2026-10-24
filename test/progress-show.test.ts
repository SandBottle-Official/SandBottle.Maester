import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Fixtures } from './support/fixtures.ts';
import { scenario, submit } from './support/scenario.ts';

describe('進度與接手', () => {
  test('R39 TDD進行中_印功能TaskNN與Task內i／n與階段', () => {
    const S = scenario();
    const { tests } = S.inTdd();
    S.finish(tests[0].id);
    S.finish(tests[1].id);
    S.finish(tests[2].id);
    S.toPhase(tests[3].id, 'green', 'refactor');
    assert.equal(S.ok(['progress']), `${Fixtures.客戶訂閱} · Task 01 · 2／3 · 🔵 重構：等使用者決定`);
  });

  test('R40 圓桌中_印功能圓桌階段', () => {
    const S = scenario();
    S.start(Fixtures.門市權限);
    S.ok(['stage'], { state: 'OPEN_QUESTIONS' });
    assert.equal(S.ok(['progress']), `${Fixtures.門市權限} · 圓桌 · OPEN_QUESTIONS`);
  });

  test('R41 沒有功能或已完成_不印', () => {
    const S = scenario();
    assert.equal(S.run(['progress']).out, '');
  });

  test('R42 show_印最終設計Task完成狀態目前步驟圓桌與決策與事件', () => {
    const S = scenario();
    const { tests } = S.inTdd();
    S.finish(tests[0].id);
    S.toPhase(tests[1].id, 'green');
    submit(S, 'hint');
    const text = S.ok(['show']);
    assert.match(text, /- \[x\] ConfigureServices/);
    assert.match(text, /→ \[ \] Scenario（\d+） · 🟢 綠/);
    assert.match(text, /hint（待處理）/);
  });
});
