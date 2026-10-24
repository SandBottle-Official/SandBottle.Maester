// Claude Code statusline 的 JSON 只挑頁面要顯示的欄位，留在 server 記憶體，不進 maester.db。
export type AgentWindow = { used: number; resetsAt: number | null };
export type AgentInfo = { model: string | null; context: number | null; contextSize: number | null; contextTokens: number | null; cost: number | null; fiveHour: AgentWindow | null; sevenDay: AgentWindow | null; source: 'statusline' | 'hook'; at: number; limitsAt?: number };
export type AccountLimits = { fiveHour: AgentWindow | null; sevenDay: AgentWindow | null; at: number };

const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null;
const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' ? v as Record<string, unknown> : {};

function window(v: unknown): AgentWindow | null {
  const used = num(obj(v).used_percentage);
  return used == null ? null : { used, resetsAt: num(obj(v).resets_at) };
}

// 這一輪送進模型的 token：沒有快取的、寫入快取的、讀快取的加起來
function usedTokens(usage: unknown): number | null {
  const u = obj(usage), parts = [u.input_tokens, u.cache_creation_input_tokens, u.cache_read_input_tokens].map(num);
  return parts.every(n => n == null) ? null : parts.reduce<number>((sum, n) => sum + (n ?? 0), 0);
}

export function pickAgent(raw: unknown, at = Date.now()): AgentInfo {
  const r = obj(raw), model = obj(r.model).display_name, ctx = obj(r.context_window), limits = obj(r.rate_limits);
  return {
    model: typeof model === 'string' ? model.slice(0, 80) : null,
    context: num(ctx.used_percentage), contextSize: num(ctx.context_window_size), contextTokens: usedTokens(ctx.current_usage),
    cost: num(obj(r.cost).total_cost_usd),
    fiveHour: window(limits.five_hour), sevenDay: window(limits.seven_day),
    source: r.source === 'hook' ? 'hook' : 'statusline',
    at,
  };
}

const STATUSLINE_FRESH_MS = 5 * 60_000;

// SDK／stream-json 模式不跑 statusline，只能靠 hook；statusline 剛回報過時它的資料比較完整，hook 不蓋掉
export function nextAgent(prev: AgentInfo | undefined, next: AgentInfo): AgentInfo {
  const statuslineFresh = prev?.source === 'statusline' && next.at - prev.at < STATUSLINE_FRESH_MS;
  return next.source === 'hook' && statuslineFresh ? prev : next;
}

// 5h／週用量是帳號層級的：記住任何 session 的 statusline 最新回報的那份
export function nextLimits(prev: AccountLimits | undefined, info: AgentInfo): AccountLimits | undefined {
  return info.source === 'statusline' && (info.fiveHour || info.sevenDay) ? { fiveHour: info.fiveHour, sevenDay: info.sevenDay, at: info.at } : prev;
}

// 沒有 statusline 的 session 借用帳號用量；已經重置的視窗不借，避免顯示過期的百分比
export function withLimits(agent: AgentInfo | undefined, limits: AccountLimits | undefined, now = Date.now()): AgentInfo | null {
  if (!agent || !limits || agent.fiveHour || agent.sevenDay) return agent ?? null;
  const live = (w: AgentWindow | null) => w && (w.resetsAt == null || w.resetsAt * 1000 > now) ? w : null;
  const fiveHour = live(limits.fiveHour), sevenDay = live(limits.sevenDay);
  return fiveHour || sevenDay ? { ...agent, fiveHour, sevenDay, limitsAt: limits.at } : agent;
}

// hook 只拿得到 transcript：找最後一則主對話（非 subagent）的回應，轉成 statusline 的形狀，好走同一條路
export function statuslineFromTranscript(jsonl: string): { model: { display_name: string }; context_window: { current_usage: unknown } } | null {
  const lines = jsonl.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry: Record<string, unknown>;
    try { entry = obj(JSON.parse(lines[i])); } catch { continue; }
    const message = obj(entry.message);
    if (entry.type !== 'assistant' || entry.isSidechain || !message.usage || message.model === '<synthetic>') continue;
    return { model: { display_name: String(message.model ?? '') }, context_window: { current_usage: message.usage } };
  }
  return null;
}
