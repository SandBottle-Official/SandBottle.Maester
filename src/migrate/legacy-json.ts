import fs from 'node:fs';
import path from 'node:path';
import { reject } from '../core/errors.ts';
import { dataDir, dbPath } from '../core/paths.ts';
import { openStore } from '../core/store.ts';
import type { DocInput, ImportedStep, ImportFeatureInput } from '../core/types.ts';
import type { FeatureStage, Phase } from '../core/vocabulary.ts';
import { git } from '../view/git.ts';

type Json = Record<string, any>;
type Position = { done: true } | { done?: false; task: string; test: number; phase: Phase };
type Checkbox = { done: boolean; text: string; line: string };
type MarkdownPlan = { checks: Record<string, Checkbox[]>; progress: Position | null };

const PROGRESS_MARKER = '> 進度：';
const PHASE_BY_EMOJI: Record<string, Phase> = { '🔴': 'red', '🟢': 'green', '🔵': 'refactor' };
const pad = (n: number) => String(n).padStart(2, '0');

const readJson = (file: string): Json | null => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
};

const listJson = (dir: string) => {
  try { return fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('.')).sort(); }
  catch { return []; }
};

function parseProgress(line: string | undefined): Position | null {
  if (line?.startsWith('完成')) return { done: true };
  const match = line?.match(/Task (\d+) · (\d+)／\d+ · (🔴|🟢|🔵)/u);
  return match ? { task: pad(Number(match[1])), test: Number(match[2]), phase: PHASE_BY_EMOJI[match[3]] } : null;
}

function readMarkdownPlan(file: string): MarkdownPlan {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const checks: Record<string, Checkbox[]> = {};
  let task: string | null = null;
  for (const line of lines) {
    const heading = line.match(/^#{2,3} Task (\d+)\b/);
    if (heading) {
      task = pad(Number(heading[1]));
      checks[task] ??= [];
      continue;
    }
    const checkbox = line.match(/^- \[( |x)\] (.+)$/);
    if (checkbox && task) checks[task].push({ done: checkbox[1] === 'x', text: checkbox[2], line });
  }
  const progressLine = lines.find(l => l.startsWith(PROGRESS_MARKER))?.slice(PROGRESS_MARKER.length).trim();
  return { checks, progress: parseProgress(progressLine) };
}

const firstCommitAdding = (repo: string, relativeFile: string, line: string) =>
  git(repo, ['log', '--reverse', '--format=%H', '-S', line, '--', relativeFile]).split('\n')[0] || null;

type LegacySources = { state: Json | null; plan: Json | null; markdown: MarkdownPlan | null; markdownPath: string | undefined; history: Record<string, Json | null> };

function readSources(repo: string): LegacySources {
  const dir = dataDir(repo);
  const state = readJson(path.join(dir, 'state.json')), plan = readJson(path.join(dir, 'plan.json'));
  if (!state && !plan) reject('沒有舊的 state.json 或 plan.json 可以遷移');
  const markdownPath: string | undefined = plan?.planPath;
  const markdownFile = markdownPath && path.join(repo, markdownPath);
  const markdown = markdownFile && fs.existsSync(markdownFile) ? readMarkdownPlan(markdownFile) : null;
  const history = Object.fromEntries(listJson(path.join(dir, 'history')).map(f => [f.slice(0, -'.json'.length), readJson(path.join(dir, 'history', f))]));
  return { state, plan, markdown, markdownPath, history };
}

function buildTasks(repo: string, sources: LegacySources, position: Position | null) {
  const { plan, markdown, markdownPath, history, state } = sources;
  const previous = state?.tdd;
  const problems: string[] = [];
  const taskOrder: string[] = (plan?.tasks ?? []).map((t: Json) => pad(Number(t.id)));
  const isBeforePosition = (code: string, index: number) => !!position && (position.done
    || taskOrder.indexOf(code) < taskOrder.indexOf(position.task) || (code === position.task && index < position.test));

  const tasks: ImportFeatureInput['tasks'] = (plan?.tasks ?? []).map((task: Json) => {
    const code = pad(Number(task.id));
    const names: string[] = task.tests.map((x: Json) => x.name);
    names.filter((n, i) => names.indexOf(n) !== i).forEach(n => problems.push(`Task ${code} 有重名測試：${n}`));
    return {
      code, title: task.title, layer: task.layer,
      tests: task.tests.map((test: Json, i: number) => {
        const index = i + 1, snapshot = history[`${code}-${pad(index)}`];
        const checkbox = markdown && (markdown.checks[code] ?? []).find(c => c.text === test.name || c.text.includes(`\`${test.name}\``));
        if (markdown && !checkbox) problems.push(`Task ${code} 的「${test.name}」在 md 找不到勾選行`);
        const done = markdown ? !!checkbox?.done : isBeforePosition(code, index);
        const isCurrent = !done && !!position && !position.done && code === position.task && index === position.test;
        let step: ImportedStep | null = null;
        if (done) step = { done: true, sha: snapshot?.commit?.sha || (checkbox && markdownPath ? firstCommitAdding(repo, markdownPath, checkbox.line) : null), content: snapshot };
        else if (isCurrent && !position.done) step = { phase: position.phase, content: previous && pad(Number(previous.task)) === code && Number(previous.test) === index ? previous : null };
        return { name: test.name, rule: test.rule, layer: test.layer, step };
      }),
    };
  });
  if (problems.length) reject(`遷移失敗，舊資料對不上：\n${problems.join('\n')}`);
  return tasks;
}

function featureStage(sources: LegacySources, position: Position | null): FeatureStage {
  if (position?.done) return 'done';
  return sources.state?.stage === 'tdd' || (!sources.state && sources.plan) ? 'tdd' : 'roundtable';
}

function writeAtomically(repo: string, data: ImportFeatureInput) {
  const target = dbPath(repo), temporary = `${target}.tmp`;
  const removeTemporary = () => { for (const suffix of ['', '-wal', '-shm']) fs.rmSync(temporary + suffix, { force: true }); };
  removeTemporary();
  try {
    const store = openStore(repo, { write: true, file: temporary })!;
    try { store.importFeature(data); } finally { store.close(); }
    fs.renameSync(temporary, target);
  } finally { removeTemporary(); }
}

export function migrateLegacyJson(repo: string) {
  if (fs.existsSync(dbPath(repo))) reject('已經有 maester.db，不重複遷移');
  const sources = readSources(repo);
  const previous = sources.state?.tdd;
  const position: Position | null = sources.markdown?.progress ?? (previous ? { task: pad(Number(previous.task)), test: Number(previous.test), phase: previous.phase } : null);
  const tasks = buildTasks(repo, sources, position);
  const roundtable = sources.state?.roundtable ?? {};
  const docs: DocInput[] = listJson(path.join(dataDir(repo), 'roundtable')).map(f => readJson(path.join(dataDir(repo), 'roundtable', f))).filter((d): d is Json => !!d);
  const data: ImportFeatureInput = {
    name: sources.state?.feature || sources.plan?.feature || path.basename(repo),
    stage: featureStage(sources, position),
    scale: roundtable.scale, rtState: roundtable.state, rtNote: roundtable.note, docs,
    decisions: (roundtable.decisions ?? []).map((d: Json) => ({ code: d.id, question: d.question, options: d.options, freeText: d.freeText, answer: d.answer ?? null })),
    tasks,
  };
  writeAtomically(repo, data);
  const allTests = tasks.flatMap(t => t.tests);
  return { feature: data.name, stage: data.stage, tests: allTests.length, done: allTests.filter(x => x.step?.done).length };
}
