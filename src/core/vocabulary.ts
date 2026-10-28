export const RT_STATES = ['DISCOVER', 'ROUND', 'CODEX_REVIEW', 'CANDIDATE_DESIGNS', 'USER_DIRECTION', 'DECISION_TABLE', 'OPEN_QUESTIONS', 'FINAL_CODEX_REVIEW', 'USER_APPROVAL', 'TASK_BREAKDOWN'] as const;
export const EVENT_TYPES = ['answer', 'approve_design', 'tests_ran', 'hint', 'help_green', 'refactor_done', 'refactor_skip', 'next_round', 'prompt', 'red_written'] as const;
export const DOC_KINDS = ['discover', 'round', 'codex', 'candidates', 'decisionTable', 'design'] as const;
export const DESIGN_LIST_SECTIONS = ['rejected', 'risks', 'followups'] as const;

export type Phase = 'red' | 'green' | 'refactor';
export type FeatureStage = 'roundtable' | 'tdd' | 'done';
export type EventType = typeof EVENT_TYPES[number];
export type DocKind = typeof DOC_KINDS[number];

export const NEXT_PHASE: Partial<Record<Phase, Phase>> = { red: 'green', green: 'refactor' };
export const PHASE_LINE: Record<Phase, string> = { red: '🔴 紅：AI 寫測試', green: '🟢 綠：等使用者實作', refactor: '🔵 重構：等使用者決定' };
// 紅燈測試由誰寫：ai 直接寫檔；user 時 AI 只給名稱、行為與片段，使用者寫好後按 red_written
export const RED_BY = ['ai', 'user'] as const;
export type RedBy = typeof RED_BY[number];
export const phaseLine = (phase: Phase, redBy: RedBy) => phase === 'red' && redBy === 'user' ? '🔴 紅：等使用者寫測試' : PHASE_LINE[phase];
export const STAGE_LABEL: Record<FeatureStage, string> = { roundtable: '臨時動議', tdd: 'TDD', done: '已完成' };

export const MAX_PROMPT_LENGTH = 8000;

export const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T => values.includes(value as T);
