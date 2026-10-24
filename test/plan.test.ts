import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Fixtures } from './support/fixtures.ts';
import { scenario } from './support/scenario.ts';

describe('開始 TDD 與寫入計畫', () => {
  test('R13 圓桌階段且計畫有測試時開始TDD_目前步驟是第一個測試紅燈', () => {
    const S = scenario();
    S.inTdd();
    const t = S.view().state.tdd;
    assert.deepEqual([t.task, t.test, t.phase], ['00', 1, 'red']);
    assert.equal(S.view().state.stage, 'tdd');
  });

  test('R14 計畫沒有測試時開始TDD_拒絕', () => {
    const S = scenario();
    S.start();
    S.rejected(['tdd'], undefined, /還沒有測試/);
  });

  test('R14a 已在TDD再開始_拒絕', () => {
    const S = scenario();
    S.inTdd();
    S.rejected(['tdd'], undefined, /已經在 TDD/);
  });

  test('R15 目前步驟以前的測試改名移除插入或重排_拒絕並列出', () => {
    const S = scenario();
    const { feature, tests } = S.inTdd();
    S.finish(tests[0].id);
    const before = S.snapshot();
    const renamed = S.planInput(feature, Fixtures.計畫, tests);
    renamed.tasks[0].tests[0].name = 'ConfigureServices改名';
    S.rejected(['plan'], renamed, /ConfigureServices/);
    const inserted = S.planInput(feature, Fixtures.計畫, tests);
    inserted.tasks[0].tests.unshift({ name: '插在最前面' });
    S.rejected(['plan'], inserted, /不能變動/);
    const removed = S.planInput(feature, Fixtures.計畫, tests);
    removed.tasks[0].tests.shift();
    S.rejected(['plan'], removed, /不能變動/);
    assert.equal(S.snapshot(), before);
  });

  test('R16 重複id或不屬於本功能的id_拒絕', () => {
    const S = scenario();
    const { feature, tests } = S.inTdd();
    const duplicated = S.planInput(feature, Fixtures.計畫, tests);
    duplicated.tasks[1].tests[2].id = tests[3].id;
    S.rejected(['plan'], duplicated, /重複/);
    const other = S.start(Fixtures.門市權限);
    S.rejected(['plan'], { feature: other, tasks: [{ code: '00', title: 'x', tests: [{ id: tests[4].id, name: 'R12_已有正式訂閱_拒絕' }] }] }, /不屬於/);
  });

  test('R17 只改目前步驟之後_整份替換且新測試由DB給id', () => {
    const S = scenario();
    const { feature, tests } = S.inTdd();
    S.toPhase(tests[0].id, 'green');
    const input = S.planInput(feature, Fixtures.計畫, tests);
    input.tasks[1].title = 'GrantPromotional（改標題）';
    input.tasks[1].tests.push({ name: 'R12_天數小於等於0_拒絕' });
    input.tasks[1].tests.splice(1, 1);
    const out = S.ok(['plan'], input).tests;
    assert.equal(out.length, 5);
    assert.equal(typeof out.at(-1).id, 'number');
    const v = S.view();
    assert.equal(v.plan.tasks[1].title, 'GrantPromotional（改標題）');
    assert.equal(v.state.tdd.testId, tests[0].id);
    assert.equal(v.state.tdd.phase, 'green');
  });
});
