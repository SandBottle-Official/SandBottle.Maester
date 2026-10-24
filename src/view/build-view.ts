import path from 'node:path';
import { messageOf } from '../core/errors.ts';
import { hasLegacyJson } from '../core/paths.ts';
import { openStore, type Store } from '../core/store.ts';
import type { CodeFile, FeatureRow, StepRow } from '../core/types.ts';
import { changedFiles, commitOf, git, greenByTrailers } from './git.ts';
import type { CurrentStepView, HistoryEntry, StepContent, View } from './types.ts';

const historyKey = (taskCode: string, index: number) => `${taskCode}-${String(index).padStart(2, '0')}`;
const addedLines = (added: string | null) => added ? added.split(',').map(Number) : [];

function codeFile(file: string | null, lang: string | null, code: string | null): CodeFile | undefined {
  return code == null ? undefined : { file, lang, code };
}

function greenFile(step: StepRow): CodeFile | undefined {
  return step.green_code == null ? undefined : { ...codeFile(step.green_file, step.green_lang, step.green_code), added: addedLines(step.green_added) };
}

function listedFiles(json: string | null, single: CodeFile | undefined): CodeFile[] {
  if (json) return JSON.parse(json);
  return single ? [single] : [];
}

function stepContent(step: StepRow): StepContent {
  const testCode = codeFile(step.test_file, step.test_lang, step.test_code);
  const greenExample = greenFile(step);
  return {
    phase: step.phase, title: step.title, story: step.story, layer: step.layer, ruleRef: step.rule_ref,
    testCode, failure: step.failure, greenExample,
    testFiles: listedFiles(step.test_files, testCode),
    greenFiles: listedFiles(step.green_files, greenExample),
    refactor: step.refactor, refactorFiles: step.refactor_files ? JSON.parse(step.refactor_files) : [], hint: step.hint,
    lesson: step.lesson ? JSON.parse(step.lesson) : undefined,
    empty: step.test_code == null && step.test_files == null && step.story == null,
  };
}

function emptyView(repo: string): View {
  const greens = greenByTrailers(repo);
  return {
    repo, name: path.basename(repo), branch: git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).trim(), errors: [],
    state: null, plan: null, history: {}, roundtable: [], features: [], featureId: null, readonly: true, pending: [], processing: [],
    greens: { user: greens.filter(g => g === 'user').length, total: greens.length },
    changes: changedFiles(repo), redBy: 'ai',
  };
}

function fillFeature(view: View, store: Store, repo: string, feature: FeatureRow) {
  view.featureId = feature.id;
  view.readonly = !view.features.find(x => x.id === feature.id)?.current || feature.stage === 'done';
  const plan = store.plan(feature.id);
  view.plan = { schemaVersion: 1, feature: feature.name, tasks: plan.map(t => ({ ...t, tests: t.tests.map(({ step, ...test }) => ({ ...test, done: !!step?.completed_at })) })) };

  let tdd: CurrentStepView | null = null;
  for (const task of plan) for (const test of task.tests) {
    if (!test.step) continue;
    if (test.step.completed_at) {
      const entry: HistoryEntry = { ...stepContent(test.step), commit: commitOf(repo, test.step), archivedAt: test.step.completed_at };
      view.history[historyKey(task.id, test.index)] = entry;
    } else {
      tdd = { task: task.id, test: test.index, testId: test.id, ...stepContent(test.step) };
    }
  }
  view.state = {
    schemaVersion: 1, feature: feature.name, stage: feature.stage === 'done' ? 'tdd' : feature.stage, done: feature.stage === 'done', updatedAt: feature.updated_at, tdd,
    roundtable: { state: feature.rt_state, scale: feature.scale, note: feature.rt_note, decisions: store.decisions(feature.id) },
  };
  view.roundtable = store.docs(feature.id);
  view.pending = store.events(feature.id, 'pending');
  view.processing = store.events(feature.id, 'processing');
}

export function buildView(repo: string, featureId?: string | null): View {
  const view = emptyView(repo);
  let store: Store | null;
  try { store = openStore(repo); }
  catch (error) {
    view.errors.push(messageOf(error));
    return view;
  }
  if (!store) {
    if (hasLegacyJson(repo)) view.errors.push('這個 repo 還是舊的 json 紀錄：在 repo 裡執行 maester migrate');
    return view;
  }
  try {
    view.features = store.features();
    view.redBy = store.redBy();
    const feature = store.feature(Number(featureId)) ?? store.current();
    if (feature) fillFeature(view, store, repo, feature);
  } finally { store.close(); }
  return view;
}
