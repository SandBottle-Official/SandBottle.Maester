import { type Db, now } from './db.ts';
import { reject } from './errors.ts';
import { currentFeatureId } from './features.ts';
import type { AdaptationInput, AdaptationOut } from './types.ts';

// 跟著 repo 不跟著功能：使用者的寫法跟 Maester 不同時照使用者的，並留下歷史讓之後的 AI 讀懂他的思路
export function adapt(db: Db, { topic, stage = null, test = null, maester, user, why = null, council = null }: AdaptationInput = {}) {
  if (!topic || !maester || !user) reject('調整紀錄需要 topic、maester（原本的寫法）與 user（使用者的寫法）');
  if (council != null && !(Array.isArray(council) && council.every(c => c?.who && c?.text))) reject('council 要是 [{ who, text }]');
  const id = db.insert('INSERT INTO adaptations(topic, stage, feature_id, test_id, maester_way, user_way, why, council, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    topic, stage, currentFeatureId(db), test == null ? null : Number(test), maester, user, why, council && JSON.stringify(council), now());
  return { adaptation: id };
}

export function readAdaptations(db: Db): AdaptationOut[] {
  return db.all<AdaptationOut & { council: string | null }>(`SELECT id, topic, stage, feature_id feature, test_id test, maester_way maester, user_way user, why, council, created_at createdAt
    FROM adaptations ORDER BY id`).map(a => ({ ...a, council: a.council ? JSON.parse(a.council) : null }));
}
