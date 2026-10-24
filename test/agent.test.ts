import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { pickAgent, statuslineFromTranscript } from '../src/server/agent.ts';

describe('agent 資訊', () => {
  test('statusline JSON_只留頁面要的欄位', () => {
    const raw = { session_id: 's', model: { display_name: 'Opus' }, context_window: { used_percentage: 42.5, context_window_size: 200000, current_usage: {} },
      cost: { total_cost_usd: 1.2 }, rate_limits: { five_hour: { used_percentage: 12, resets_at: 1700000000 }, seven_day: { used_percentage: 30 } } };
    assert.deepEqual(pickAgent(raw, 5), { model: 'Opus', context: 42.5, contextSize: 200000, contextTokens: null, cost: 1.2, fiveHour: { used: 12, resetsAt: 1700000000 }, sevenDay: { used: 30, resetsAt: null }, at: 5 });
  });

  test('缺欄位或型別不對_變成 null', () => {
    assert.deepEqual(pickAgent({ model: { display_name: 3 }, context_window: { used_percentage: '9' }, rate_limits: null }, 1),
      { model: null, context: null, contextSize: null, contextTokens: null, cost: null, fiveHour: null, sevenDay: null, at: 1 });
    assert.equal(pickAgent(null, 1).model, null);
  });
});

describe('transcript 轉成 statusline 形狀', () => {
  test('取最後一則主對話回應_略過 subagent 與壞行', () => {
    const line = (o: object) => JSON.stringify(o);
    const jsonl = [
      '{"half":', // 截斷的第一行
      line({ type: 'assistant', message: { model: 'm1', usage: { input_tokens: 1, cache_read_input_tokens: 100, cache_creation_input_tokens: 10 } } }),
      line({ type: 'assistant', isSidechain: true, message: { model: 'sub', usage: { input_tokens: 9 } } }),
      line({ type: 'user', message: {} }),
    ].join('\n');
    const info = pickAgent(statuslineFromTranscript(jsonl), 1);
    assert.deepEqual([info.model, info.contextTokens, info.context], ['m1', 111, null]);
  });

  test('沒有回應_null', () => assert.equal(statuslineFromTranscript('{"type":"user"}\n'), null));
});
