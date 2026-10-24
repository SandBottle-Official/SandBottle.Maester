export const RT_STATES = ['DISCOVER', 'ROUND', 'CODEX_REVIEW', 'CANDIDATE_DESIGNS', 'USER_DIRECTION', 'DECISION_TABLE', 'OPEN_QUESTIONS', 'FINAL_CODEX_REVIEW', 'USER_APPROVAL', 'TASK_BREAKDOWN'] as const;
export const EVENT_TYPES = ['answer', 'approve_design', 'tests_ran', 'hint', 'help_green', 'refactor_done', 'refactor_skip', 'next_round', 'prompt'] as const;
export const DOC_KINDS = ['discover', 'round', 'codex', 'candidates', 'decisionTable', 'design'] as const;
export const DESIGN_LIST_SECTIONS = ['rejected', 'risks', 'followups'] as const;

export type Phase = 'red' | 'green' | 'refactor';
export type FeatureStage = 'roundtable' | 'tdd' | 'done';
export type EventType = typeof EVENT_TYPES[number];
export type DocKind = typeof DOC_KINDS[number];

export const NEXT_PHASE: Partial<Record<Phase, Phase>> = { red: 'green', green: 'refactor' };
export const PHASE_LINE: Record<Phase, string> = { red: '🔴 紅：AI 寫測試', green: '🟢 綠：等使用者實作', refactor: '🔵 重構：等使用者決定' };
export const STAGE_LABEL: Record<FeatureStage, string> = { roundtable: '圓桌', tdd: 'TDD', done: '已完成' };

export const MAX_PROMPT_LENGTH = 8000;

export const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T => values.includes(value as T);
