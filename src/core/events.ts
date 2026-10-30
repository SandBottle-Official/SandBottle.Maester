import { type Db, flag, now } from './db.ts';
import { reject } from './errors.ts';
import { currentFeature } from './features.ts';
import { recordAnswer } from './roundtable.ts';
import { currentStep } from './tdd.ts';
import type { Answer, EventInput, EventOut, EventRow, FeatureRow, StepRow } from './types.ts';
import { EVENT_TYPES, isOneOf, MAX_PROMPT_LENGTH, TEST_SCOPES } from './vocabulary.ts';

// 不綁在某一步的事件：網頁訊息、從網頁新建或接續會議
const CONTEXT_FREE = new Set<string>(['prompt', 'start_council', 'resume']);

const newEventId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

function promptText(payload: EventInput['payload']): string {
  const text = String(payload?.text ?? '').trim();
  if (!text) reject('訊息是空的');
  if (text.length > MAX_PROMPT_LENGTH) reject(`訊息超過 ${MAX_PROMPT_LENGTH} 字`);
  return text;
}

function rejectStaleContext(feature: FeatureRow, step: StepRow | null, ctx: NonNullable<EventInput['ctx']>) {
  const stale = ctx.stage !== feature.stage
    || (feature.stage === 'tdd' && (Number(ctx.test) !== step?.test_id || ctx.phase !== step?.phase));
  if (stale) reject('畫面已經過期，重新整理');
}

export function submitEvent(db: Db, { type, payload, feature: featureId, ctx = {} }: EventInput = {}) {
  if (!isOneOf(EVENT_TYPES, type)) reject(`不認得的事件：${type}`);
  return db.transaction(() => {
    const feature = currentFeature(db);
    if (!feature || Number(featureId) !== feature.id) reject('這不是目前功能，只能查看');
    if (feature.stage === 'done') reject(`「${feature.name}」已完成，只能查看`);
    const step = currentStep(db, feature.id);
    const text = type === 'prompt' || type === 'start_council' ? promptText(payload) : null;
    const scope = payload?.scope ?? null;
    if (scope !== null && !isOneOf(TEST_SCOPES, scope)) reject(`測試範圍只能是 ${TEST_SCOPES.join('、')}`);
    if (!CONTEXT_FREE.has(type)) rejectStaleContext(feature, step, ctx);

    const id = newEventId();
    db.run("INSERT INTO events(id, feature_id, ts, type, status, ctx_stage, ctx_test_id, ctx_phase, text, scope) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)",
      id, feature.id, now(), type, feature.stage, step?.test_id ?? null, step?.phase ?? null, text, scope);
    const answers = type === 'answer' ? payload?.answers ?? [] : [];
    answers.forEach((a, i) => {
      recordAnswer(db, feature.id, a.decision, a.value);
      db.run('INSERT INTO event_answers(event_id, ord, decision, value, free) VALUES (?, ?, ?, ?, ?)', id, i, a.decision, a.value, flag(!!a.free));
    });
    return { id };
  });
}

function toEventOut(db: Db, event: EventRow): EventOut {
  const answers = () => db.all<{ decision: string; value: string; free: number }>('SELECT decision, value, free FROM event_answers WHERE event_id = ? ORDER BY ord', event.id)
    .map((a): Answer => ({ decision: a.decision, value: a.value, ...(a.free ? { free: true } : {}) }));
  const payload = event.type === 'answer' ? { answers: answers() } : event.type === 'prompt' || event.type === 'start_council' ? { text: event.text }
    : event.scope ? { scope: event.scope } : null;
  return { id: event.id, ts: event.ts, type: event.type, status: event.status, feature: event.feature_id, payload,
    ctx: { stage: event.ctx_stage, test: event.ctx_test_id, phase: event.ctx_phase } };
}

export function claimNextEvent(db: Db): EventOut | null {
  const feature = currentFeature(db);
  if (!feature) return null;
  const event = db.get<EventRow>(`UPDATE events SET status = 'processing' WHERE id = (
    SELECT id FROM events WHERE feature_id = ? AND status = 'pending' ORDER BY ts, rowid LIMIT 1) RETURNING *`, feature.id);
  return event ? toEventOut(db, event) : null;
}

export function requeueProcessing(db: Db) {
  const feature = currentFeature(db);
  if (!feature) return { requeued: 0 };
  return { requeued: Number(db.run("UPDATE events SET status = 'pending' WHERE feature_id = ? AND status = 'processing'", feature.id).changes) };
}

export function markEventDone(db: Db, id: string) {
  return db.transaction(() => {
    const event = db.get<{ status: EventRow['status'] }>('SELECT status FROM events WHERE id = ?', String(id)) ?? reject(`沒有事件 ${id}`);
    if (event.status === 'pending') reject(`事件 ${id} 還沒被領取`);
    if (event.status === 'processing') db.run("UPDATE events SET status = 'done' WHERE id = ?", String(id));
    return { id, status: 'done' };
  });
}

export function readEvents(db: Db, featureId: number, status: EventRow['status']): EventOut[] {
  return db.all<EventRow>('SELECT * FROM events WHERE feature_id = ? AND status = ? ORDER BY ts, rowid', featureId, status).map(e => toEventOut(db, e));
}
