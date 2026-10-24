import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { scenario } from './support/scenario.ts';
import { showText } from './support/system.ts';

describe('圓桌紀錄', () => {
  test('R7 新增圓桌文件_依序號附加且舊文件不變', () => {
    const S = scenario();
    S.start();
    S.ok(['doc'], { kind: 'decisionTable', conditions: ['門市狀態'], rules: [{ id: 'R1', values: ['停用'], action: '拒絕', gwt: { given: '台北店已停用', when: '指派店長', then: '拒絕' } }] });
    S.ok(['doc'], { kind: 'decisionTable', conditions: ['門市狀態'], rules: [{ id: 'R1', values: ['營業中'], action: '允許' }] });
    S.ok(['doc'], { kind: 'codex', n: 1, points: [{ text: '重複指派', why: '沒處理 duplicate', responses: [{ who: 'Fowler', verdict: 'accept' }] }] });
    const docs = S.view().roundtable;
    assert.deepEqual(docs.map((d: any) => d.file), ['01-decisionTable', '02-decisionTable', '03-codex']);
    assert.deepEqual(docs[0].rules[0], { id: 'R1', values: ['停用'], action: '拒絕', gwt: { given: '台北店已停用', when: '指派店長', then: '拒絕' } });
    assert.deepEqual(docs[2].points[0].responses, [{ who: 'Fowler', verdict: 'accept' }]);
  });

  test('R8 換圓桌階段_更新階段與說明', () => {
    const S = scenario();
    S.start();
    S.ok(['stage'], { state: 'CODEX_REVIEW', note: 'Codex 審查中', scale: '標準' });
    const rt = S.view().state.roundtable;
    assert.deepEqual([rt.state, rt.note, rt.scale], ['CODEX_REVIEW', 'Codex 審查中', '標準']);
  });

  test('R9 不在清單的階段_拒絕', () => {
    const S = scenario();
    S.start();
    S.rejected(['stage'], { state: 'REVIEWING' });
  });

  test('R10 出題_答案為空', () => {
    const S = scenario();
    S.start();
    S.ok(['ask'], { code: 'd17', question: '切回已完成的功能？', options: [{ label: '拒絕', by: 'Evans' }] });
    assert.deepEqual(S.view().state.roundtable.decisions, [{ id: 'd17', question: '切回已完成的功能？', options: [{ label: '拒絕', by: 'Evans' }], freeText: true, answer: null }]);
  });

  test('R11 回答決策_已有答案時以最新為準', () => {
    const S = scenario();
    S.start();
    S.ok(['ask'], { code: 'd17', question: '切回已完成的功能？' });
    S.ok(['answer'], { code: 'd17', value: 'A' });
    S.ok(['answer'], { code: 'd17', value: 'B' });
    assert.equal(S.view().state.roundtable.decisions[0].answer, 'B');
    S.rejected(['answer'], { code: 'd99', value: 'A' }, /沒有決策題/);
  });

  test('R12 寫入最終設計_show看得到', () => {
    const S = scenario();
    S.start();
    S.ok(['design'], { summary: '全關聯 SQLite', decisions: [{ topic: '權威來源', decision: 'repo 內的 DB', reason: 'd1' }], rejected: ['事件紀錄'], risks: ['git clean 會遺失'], followups: [] });
    const text = showText(S.repo);
    assert.match(text, /全關聯 SQLite/);
    assert.match(text, /git clean 會遺失/);
  });
});
