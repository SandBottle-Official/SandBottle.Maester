import fs from 'node:fs';
import type { Store } from '../core/store.ts';
import { shaInfo } from '../view/git.ts';

type WriteCommand = (store: Store, args: string[], repo: string) => unknown;

export function readInput<T>(): T {
  const text = process.stdin.isTTY ? '' : fs.readFileSync(0, 'utf8').trim();
  return (text ? JSON.parse(text) : {}) as T;
}

export const WRITE_COMMANDS: Record<string, WriteCommand> = {
  start: store => store.startFeature(readInput()),
  switch: (store, [id]) => store.switchFeature(id),
  doc: store => store.addDoc(readInput()),
  design: store => store.addDoc({ ...readInput<object>(), kind: 'design' }),
  stage: store => store.setStage(readInput()),
  ask: store => store.ask(readInput()),
  answer: store => store.answer(readInput()),
  tdd: store => store.startTdd(),
  plan: store => store.writePlan(readInput()),
  phase: store => store.phase(readInput()),
  complete: (store, [test, sha], repo) => store.complete({ test, sha }, shaInfo(repo, sha)),
  done: (store, [id]) => store.done(id),
};

export const READ_COMMANDS = ['ensure', 'open', 'url', 'progress', 'show', 'migrate', 'wait', 'agent', 'statusline'] as const;

export const COMMAND_NAMES: readonly string[] = [...Object.keys(WRITE_COMMANDS), ...READ_COMMANDS];
