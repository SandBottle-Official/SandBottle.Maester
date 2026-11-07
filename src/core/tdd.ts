import type { SQLInputValue } from 'node:sqlite';
import { type Db, now } from './db.ts';
import { reject } from './errors.ts';
import { touchFeature, writableFeature } from './features.ts';
import type { CodeFile, CompleteInput, FeatureRow, OrderedTest, PhaseInput, PlanInput, PlannedTaskOut, PlanTestInput, ShaInfo, StepRow, TaskRow, TestRow } from './types.ts';
import { NEXT_PHASE } from './vocabulary.ts';

export function orderedTests(db: Db, featureId: number): OrderedTest[] {
  return db.all<OrderedTest>(`SELECT t.id, t.name, t.rule, t.layer, k.code task, t.ord FROM tests t JOIN tasks k ON k.id = t.task_id
    WHERE t.feature_id = ? ORDER BY k.ord, t.ord`, featureId);
}

export function currentStep(db: Db, featureId: number): StepRow | null {
  return db.get<StepRow>('SELECT * FROM steps WHERE feature_id = ? AND completed_at IS NULL', featureId) ?? null;
}

function openRedStep(db: Db, featureId: number, testId: number) {
  db.run("INSERT INTO steps(feature_id, test_id, phase, updated_at) VALUES (?, ?, 'red', ?)", featureId, testId, now());
}

// Hard Gate：設計沒確定、裁決沒答完、沒有 Decision Table 與最終設計，就不能拆完 Task 進 TDD
function rejectUnfinishedCouncil(db: Db, feature: FeatureRow) {
  if (feature.rt_state !== 'TASK_BREAKDOWN') reject(`臨時動議還在 ${feature.rt_state}，要到 TASK_BREAKDOWN 才能開始 TDD`);
  if (!db.get("SELECT 1 FROM events WHERE feature_id = ? AND type = 'approve_design'", feature.id)) reject('使用者還沒確定設計（網頁按「設計確定」或 maester approve）');
  const open = db.all<{ code: string }>('SELECT code FROM decisions WHERE feature_id = ? AND answer IS NULL', feature.id).map(d => d.code);
  if (open.length) reject(`還有裁決沒回答：${open.join('、')}`);
  const has = (kind: string) => !!db.get('SELECT 1 FROM rt_docs WHERE feature_id = ? AND kind = ?', feature.id, kind);
  if (!has('decisionTable')) reject('還沒有 Decision Table（maester doc kind: decisionTable）');
  if (!has('design')) reject('還沒有最終設計（maester design）');
}

export function startTdd(db: Db) {
  return db.transaction(() => {
    const feature = writableFeature(db);
    if (feature.stage !== 'roundtable') reject('已經在 TDD 了');
    rejectUnfinishedCouncil(db, feature);
    const first = orderedTests(db, feature.id)[0] ?? reject('計畫還沒有測試，先寫入計畫');
    openRedStep(db, feature.id, first.id);
    db.run("UPDATE features SET stage = 'tdd' WHERE id = ?", feature.id);
    touchFeature(db, feature.id);
    return { test: first.id };
  });
}

type IncomingTest = PlanTestInput & { task?: string };

function rejectForeignOrDuplicateIds(db: Db, feature: FeatureRow, incomingIds: number[]) {
  const owned = new Set(db.all<{ id: number }>('SELECT id FROM tests WHERE feature_id = ?', feature.id).map(t => t.id));
  const duplicate = incomingIds.find((id, i) => incomingIds.indexOf(id) !== i);
  if (duplicate != null) reject(`測試 id ${duplicate} 重複`);
  const foreign = incomingIds.find(id => !owned.has(id));
  if (foreign != null) reject(`測試 id ${foreign} 不屬於「${feature.name}」`);
  return owned;
}

function rejectChangesUpToCurrentStep(db: Db, featureId: number, incoming: IncomingTest[]) {
  const step = currentStep(db, featureId);
  if (!step) return;
  const existing = orderedTests(db, featureId);
  const fixedCount = existing.findIndex(t => t.id === step.test_id) + 1;
  const changed = existing.slice(0, fixedCount).filter((t, i) => incoming[i]?.id == null || Number(incoming[i].id) !== t.id || incoming[i].name !== t.name);
  if (changed.length) reject(`目前步驟以前的測試不能變動：${changed.map(t => t.name).join('、')}`);
}

