import { type Db, now } from './db.ts';
import { reject } from './errors.ts';
import type { FeatureRow, FeatureSummary, StartFeatureInput } from './types.ts';
import { isOneOf, RED_BY, type RedBy } from './vocabulary.ts';

export function currentFeatureId(db: Db): number | null {
  return Number(db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'current'")?.value ?? 0) || null;
}

export function featureById(db: Db, id: number): FeatureRow | null {
  return db.get<FeatureRow>('SELECT * FROM features WHERE id = ?', id) ?? null;
}

export function currentFeature(db: Db): FeatureRow | null {
  const id = currentFeatureId(db);
  return id ? featureById(db, id) : null;
}

export function listFeatures(db: Db): FeatureSummary[] {
  const current = currentFeatureId(db);
  return db.all<Omit<FeatureSummary, 'current'>>('SELECT id, name, stage FROM features ORDER BY id').map(f => ({ ...f, current: f.id === current }));
}

export function makeCurrent(db: Db, id: number) {
  db.run("INSERT INTO meta(key, value) VALUES ('current', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", String(id));
}

// 跟著 repo（存在 maester.db），不跟著功能；沒設過就是 ai
export const redBy = (db: Db): RedBy => db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'red_by'")?.value === 'user' ? 'user' : 'ai';

export function setRedBy(db: Db, value: unknown) {
  if (!isOneOf(RED_BY, value)) reject(`紅燈測試只能由 ${RED_BY.join('、')} 寫`);
  db.run("INSERT INTO meta(key, value) VALUES ('red_by', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", value);
  return { redBy: value };
}

export function touchFeature(db: Db, id: number) {
  db.run('UPDATE features SET updated_at = ? WHERE id = ?', now(), id);
}

export function writableFeature(db: Db, expectedId?: number | string | null): FeatureRow {
  const feature = currentFeature(db) ?? reject('還沒有功能，先執行 maester start');
  if (expectedId != null && Number(expectedId) !== feature.id) reject(`功能 ${expectedId} 不是目前功能（${feature.id} ${feature.name}）`);
  if (feature.stage === 'done') reject(`「${feature.name}」已完成，只能查看`);
  return feature;
}

export function startFeature(db: Db, { name, scale = null }: StartFeatureInput = {}) {
  if (!name) reject('需要功能名稱');
  return db.transaction(() => {
    const createdAt = now();
    const id = db.insert("INSERT INTO features(name, stage, scale, rt_state, created_at, updated_at) VALUES (?, 'roundtable', ?, 'DISCOVER', ?, ?)", name, scale, createdAt, createdAt);
    makeCurrent(db, id);
    return { feature: id };
  });
}

export function switchFeature(db: Db, id: string) {
  return db.transaction(() => {
    const feature = featureById(db, Number(id)) ?? reject(`沒有功能 ${id}`);
    if (feature.stage === 'done') reject(`「${feature.name}」已完成，只能在網頁查看`);
    makeCurrent(db, feature.id);
    return { feature: feature.id };
  });
}
