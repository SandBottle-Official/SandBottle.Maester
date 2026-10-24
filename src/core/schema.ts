import type { DatabaseSync } from 'node:sqlite';

export const SCHEMA = 4;

const DDL = `
CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE features(id INTEGER PRIMARY KEY, name TEXT NOT NULL, stage TEXT NOT NULL CHECK(stage IN ('roundtable','tdd','done')),
  scale TEXT, rt_state TEXT, rt_note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE tasks(id INTEGER PRIMARY KEY, feature_id INTEGER NOT NULL REFERENCES features(id), code TEXT NOT NULL, title TEXT NOT NULL, layer TEXT, ord INTEGER NOT NULL,
  UNIQUE(feature_id, code));
CREATE TABLE tests(id INTEGER PRIMARY KEY, feature_id INTEGER NOT NULL REFERENCES features(id), task_id INTEGER NOT NULL REFERENCES tasks(id),
  name TEXT NOT NULL, rule TEXT, layer TEXT, ord INTEGER NOT NULL);
CREATE TABLE steps(id INTEGER PRIMARY KEY, feature_id INTEGER NOT NULL REFERENCES features(id), test_id INTEGER NOT NULL UNIQUE REFERENCES tests(id),
  phase TEXT CHECK(phase IN ('red','green','refactor')), title TEXT, story TEXT, layer TEXT, rule_ref TEXT,
  test_file TEXT, test_lang TEXT, test_code TEXT, failure TEXT, green_file TEXT, green_lang TEXT, green_code TEXT, green_added TEXT, test_files TEXT, green_files TEXT,
  refactor TEXT, hint TEXT, lesson TEXT, completed_at TEXT, commit_sha TEXT, binding TEXT CHECK(binding IN ('explicit','inferred')), updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX one_current_step ON steps(feature_id) WHERE completed_at IS NULL;
CREATE UNIQUE INDEX one_explicit_binding ON steps(commit_sha) WHERE binding = 'explicit';
CREATE TABLE rt_docs(id INTEGER PRIMARY KEY, feature_id INTEGER NOT NULL REFERENCES features(id), seq INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('discover','round','codex','candidates','decisionTable','design')), n INTEGER, summary TEXT, created_at TEXT NOT NULL,
  UNIQUE(feature_id, seq));
CREATE TABLE rt_items(id INTEGER PRIMARY KEY, doc_id INTEGER NOT NULL REFERENCES rt_docs(id), ord INTEGER NOT NULL, section TEXT,
  who TEXT, name TEXT, text TEXT, why TEXT, chosen INTEGER);
CREATE TABLE rt_responses(item_id INTEGER NOT NULL REFERENCES rt_items(id), ord INTEGER NOT NULL, who TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK(verdict IN ('accept','reject','ask')));
CREATE TABLE dt_conditions(doc_id INTEGER NOT NULL REFERENCES rt_docs(id), ord INTEGER NOT NULL, label TEXT NOT NULL);
CREATE TABLE dt_rules(id INTEGER PRIMARY KEY, doc_id INTEGER NOT NULL REFERENCES rt_docs(id), ord INTEGER NOT NULL, code TEXT NOT NULL,
  action TEXT, given TEXT, when_ TEXT, then_ TEXT);
CREATE TABLE dt_values(rule_id INTEGER NOT NULL REFERENCES dt_rules(id), ord INTEGER NOT NULL, value TEXT);
CREATE TABLE decisions(id INTEGER PRIMARY KEY, feature_id INTEGER NOT NULL REFERENCES features(id), code TEXT NOT NULL, question TEXT NOT NULL,
  free_text INTEGER NOT NULL DEFAULT 1, answer TEXT, ord INTEGER NOT NULL, UNIQUE(feature_id, code));
CREATE TABLE decision_options(decision_id INTEGER NOT NULL REFERENCES decisions(id), ord INTEGER NOT NULL, label TEXT NOT NULL, by_who TEXT);
CREATE TABLE events(id TEXT PRIMARY KEY, feature_id INTEGER NOT NULL REFERENCES features(id), ts TEXT NOT NULL, type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','processing','done')), ctx_stage TEXT, ctx_test_id INTEGER, ctx_phase TEXT, text TEXT);
CREATE TABLE event_answers(event_id TEXT NOT NULL REFERENCES events(id), ord INTEGER NOT NULL, decision TEXT NOT NULL, value TEXT NOT NULL,
  free INTEGER NOT NULL DEFAULT 0);
`;

const UPGRADES: Record<number, string> = {
  1: 'ALTER TABLE steps ADD COLUMN lesson TEXT;',
  2: 'ALTER TABLE steps ADD COLUMN test_files TEXT; ALTER TABLE steps ADD COLUMN green_files TEXT;',
  3: 'ALTER TABLE events ADD COLUMN text TEXT;',
};

export function migrateSchema(connection: DatabaseSync, version: number) {
  if (version === 0) {
    connection.exec(`BEGIN; ${DDL}; PRAGMA user_version = ${SCHEMA}; COMMIT;`);
    return;
  }
  for (let from = version; from < SCHEMA; from++) connection.exec(`BEGIN; ${UPGRADES[from]} PRAGMA user_version = ${from + 1}; COMMIT;`);
}
