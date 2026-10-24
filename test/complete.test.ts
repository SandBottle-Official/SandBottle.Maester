import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { scenario } from './support/scenario.ts';
import { progressLine } from './support/system.ts';

describe('完成步驟與綁定', () => {
  test('R25 綠或重構完成非最後測試_明確綁定並前進到下一個紅燈', () => {
    const S = scenario();
    const { tests } = S.inTdd();
    const { sha } = S.finish(tests[0].id);
    const v = S.view();
    assert.deepEqual([v.state.tdd.task, v.state.tdd.test, v.state.tdd.phase], ['00', 2, 'red']);
    assert.equal(v.history['00-01'].commit.sha, sha);
    assert.equal(v.history['00-01'].commit.inferred, false);
    assert.equal(v.plan.tasks[0].tests[0].done, true);
  });

  test('R25 Task最後一個測試完成_前進到下一個Task第一個', () => {
    const S = scenario();
    const { tests } = S.inTdd();
    S.finish(tests[0].id);
    S.finish(tests[1].id);
    const t = S.view().state.tdd;
    assert.deepEqual([t.task, t.test, t.phase], ['01', 1, 'red']);
  });

  test('R26 最後一個測試完成_功能標成完成', () => {
    const S = scenario();
    const { tests } = S.inTdd();
    for (const t of tests) S.finish(t.id);
    const v = S.view();
    assert.equal(v.state.done, true);
    assert.equal(v.state.tdd, null);
    assert.equal(progressLine(S.repo), '');
  });

  test('R21 sha已明確綁過_不做事並回報綁在哪一步', () => {
    const S = scenario();
    const { tests } = S.inTdd();
    const { sha } = S.finish(tests[0].id);
    const before = S.snapshot();
    const again = S.ok(['complete', String(tests[0].id), sha]);
    assert.deepEqual([again.already, again.name], [true, 'ConfigureServices']);
    assert.equal(S.snapshot(), before);
  });

  test('R22 sha不是HEAD也不是祖先_拒絕', () => {
    const S = scenario();
    const { tests } = S.inTdd();
    S.toPhase(tests[0].id, 'green');
    S.g('checkout', '-qb', 'other');
    const sha = S.commit('別的分支');
    S.g('checkout', '-q', '-');
    S.rejected(['complete', String(tests[0].id), sha], undefined, /不是 HEAD/);
    S.rejected(['complete', String(tests[0].id), 'deadbee'], undefined, /不是 HEAD/);
  });

  test('R23 測試不是目前步驟_拒絕', () => {
    const S = scenario();
    const { tests } = S.inTdd();
    S.toPhase(tests[0].id, 'green');
    S.rejected(['complete', String(tests[1].id), S.commit('x')], undefined, /不是目前步驟/);
  });

  test('R24 紅燈階段完成_拒絕', () => {
    const S = scenario();
    const { tests } = S.inTdd();
    S.rejected(['complete', String(tests[0].id), S.commit('x')], undefined, /紅燈/);
  });

  test('rejects_sha_that_could_be_read_as_a_git_option', () => {
    const S = scenario();
    const { tests } = S.inTdd();
    S.toPhase(tests[0].id, 'green');
    S.rejected(['complete', String(tests[0].id), '--all'], undefined, /commit sha/);
  });
});