function upsertTask(db: Db, featureId: number, task: NonNullable<PlanInput['tasks']>[number], ord: number): number {
  if (!task.code || !task.title) reject('每個 Task 需要 code 與 title');
  db.run(`INSERT INTO tasks(feature_id, code, title, layer, ord) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(feature_id, code) DO UPDATE SET title = excluded.title, layer = excluded.layer, ord = excluded.ord`, featureId, task.code, task.title, task.layer ?? null, ord);
  return db.get<{ id: number }>('SELECT id FROM tasks WHERE feature_id = ? AND code = ?', featureId, task.code)!.id;
}

function upsertTest(db: Db, featureId: number, taskId: number, test: PlanTestInput, ord: number) {
  if (!test.name) reject('每個測試需要 name');
  if (test.id != null) db.run('UPDATE tests SET task_id = ?, name = ?, rule = ?, layer = ?, ord = ? WHERE id = ?', taskId, test.name, test.rule ?? null, test.layer ?? null, ord, Number(test.id));
  else db.run('INSERT INTO tests(feature_id, task_id, name, rule, layer, ord) VALUES (?, ?, ?, ?, ?, ?)', featureId, taskId, test.name, test.rule ?? null, test.layer ?? null, ord);
}

export function writePlan(db: Db, { feature: expectedFeature, tasks = [] }: PlanInput = {}) {
  return db.transaction(() => {
    const feature = writableFeature(db, expectedFeature);
    const incoming: IncomingTest[] = tasks.flatMap(t => (t.tests ?? []).map(x => ({ ...x, task: t.code })));
    const incomingIds = incoming.filter(x => x.id != null).map(x => Number(x.id));
    const owned = rejectForeignOrDuplicateIds(db, feature, incomingIds);
    rejectChangesUpToCurrentStep(db, feature.id, incoming);

    tasks.forEach((task, i) => {
      const taskId = upsertTask(db, feature.id, task, i);
      (task.tests ?? []).forEach((test, j) => upsertTest(db, feature.id, taskId, test, j));
    });
    const kept = new Set(incomingIds);
    for (const id of owned) if (!kept.has(id)) db.run('DELETE FROM tests WHERE id = ?', id);
    const codes = tasks.map(t => t.code ?? '');
    db.run(`DELETE FROM tasks WHERE feature_id = ? AND code NOT IN (${codes.map(() => '?').join(',') || "''"})`, feature.id, ...codes);

    touchFeature(db, feature.id);
    return { tests: orderedTests(db, feature.id).map(t => ({ id: t.id, task: t.task, name: t.name })) };
  });
}

function stepAt(db: Db, feature: FeatureRow, testId: number | string | undefined): StepRow {
  const step = currentStep(db, feature.id) ?? reject(`「${feature.name}」還沒開始 TDD`);
  if (Number(testId) !== step.test_id) reject(`測試 ${testId} 不是目前步驟（目前是 ${step.test_id}）`);
  return step;
}

type CodeColumns = Record<string, string | null>;

export const COMMIT_SHA = /^[0-9a-f]{4,40}$/i;

const isLineList = (lines: unknown) => lines === undefined || (Array.isArray(lines) && lines.every(n => Number.isInteger(n) && n > 0));

function rejectInvalidAddedLines(content: CodeFile | CodeFile[] | undefined) {
  const files = content === undefined ? [] : Array.isArray(content) ? content : [content];
  if (!files.every(f => isLineList(f.added))) reject('greenExample／refactorExample 的 added 只能是正整數行號');
  if (!files.every(f => isLineList(f.removed))) reject('greenExample／refactorExample 的 removed 只能是正整數行號');
  if (files.some(f => f.removed?.some(n => f.added?.includes(n)))) reject('同一行不能同時是 added 和 removed');
}

// 沒有 added 的綠燈範例在頁面上看不出改了哪幾行
function rejectGreenWithoutAdded(content: CodeFile | CodeFile[] | undefined) {
  const files = content === undefined ? [] : [content].flat();
  if (files.some(f => !f.added?.length)) reject('greenExample 每個檔案都要有 added：新增或修改的行號（整個檔案都是新的就列出全部行號）');
}

function codeColumns(prefix: 'test' | 'green', content: CodeFile | CodeFile[] | undefined): CodeColumns {
  if (content === undefined) return {};
  // 單一檔案的欄位沒有地方放 removed，有刪除行的範例改存成檔案陣列
  const files = Array.isArray(content) ? content : content.removed?.length ? [content] : null;
  const single: CodeFile = files ? {} : content as CodeFile;
  return {
    [`${prefix}_file`]: single.file ?? null,
    [`${prefix}_lang`]: single.lang ?? null,
    [`${prefix}_code`]: single.code ?? null,
    ...(prefix === 'green' ? { green_added: single.added?.join(',') ?? null } : {}),
    [`${prefix}_files`]: files ? JSON.stringify(files) : null,
  };
}

