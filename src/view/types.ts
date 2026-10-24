import type { CodeFile, DecisionOut, DocOut, EventOut, FeatureSummary } from '../core/types.ts';
import type { FeatureStage, Phase, RedBy } from '../core/vocabulary.ts';
import type { ChangedFile, CommitView } from './git.ts';

export type StepContent = {
  phase: Phase | null;
  title: string | null;
  story: string | null;
  layer: string | null;
  ruleRef: string | null;
  testCode?: CodeFile;
  failure: string | null;
  greenExample?: CodeFile;
  testFiles: CodeFile[];
  greenFiles: CodeFile[];
  refactor: string | null;
  refactorFiles: CodeFile[];
  hint: string | null;
  lesson?: unknown;
  empty: boolean;
};

export type CurrentStepView = StepContent & { task: string; test: number; testId: number };

export type HistoryEntry = StepContent & { commit: CommitView | null; archivedAt: string };

export type PlanView = {
  schemaVersion: 1;
  feature: string;
  tasks: { id: string; title: string; layer?: string; tests: { id: number; index: number; name: string; rule?: string; layer?: string; done: boolean }[] }[];
};

export type StateView = {
  schemaVersion: 1;
  feature: string;
  stage: Exclude<FeatureStage, 'done'>;
  done: boolean;
  updatedAt: string;
  tdd: CurrentStepView | null;
  roundtable: { state: string | null; scale: string | null; note: string | null; decisions: DecisionOut[] };
};

export type View = {
  repo: string;
  name: string;
  branch: string;
  errors: string[];
  state: StateView | null;
  plan: PlanView | null;
  history: Record<string, HistoryEntry>;
  roundtable: DocOut[];
  features: FeatureSummary[];
  featureId: number | null;
  readonly: boolean;
  pending: EventOut[];
  processing: EventOut[];
  greens: { user: number; total: number };
  changes: ChangedFile[];
  redBy: RedBy;
};
