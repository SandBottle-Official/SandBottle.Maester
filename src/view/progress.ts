import { openStore } from '../core/store.ts';
import { phaseLine } from '../core/vocabulary.ts';

export function progressLine(repo: string): string {
  const store = openStore(repo);
  if (!store) return '';
  try {
    const feature = store.current();
    if (!feature || feature.stage === 'done') return '';
    if (feature.stage === 'roundtable') return `${feature.name} · 圓桌 · ${feature.rt_state}`;
    for (const task of store.plan(feature.id)) for (const test of task.tests) {
      if (test.step?.phase && !test.step.completed_at) return `${feature.name} · Task ${task.id} · ${test.index}／${task.tests.length} · ${phaseLine(test.step.phase, store.redBy())}`;
    }
    return `${feature.name} · TDD`;
  } finally { store.close(); }
}
