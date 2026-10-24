import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { nextAgent, nextLimits, pickAgent, statuslineFromTranscript, withLimits } from '../src/server/agent.ts';

describe('agent 資訊', () => {
  test('statusline JSON_只留頁面要的欄位', () => {
    const raw = { session_id: 's', model: { display_name: 'Opus' }, context_window: { used_percentage: 42.5, context_window_size: 200000, current_usage: {} },
      cost: { total_cost_usd: 1.2 }, rate_limits: { five_hour: { used_percentage: 12, resets_at: 1700000000 }, seven_day: { used_percentage: 30 } } };
    assert.deepEqual(pickAgent(raw, 5), { model: 'Opus', context: 42.5, contextSize: 200000, contextTokens: null, cost: 1.2, fiveHour: { used: 12, resetsAt: 1700000000 }, sevenDay: { used: 30, resetsAt: null }, source: 'statusline', at: 5 });
  });

  test('缺欄位或型別不對_變成 null', () => {
    assert.deepEqual(pickAgent({ model: { display_name: 3 }, context_window: { used_percentage: '9' }, rate_limits: null }, 1),
      { model: null, context: null, contextSize: null, contextTokens: null, cost: null, fiveHour: null, sevenDay: null, source: 'statusline', at: 1 });
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

  test('hook 送來的_標成 hook', () => assert.equal(pickAgent({ source: 'hook' }, 1).source, 'hook'));

  test('沒有回應_null', () => assert.equal(statuslineFromTranscript('{"type":"user"}\n'), null));
});

describe('statusline 與 hook 都在回報時', () => {
  const statusline = pickAgent({ context_window: { used_percentage: 40 } }, 0);
  const hook = (at: number) => pickAgent({ source: 'hook' }, at);

  test('statusline 剛回報過_忽略 hook，避免蓋掉比較完整的資料', () => assert.equal(nextAgent(statusline, hook(60_000)), statusline));

  test('statusline 很久沒回報或從來沒有_用 hook（SDK 模式沒有 statusline）', () => {
    assert.equal(nextAgent(statusline, hook(10 * 60_000)).source, 'hook');
    assert.equal(nextAgent(undefined, hook(1)).source, 'hook');
  });

  test('statusline 一律採用', () => assert.equal(nextAgent(hook(0), statusline), statusline));
});

describe('沒有 statusline 的 session 借用帳號的 5h／週用量', () => {
  const HOUR = 3600;
  const fromStatusline = (at: number, fiveHourResetsAt = 10 * HOUR) =>
    pickAgent({ rate_limits: { five_hour: { used_percentage: 29, resets_at: fiveHourResetsAt }, seven_day: { used_percentage: 11, resets_at: 100 * HOUR } } }, at);
  const sdk = pickAgent({ source: 'hook', model: { display_name: 'opus' } }, 1000);

  test('任何 session 的 statusline 都更新帳號用量_hook 或沒有用量的不更新', () => {
    const limits = nextLimits(undefined, fromStatusline(5));
    assert.deepEqual(limits, { fiveHour: { used: 29, resetsAt: 10 * HOUR }, sevenDay: { used: 11, resetsAt: 100 * HOUR }, at: 5 });
    assert.equal(nextLimits(limits, sdk), limits);
    assert.equal(nextLimits(limits, pickAgent({}, 9)), limits);
  });

  test('沒有用量的 agent_補上帳號用量並標出取得時間', () => {
    const a = withLimits(sdk, nextLimits(undefined, fromStatusline(5)), 0)!;
    assert.deepEqual([a.model, a.fiveHour?.used, a.sevenDay?.used, a.limitsAt], ['opus', 29, 11, 5]);
  });

  test('已經重置的視窗不借_自己有用量的不動', () => {
    const limits = nextLimits(undefined, fromStatusline(5, 1));
    const a = withLimits(sdk, limits, 2 * HOUR * 1000)!;
    assert.deepEqual([a.fiveHour, a.sevenDay?.used], [null, 11]);
    const own = fromStatusline(7);
    assert.equal(withLimits(own, limits, 0), own);
  });

  test('沒有 agent 或沒有帳號用量_原樣', () => {
    assert.equal(withLimits(undefined, nextLimits(undefined, fromStatusline(5)), 0), null);
    assert.equal(withLimits(sdk, undefined, 0), sdk);
  });
});
