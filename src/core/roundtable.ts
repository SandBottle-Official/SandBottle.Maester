import { type Db, flag, now } from './db.ts';
import { reject } from './errors.ts';
import { touchFeature, writableFeature } from './features.ts';
import type { AnswerInput, DecisionInput, DecisionOption, DecisionOut, DecisionTableRule, DocInput, DocOut, DocRow, ItemRow, StageInput, Verdict } from './types.ts';
import { DESIGN_LIST_SECTIONS, DOC_KINDS, isOneOf, RT_STATES } from './vocabulary.ts';

type ItemFields = { section?: string | null; who?: string | null; name?: string | null; text?: string | null; why?: string | null; chosen?: boolean | null };

function insertItem(db: Db, docId: number, ord: number, item: ItemFields): number {
  return db.insert('INSERT INTO rt_items(doc_id, ord, section, who, name, text, why, chosen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    docId, ord, item.section ?? null, item.who ?? null, item.name ?? null, item.text ?? null, item.why ?? null, item.chosen == null ? null : flag(item.chosen));
}

function insertRound(db: Db, docId: number, doc: DocInput) {
  (doc.items ?? []).forEach((x, i) => insertItem(db, docId, i, { who: x.who, text: x.text }));
}

function insertCandidates(db: Db, docId: number, doc: DocInput) {
  (doc.items ?? []).forEach((x, i) => insertItem(db, docId, i, { name: x.name, text: x.summary, chosen: !!x.chosen }));
}

function insertReview(db: Db, docId: number, doc: DocInput) {
  (doc.points ?? []).forEach((point, i) => {
    const itemId = insertItem(db, docId, i, { text: point.text, why: point.why });
    (point.responses ?? []).forEach((r, j) => db.run('INSERT INTO rt_responses(item_id, ord, who, verdict) VALUES (?, ?, ?, ?)', itemId, j, r.who, r.verdict));
  });
}

function insertDesign(db: Db, docId: number, doc: DocInput) {
  let ord = 0;
  for (const d of doc.decisions ?? []) insertItem(db, docId, ord++, { section: 'decision', name: d.topic, text: d.decision, why: d.reason });
  for (const section of DESIGN_LIST_SECTIONS) for (const text of doc[section] ?? []) insertItem(db, docId, ord++, { section, text });
}

function insertDecisionTable(db: Db, docId: number, doc: DocInput) {
  (doc.conditions ?? []).forEach((label, i) => db.run('INSERT INTO dt_conditions(doc_id, ord, label) VALUES (?, ?, ?)', docId, i, label));
  (doc.rules ?? []).forEach((rule, i) => {
    const ruleId = db.insert('INSERT INTO dt_rules(doc_id, ord, code, action, given, when_, then_) VALUES (?, ?, ?, ?, ?, ?, ?)',
      docId, i, rule.id, rule.action ?? null, rule.gwt?.given ?? null, rule.gwt?.when ?? null, rule.gwt?.then ?? null);
    (rule.values ?? []).forEach((value, j) => db.run('INSERT INTO dt_values(rule_id, ord, value) VALUES (?, ?, ?)', ruleId, j, value));
  });
}

const DOC_WRITERS: Record<string, (db: Db, docId: number, doc: DocInput) => void> = {
  round: insertRound,
  candidates: insertCandidates,
  codex: insertReview,
  design: insertDesign,
  decisionTable: insertDecisionTable,
};

export function insertDoc(db: Db, featureId: number, doc: DocInput): number {
  if (!isOneOf(DOC_KINDS, doc.kind)) reject(`不認得的圓桌文件種類：${doc.kind}`);
  const seq = (db.get<{ m: number | null }>('SELECT MAX(seq) m FROM rt_docs WHERE feature_id = ?', featureId)?.m ?? 0) + 1;
  const docId = db.insert('INSERT INTO rt_docs(feature_id, seq, kind, n, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)', featureId, seq, doc.kind, doc.n ?? null, doc.summary ?? null, now());
  DOC_WRITERS[doc.kind]?.(db, docId, doc);
  return seq;
}

export function addDoc(db: Db, doc: DocInput = {}) {
  return db.transaction(() => {
    const feature = writableFeature(db);
    const seq = insertDoc(db, feature.id, doc);
    touchFeature(db, feature.id);
    return { seq };
  });
}

export function setStage(db: Db, { state, note, scale }: StageInput = {}) {
  if (!isOneOf(RT_STATES, state)) reject(`圓桌階段只能是 ${RT_STATES.join('、')}`);
  return db.transaction(() => {
    const feature = writableFeature(db);
    db.run('UPDATE features SET rt_state = ?, rt_note = ?, scale = COALESCE(?, scale) WHERE id = ?', state, note ?? null, scale ?? null, feature.id);
    touchFeature(db, feature.id);
    return { state };
  });
}

export function insertDecision(db: Db, featureId: number, { code, question, options = [], freeText = true, answer = null }: DecisionInput) {
  if (!code || !question) reject('決策題需要 code 與 question');
  if (db.get('SELECT 1 FROM decisions WHERE feature_id = ? AND code = ?', featureId, code)) reject(`決策題 ${code} 已經存在`);
  const ord = db.nextOrdinal('SELECT MAX(ord) m FROM decisions WHERE feature_id = ?', featureId);
  const id = db.insert('INSERT INTO decisions(feature_id, code, question, free_text, answer, ord) VALUES (?, ?, ?, ?, ?, ?)', featureId, code, question, flag(freeText !== false), answer, ord);
  options.forEach((o, i) => db.run('INSERT INTO decision_options(decision_id, ord, label, by_who) VALUES (?, ?, ?, ?)', id, i, o.label, o.by ?? null));
}

export function ask(db: Db, decision: DecisionInput = {}) {
  return db.transaction(() => {
    const feature = writableFeature(db);
    insertDecision(db, feature.id, decision);
    touchFeature(db, feature.id);
    return { decision: decision.code };
  });
}

export function recordAnswer(db: Db, featureId: number, code: string | undefined, value: string) {
  const updated = db.run('UPDATE decisions SET answer = ? WHERE feature_id = ? AND code = ?', value, featureId, code ?? null).changes;
  if (!updated) reject(`沒有決策題 ${code}`);
}

export function answer(db: Db, { code, value }: AnswerInput = {}) {
  if (!value) reject('需要答案');
  return db.transaction(() => {
    const feature = writableFeature(db);
    recordAnswer(db, feature.id, code, value);
    touchFeature(db, feature.id);
    return { decision: code };
  });
}

function readItems(db: Db, docId: number) {
  return db.all<ItemRow>('SELECT * FROM rt_items WHERE doc_id = ? ORDER BY ord', docId);
}

function readDecisionTableRules(db: Db, docId: number): DecisionTableRule[] {
  type RuleRow = { id: number; code: string; action: string | null; given: string | null; when_: string | null; then_: string | null };
  return db.all<RuleRow>('SELECT * FROM dt_rules WHERE doc_id = ? ORDER BY ord', docId).map(r => ({
    id: r.code,
    values: db.all<{ value: string | null }>('SELECT value FROM dt_values WHERE rule_id = ? ORDER BY ord', r.id).map(v => v.value),
    action: r.action,
    ...(r.given != null || r.when_ != null || r.then_ != null ? { gwt: { given: r.given, when: r.when_, then: r.then_ } } : {}),
  }));
}

function readDocBody(db: Db, doc: DocRow): Record<string, unknown> {
  const items = () => readItems(db, doc.id);
  switch (doc.kind) {
    case 'round':
      return { items: items().map(i => ({ who: i.who, text: i.text })) };
    case 'candidates':
      return { items: items().map(i => ({ name: i.name, summary: i.text, chosen: !!i.chosen })) };
    case 'codex':
      return { points: items().map(i => ({ text: i.text, why: i.why,
        responses: db.all<{ who: string; verdict: Verdict }>('SELECT who, verdict FROM rt_responses WHERE item_id = ? ORDER BY ord', i.id).map(r => ({ ...r })) })) };
    case 'design': {
      const all = items();
      const inSection = (section: string) => all.filter(i => i.section === section).map(i => i.text);
      return {
        decisions: all.filter(i => i.section === 'decision').map(i => ({ topic: i.name, decision: i.text, reason: i.why })),
        rejected: inSection('rejected'), risks: inSection('risks'), followups: inSection('followups'),
      };
    }
    case 'decisionTable':
      return {
        conditions: db.all<{ label: string }>('SELECT label FROM dt_conditions WHERE doc_id = ? ORDER BY ord', doc.id).map(c => c.label),
        rules: readDecisionTableRules(db, doc.id),
      };
    default:
      return {};
  }
}

export function readDocs(db: Db, featureId: number): DocOut[] {
  return db.all<DocRow>('SELECT * FROM rt_docs WHERE feature_id = ? ORDER BY seq', featureId).map(doc => ({
    file: `${String(doc.seq).padStart(2, '0')}-${doc.kind}`,
    kind: doc.kind,
    ...(doc.n != null ? { n: doc.n } : {}),
    ...(doc.summary != null ? { summary: doc.summary } : {}),
    ...readDocBody(db, doc),
  }));
}

export function readDecisions(db: Db, featureId: number): DecisionOut[] {
  type Row = { id: number; code: string; question: string; free_text: number; answer: string | null };
  return db.all<Row>('SELECT * FROM decisions WHERE feature_id = ? ORDER BY ord', featureId).map(d => ({
    id: d.code,
    question: d.question,
    options: db.all<{ label: string; by_who: string | null }>('SELECT label, by_who FROM decision_options WHERE decision_id = ? ORDER BY ord', d.id)
      .map((o): DecisionOption => ({ label: o.label, ...(o.by_who ? { by: o.by_who } : {}) })),
    freeText: !!d.free_text,
    answer: d.answer,
  }));
}
