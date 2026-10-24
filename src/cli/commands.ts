import fs from 'node:fs';
import path from 'node:path';
import { reject } from '../core/errors.ts';
import type { Store } from '../core/store.ts';
import type { CodeFile, PhaseInput } from '../core/types.ts';
import { shaInfo } from '../view/git.ts';

type WriteCommand = (store: Store, args: string[], repo: string) => unknown;

export function readInput<T>(): T {
  const text = process.stdin.isTTY ? '' : fs.readFileSync(0, 'utf8').trim();
  return (text ? JSON.parse(text) : {}) as T;
}

function realPath(file: string) {
  try { return fs.realpathSync(file); } catch { return reject(`讀不到 ${path.basename(file)}`); }
}

// 程式碼已經在磁碟上時只傳檔名，由這裡讀檔存成快照，AI 不必再輸出一次
function readCodeFile(repo: string, entry: CodeFile): CodeFile {
  if (entry.code != null || !entry.file) return entry;
  const root = realPath(repo);
  const inside = (file: string) => {
    const relative = path.relative(root, file);
    return relative.startsWith('..') || path.isAbsolute(relative) ? reject(`${entry.file} 不在 repo 裡`) : file;
  };
  // 先擋 ../，再擋指到 repo 外面的 symlink
  const file = inside(realPath(inside(path.resolve(root, entry.file))));
  return { ...entry, lang: entry.lang ?? (path.extname(file).slice(1) || null), code: fs.readFileSync(file, 'utf8') };
}

const readCode = (repo: string, content: CodeFile | CodeFile[] | undefined) =>
  content === undefined ? undefined : Array.isArray(content) ? content.map(c => readCodeFile(repo, c)) : readCodeFile(repo, content);

function phaseInput(repo: string): PhaseInput {
  const input = readInput<PhaseInput>();
  return { ...input, testCode: readCode(repo, input.testCode), greenExample: readCode(repo, input.greenExample), refactorExample: readCode(repo, input.refactorExample) };
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
  phase: (store, _, repo) => store.phase(phaseInput(repo)),
  complete: (store, [test, sha], repo) => store.complete({ test, sha }, shaInfo(repo, sha)),
  done: (store, [id]) => store.done(id),
};

export const READ_COMMANDS = ['ensure', 'open', 'url', 'progress', 'show', 'migrate', 'wait', 'agent', 'statusline'] as const;

export const COMMAND_NAMES: readonly string[] = [...Object.keys(WRITE_COMMANDS), ...READ_COMMANDS];
