import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { Fixtures } from './support/fixtures.ts';
import { scenario, type Scenario } from './support/scenario.ts';
import { COMMAND, DATA_DIR, DB_FILE } from './support/system.ts';

function finishedSingleTestFeature(S: Scenario) {
  const feature = S.start();
  S.plan(feature, [{ title: '唯一', tests: ['只有一個'] }]);
  S.ok(['tdd']);
  S.finish(S.view().state.tdd.testId);
  return feature;
}

describe('功能生命週期', () => {
  test('R1 沒有任何功能時開始功能_成為目前功能且在圓桌DISCOVER', () => {
    const S = scenario();
    S.start();
    const v = S.view();
    assert.equal(v.state.feature, Fixtures.客戶訂閱);
    assert.equal(v.state.stage, 'roundtable');
    assert.equal(v.state.roundtable.state, 'DISCOVER');
  });

  test('R2 目前功能未完成時開始新功能_舊功能停在原步驟', () => {
    const S = scenario();
    const { feature, tests } = S.inTdd();
    S.toPhase(tests[0].id, 'green');
    S.start(Fixtures.門市權限);
    assert.equal(S.view().state.feature, Fixtures.門市權限);
    const old = S.view(feature);
    assert.equal(old.readonly, true);
    assert.equal(old.state.tdd.phase, 'green');
  });

  test('R3 目前功能已完成時開始新功能_舊功能可查看', () => {
    const S = scenario();
    const feature = finishedSingleTestFeature(S);
    S.start(Fixtures.門市權限);
    const old = S.view(feature);
    assert.equal(old.state.done, true);
    assert.equal(old.readonly, true);
    assert.equal(Object.keys(old.history).length, 1);
  });

  test('R4 切回未完成的功能_從它記著的步驟繼續', () => {
    const S = scenario();
    const { feature, tests } = S.inTdd();
    S.toPhase(tests[0].id, 'green');
    S.start(Fixtures.門市權限);
    S.ok(['switch', String(feature)]);
    const v = S.view();
    assert.equal(v.state.feature, Fixtures.客戶訂閱);
    assert.equal(v.readonly, false);
    assert.equal(v.state.tdd.phase, 'green');
  });

  test('R5 切回已完成的功能_拒絕', () => {
    const S = scenario();
    const feature = finishedSingleTestFeature(S);
    S.start(Fixtures.門市權限);
    S.rejected(['switch', String(feature)], undefined, /已完成/);
  });

  test('R6 有舊json沒有DB時寫入_拒絕並提示遷移', () => {
    const S = scenario();
    S.w(`${DATA_DIR}/plan.json`, { schemaVersion: 1, tasks: [] });
    S.rejected(['start'], { name: Fixtures.門市權限 }, new RegExp(`${COMMAND} migrate`));
    assert.equal(fs.existsSync(path.join(S.repo, DATA_DIR, DB_FILE)), false);
  });

  test('R6a 對已完成功能寫入_拒絕', () => {
    const S = scenario();
    finishedSingleTestFeature(S);
    S.rejected(['ask'], { code: 'd1', question: '還要嗎？' }, /已完成/);
  });

  test('R6b 指定的測試不屬於目前功能_拒絕', () => {
    const S = scenario();
    const { tests } = S.inTdd();
    S.start(Fixtures.門市權限);
    S.rejected(['phase'], { test: tests[0].id, phase: 'green' }, /還沒開始 TDD|不是目前步驟/);
  });

  test('R6c DB版本比程式新_拒絕寫入', () => {
    const S = scenario();
    S.start();
    const db = S.db();
    db.connection.exec('PRAGMA user_version = 99');
    db.close();
    S.rejected(['stage'], { state: 'ROUND' }, /版本 99/);
  });
});
