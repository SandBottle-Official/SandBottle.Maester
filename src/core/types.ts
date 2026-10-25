import type { EventType, FeatureStage, Phase } from './vocabulary.ts';

export type FeatureRow = {
  id: number;
  name: string;
  stage: FeatureStage;
  scale: string | null;
  rt_state: string | null;
  rt_note: string | null;
  created_at: string;
  updated_at: string;
};

export type FeatureSummary = { id: number; name: string; stage: FeatureStage; current: boolean };

export type TaskRow = { id: number; feature_id: number; code: string; title: string; layer: string | null; ord: number };

export type TestRow = { id: number; feature_id: number; task_id: number; name: string; rule: string | null; layer: string | null; ord: number };

export type OrderedTest = { id: number; name: string; rule: string | null; layer: string | null; task: string; ord: number };

export type StepRow = {
  id: number;
  feature_id: number;
  test_id: number;
  phase: Phase | null;
  title: string | null;
  story: string | null;
  layer: string | null;
  rule_ref: string | null;
  test_file: string | null;
  test_lang: string | null;
  test_code: string | null;
  failure: string | null;
  green_file: string | null;
  green_lang: string | null;
  green_code: string | null;
  green_added: string | null;
  test_files: string | null;
  green_files: string | null;
  refactor: string | null;
  refactor_files: string | null;
  hint: string | null;
  lesson: string | null;
  problem: string | null;
  completed_at: string | null;
  commit_sha: string | null;
  binding: 'explicit' | 'inferred' | null;
  updated_at: string;
};

export type DocRow = { id: number; feature_id: number; seq: number; kind: string; n: number | null; summary: string | null; created_at: string };

export type ItemRow = { id: number; doc_id: number; ord: number; section: string | null; who: string | null; name: string | null; text: string | null; why: string | null; chosen: number | null };

export type EventRow = {
  id: string;
  feature_id: number;
  ts: string;
  type: EventType;
  status: 'pending' | 'processing' | 'done';
  ctx_stage: string | null;
  ctx_test_id: number | null;
  ctx_phase: string | null;
  text: string | null;
};

export type CodeFile = { file?: string | null; lang?: string | null; code?: string | null; added?: number[] };

export type Verdict = 'accept' | 'reject' | 'ask';

export type DecisionOption = { label: string; by?: string };

export type DecisionTableRule = { id: string; values?: (string | null)[]; action?: string | null; gwt?: { given?: string | null; when?: string | null; then?: string | null } };

export type DocInput = {
  kind?: string;
  n?: number | null;
  summary?: string | null;
  items?: { who?: string; text?: string; name?: string; summary?: string; chosen?: boolean }[];
  points?: { text?: string; why?: string; responses?: { who: string; verdict: Verdict }[] }[];
  conditions?: string[];
  rules?: DecisionTableRule[];
  decisions?: { topic?: string; decision?: string; reason?: string }[];
  rejected?: string[];
  risks?: string[];
  followups?: string[];
};

export type DocOut = { file: string; kind: string; n?: number; summary?: string; [section: string]: unknown };

export type StartFeatureInput = { name?: string; scale?: string | null };

export type StageInput = { state?: string; note?: string | null; scale?: string | null };

export type DecisionInput = { code?: string; question?: string; options?: DecisionOption[]; freeText?: boolean; answer?: string | null };

export type DecisionOut = { id: string; question: string; options: DecisionOption[]; freeText: boolean; answer: string | null };

export type AnswerInput = { code?: string; value?: string };

export type PlanTestInput = { id?: number | string; name?: string; rule?: string | null; layer?: string | null };

export type PlanInput = { feature?: number | string; tasks?: { code?: string; title?: string; layer?: string | null; tests?: PlanTestInput[] }[] };

export type PlannedTestOut = { id: number; index: number; name: string; rule?: string; layer?: string; step: StepRow | null };

export type PlannedTaskOut = { id: string; title: string; layer?: string; tests: PlannedTestOut[] };

export type PhaseInput = {
  test?: number | string;
  phase?: Phase;
  title?: string;
  story?: string;
  layer?: string;
  ruleRef?: string;
  testCode?: CodeFile | CodeFile[];
  failure?: string;
  greenExample?: CodeFile | CodeFile[];
  refactor?: string;
  refactorExample?: CodeFile | CodeFile[];
  hint?: string;
  lesson?: unknown;
  problem?: StepProblem | null;
};

// 卡住這一步、要使用者調整的事（例如回歸測試失敗）；換階段自動清掉
export type StepProblem = { title: string; why?: string; fix?: string; output?: string };

export type CompleteInput = { test?: number | string; sha?: string };

export type ShaInfo = { full: string | null; ancestor: boolean };

export type EventContext = { stage?: string; test?: number | string | null; phase?: string | null };

export type Answer = { decision: string; value: string; free?: boolean };

export type EventInput = { type?: string; payload?: { text?: unknown; answers?: Answer[] } | null; feature?: number | string | null; ctx?: EventContext };

export type EventOut = {
  id: string;
  ts: string;
  type: EventType;
  status: EventRow['status'];
  feature: number;
  payload: { answers: Answer[] } | { text: string | null } | null;
  ctx: { stage: string | null; test: number | null; phase: string | null };
};

export type ImportedStep = { done?: boolean; sha?: string | null; phase?: Phase | null; content?: Record<string, any> | null };

export type ImportFeatureInput = {
  name: string;
  stage: FeatureStage;
  scale?: string | null;
  rtState?: string | null;
  rtNote?: string | null;
  docs: DocInput[];
  decisions: DecisionInput[];
  tasks: { code: string; title: string; layer?: string | null; tests: { name: string; rule?: string | null; layer?: string | null; step?: ImportedStep | null }[] }[];
};
