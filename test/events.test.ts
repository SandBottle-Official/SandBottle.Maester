import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { describe, test } from 'node:test';
import { Fixtures } from './support/fixtures.ts';
import { contextOf, scenario, submit } from './support/scenario.ts';
import { CLI, openEventsReminder } from './support/system.ts';

function waitForEvent(repo: string): Promise<any> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [CLI, 'wait'], { cwd: repo });
    let out = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.on('close', () => resolve(JSON.parse(out)));
  });
}

describe('事件', () => {
  test('R27 情境相符的事件_存成待處理並帶功能id', () => {
    const S = scenario();
    S.inTdd();
    submit(S, 'hint');
    const v = S.view();
    assert.deepEqual(v.pending.map((e: any) => [e.type, e.feature]), [['hint', v.featureId]]);
  });

  test('給AI的訊息_畫面過期也收下並帶文字', () => {
    const S = scenario();
    const { tests } = S.inTdd();
    const stale = S.view();
    S.toPhase(tests[0].id, 'green');
    const db = S.db();
    try { db.submit({ type: 'prompt', payload: { text: '  綠燈範例換個寫法  ' }, feature: stale.featureId, ctx: contextOf(stale) }); }
    finally { db.close(); }
    const again = S.db();
    try { assert.deepEqual(again.claim().payload, { text: '綠燈範例換個寫法' }); }
    finally { again.close(); }
  });

  test('空白訊息_拒絕', () => {
    const S = scenario();
    S.inTdd();
    assert.throws(() => submit(S, 'prompt', { text: '   ' }), /訊息是空的/);
  });

  test('R28 非目前或已完成功能的事件_拒絕', () => {
    const S = scenario();
    const { feature } = S.inTdd();
    const old = S.view();
    S.start(Fixtures.門市權限);
    const db = S.db();
    try { assert.throws(() => db.submit({ type: 'hint', feature, ctx: contextOf(old) }), /不是目前功能/); }
    finally { db.close(); }
  });

  test('R28a 情境不符的事件_拒絕', () => {
    const S = scenario();
    const { tests } = S.inTdd();
    const stale = S.view();
    S.toPhase(tests[0].id, 'green');
    const db = S.db();
    try { assert.throws(() => db.submit({ type: 'tests_ran', feature: stale.featureId, ctx: contextOf(stale) }), /過期/); }
    finally { db.close(); }
  });

  test('R29 兩個wait同時領取_各拿一筆不重複', async () => {
    const S = scenario();
    S.inTdd();
    submit(S, 'hint');
    submit(S, 'next_round');
    const got = await Promise.all([waitForEvent(S.repo), waitForEvent(S.repo)]);
    assert.deepEqual(got.map(e => e.type).sort(), ['hint', 'next_round']);
    assert.deepEqual(S.view().processing.length, 2);
  });

  test('R29a 情境已經過的事件_照樣交給AI', () => {
    const S = scenario();
    const { tests } = S.inTdd();
    S.toPhase(tests[0].id, 'green', 'refactor');
    submit(S, 'next_round');
    S.ok(['complete', String(tests[0].id), S.commit('test: ConfigureServices')]);
    const e = S.ok(['wait']);
    assert.deepEqual([e.type, e.ctx.test, e.ctx.phase], ['next_round', tests[0].id, 'refactor']);
  });

  test('R30 只領目前功能的事件', () => {
    const S = scenario();
    S.inTdd();
    submit(S, 'hint');
    S.start(Fixtures.門市權限);
    const db = S.db();
    try { assert.equal(db.claim(), null); }
    finally { db.close(); }
  });

  test('R31～R33 done處理中變完成_已完成不做事_待處理或不存在拒絕', () => {
    const S = scenario();
    S.inTdd();
    const first = submit(S, 'hint').id, second = submit(S, 'help_green').id;
    S.ok(['wait']);
    S.ok(['done', first]);
    S.ok(['done', first]);
    S.rejected(['done', second], undefined, /還沒被領取/);
    S.rejected(['done', 'nope'], undefined, /沒有事件/);
    assert.deepEqual(S.view().pending.map((e: any) => e.id), [second]);
    assert.equal(S.view().processing.length, 0);
  });

  test('有未完成事件_session開始時提醒AI接手', () => {
    const S = scenario();
    S.inTdd();
    assert.equal(openEventsReminder(S.repo), '');
    const id = submit(S, 'tests_ran').id;
    S.ok(['wait']);
    const reminder = openEventsReminder(S.repo);
    assert.match(reminder, /maester\.mjs" wait/);
    assert.match(reminder, new RegExp(`${id} tests_ran（處理中）`));
  });

  test('R34 處理中的事件_view標未完成', () => {
    const S = scenario();
    S.inTdd();
    submit(S, 'next_round');
    S.ok(['wait']);
    assert.deepEqual(S.view().processing.map((e: any) => e.type), ['next_round']);
  });

  test('網頁的裁決一次送出_直接記下答案並交給AI', () => {
    const S = scenario();
    S.start();
    S.ok(['ask'], { code: 'd1', question: 'A 還是 B？' });
    S.ok(['ask'], { code: 'd2', question: '放哪裡？' });
    const answers = [{ decision: 'd1', value: 'A' }, { decision: 'd2', value: '跟著專案', free: true }];
    submit(S, 'answer', { answers });
    assert.deepEqual(S.view().state.roundtable.decisions.map((d: any) => d.answer), ['A', '跟著專案']);
    assert.deepEqual(S.ok(['wait']).payload, { answers });
  });
});

describe('跑測試的範圍', () => {
  test('跑測試帶範圍_AI領到時看得到', () => {
    const S = scenario();
    const { tests } = S.inTdd();
    S.toPhase(tests[0].id, 'green');
    submit(S, 'tests_ran', { scope: 'task' });
    assert.deepEqual(S.view().pending.map((e: any) => e.payload), [{ scope: 'task' }]);
  });

  test('不認得的範圍_拒絕', () => {
    const S = scenario();
    const { tests } = S.inTdd();
    S.toPhase(tests[0].id, 'green');
    assert.throws(() => submit(S, 'tests_ran', { scope: 'some' }), /測試範圍只能是/);
  });

  test('TDD中途問的題目_網頁拿得到也能回答', () => {
    const S = scenario();
    const { tests } = S.inTdd();
    S.toPhase(tests[0].id, 'green');
    S.ok(['ask'], { code: 'm1', question: '測試名稱要不要帶規則編號？', options: [{ label: '帶', by: 'Uncle Bob' }, { label: '不帶', by: 'Evans' }] });
    assert.deepEqual(S.view().state.roundtable.decisions.map((d: any) => [d.id, d.answer]), [['m1', null]]);
    submit(S, 'answer', { answers: [{ decision: 'm1', value: '不帶' }] });
    assert.equal(S.view().state.roundtable.decisions[0].answer, '不帶');
  });
});
