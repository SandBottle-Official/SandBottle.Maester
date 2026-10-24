import { type Db, now } from './db.ts';
import { makeCurrent } from './features.ts';
import { insertDecision, insertDoc } from './roundtable.ts';
import type { ImportedStep, ImportFeatureInput } from './types.ts';

function insertImportedStep(db: Db, featureId: number, testId: number, step: ImportedStep, importedAt: string) {
  const c = step.content ?? {};
  db.run(`INSERT INTO steps(feature_id, test_id, phase, title, story, layer, rule_ref, test_file, test_lang, test_code, failure,
    green_file, green_lang, green_code, green_added, refactor, hint, completed_at, commit_sha, binding, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    featureId, testId, step.phase ?? c.phase ?? null, c.title ?? null, c.story ?? null, c.layer ?? null, c.ruleRef ?? null,
    c.testCode?.file ?? null, c.testCode?.lang ?? null, c.testCode?.code ?? null, c.failure ?? null,
    c.greenExample?.file ?? null, c.greenExample?.lang ?? null, c.greenExample?.code ?? null, c.greenExample?.added?.join(',') ?? null,
    c.refactor ?? null, c.hint ?? null, step.done ? importedAt : null, step.sha ?? null, step.sha ? 'inferred' : null, importedAt);
}

export function importFeature(db: Db, data: ImportFeatureInput) {
  return db.transaction(() => {
    const importedAt = now();
    const id = db.insert('INSERT INTO features(name, stage, scale, rt_state, rt_note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      data.name, data.stage, data.scale ?? null, data.rtState ?? null, data.rtNote ?? null, importedAt, importedAt);
    makeCurrent(db, id);
    for (const doc of data.docs) insertDoc(db, id, doc);
    for (const decision of data.decisions) insertDecision(db, id, decision);
    data.tasks.forEach((task, i) => {
      const taskId = db.insert('INSERT INTO tasks(feature_id, code, title, layer, ord) VALUES (?, ?, ?, ?, ?)', id, task.code, task.title, task.layer ?? null, i);
      task.tests.forEach((test, j) => {
        const testId = db.insert('INSERT INTO tests(feature_id, task_id, name, rule, layer, ord) VALUES (?, ?, ?, ?, ?, ?)', id, taskId, test.name, test.rule ?? null, test.layer ?? null, j);
        if (test.step) insertImportedStep(db, id, testId, test.step, importedAt);
      });
    });
    return { feature: id };
  });
}