export function recordPhase(db: Db, input: PhaseInput = {}) {
  const { test, phase, title, story, layer, ruleRef, testCode, failure, greenExample, refactor, refactorExample, hint, lesson, problem } = input;
  return db.transaction(() => {
    const feature = writableFeature(db);
    const step = stepAt(db, feature, test);
    if (phase !== step.phase && (!step.phase || NEXT_PHASE[step.phase] !== phase)) reject(`不能從 ${step.phase} 換到 ${phase}`);
    rejectInvalidAddedLines(greenExample);
    rejectInvalidAddedLines(refactorExample);
    rejectGreenWithoutAdded(greenExample);
    if (problem && typeof problem.title !== 'string') reject('problem 要有 title（一句話說哪裡卡住）');
    const changes: Record<string, SQLInputValue | undefined> = {
      phase, title, story, layer, rule_ref: ruleRef, failure, refactor, hint,
      lesson: lesson === undefined ? undefined : JSON.stringify(lesson),
      problem: problem ? JSON.stringify(problem) : problem === null || phase !== step.phase ? null : undefined,
      // 重構範例只有新格式，單一檔案也存成陣列
      refactor_files: refactorExample === undefined ? undefined : JSON.stringify([refactorExample].flat()),
      ...codeColumns('test', testCode),
      ...codeColumns('green', greenExample),
    };
    const columns = Object.entries(changes).filter((entry): entry is [string, SQLInputValue] => entry[1] !== undefined);
    db.run(`UPDATE steps SET ${columns.map(([name]) => `${name} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...columns.map(([, value]) => value), now(), step.id);
    touchFeature(db, feature.id);
    return { test: step.test_id, phase };
  });
}

export function completeStep(db: Db, { test, sha }: CompleteInput, commit: ShaInfo) {
  if (!COMMIT_SHA.test(String(sha))) reject(`${sha} 不是有效的 commit sha`);
  return db.transaction(() => {
    const bound = db.get<{ test_id: number; name: string }>(`SELECT s.test_id, t.name FROM steps s JOIN tests t ON t.id = s.test_id
      WHERE s.binding = 'explicit' AND s.commit_sha LIKE ? || '%'`, String(sha));
    if (bound?.test_id === Number(test)) return { already: true, test: bound.test_id, name: bound.name };
    // 一個 commit 只綁一步；不明講的話 AI 會以為完成了，步驟卻停在原地
    if (bound) reject(`${sha} 已經綁在測試 ${bound.test_id}「${bound.name}」；每個測試要有自己的 commit，這一步沒有改動就用 git commit --allow-empty`);
    const feature = writableFeature(db);
    if (!commit.full || !commit.ancestor) reject(`${sha} 不是 HEAD 或 HEAD 的祖先`);
    const step = stepAt(db, feature, test);
    if (step.phase === 'red') reject('紅燈還沒轉綠，不能完成這一步');
    const completedAt = now();
    db.run("UPDATE steps SET completed_at = ?, commit_sha = ?, binding = 'explicit', updated_at = ? WHERE id = ?", completedAt, commit.full, completedAt, step.id);
    const order = orderedTests(db, feature.id);
    const next = order[order.findIndex(t => t.id === step.test_id) + 1];
    if (next) openRedStep(db, feature.id, next.id);
    else db.run("UPDATE features SET stage = 'done' WHERE id = ?", feature.id);
    touchFeature(db, feature.id);
    return { test: step.test_id, next: next?.id ?? null, done: !next };
  });
}

export function readPlan(db: Db, featureId: number): PlannedTaskOut[] {
  const steps = new Map(db.all<StepRow>('SELECT * FROM steps WHERE feature_id = ?', featureId).map(s => [s.test_id, s]));
  return db.all<TaskRow>('SELECT * FROM tasks WHERE feature_id = ? ORDER BY ord', featureId).map(task => ({
    id: task.code,
    title: task.title,
    ...(task.layer ? { layer: task.layer } : {}),
    tests: db.all<TestRow>('SELECT * FROM tests WHERE task_id = ? ORDER BY ord', task.id).map((test, i) => ({
      id: test.id,
      index: i + 1,
      name: test.name,
      ...(test.rule ? { rule: test.rule } : {}),
      ...(test.layer ? { layer: test.layer } : {}),
      step: steps.get(test.id) ?? null,
    })),
  }));
}
