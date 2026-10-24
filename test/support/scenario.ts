import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after } from 'node:test';
import { Fixtures, type PlannedTask } from './fixtures.ts';
import { AI_GREEN_BY, buildView, CLI, DATA_DIR, openStore } from './system.ts';

const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'maester-home-'));
process.env.MAESTER_HOME = isolatedHome;
process.env.SHOUJI_HOME = path.join(isolatedHome, 'legacy-home');
process.env.MAESTER_PORT = process.env.SHOUJI_PORT = '1';

export type CliResult = { code: number | null; out: any; err: string };

// Assertions inspect JSON shapes; strict null narrowing on every access would bury the intent.
type Inspectable = any;
export type PlannedTest = { id: number; name: string };

export function tempRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), '測試 repo-'));
  const g = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
  const w = (file: string, content: unknown) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), typeof content === 'string' ? content : JSON.stringify(content));
  };
  const commit = (message: string, file = 'src/main/A.java') => {
    w(file, `${message}\n`);
    g('add', '.');
    g('commit', '-qm', message);
    return g('rev-parse', '--short', 'HEAD');
  };
  g('init', '-q');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  w('.git/info/exclude', `${DATA_DIR}/\n`);
  w('src/main/A.java', 'a\n');
  g('add', '.');
  g('commit', '-qm', 'init');
  after(() => fs.rmSync(repo, { recursive: true, force: true }));
  return { repo, g, w, commit };
}

export function cli(repo: string, args: string[], input?: unknown, env: NodeJS.ProcessEnv = process.env): CliResult {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd: repo, encoding: 'utf8', env, input: input === undefined ? '' : JSON.stringify(input) });
  let out: any = result.stdout.trim();
  try { out = JSON.parse(out); } catch {}
  return { code: result.status, out, err: result.stderr.trim() };
}

const pad = (n: number) => String(n).padStart(2, '0');

export function scenario() {
  const r = tempRepo();
  const run = (args: string[], input?: unknown) => cli(r.repo, args, input);
  const ok = (args: string[], input?: unknown) => {
    const x = run(args, input);
    assert.equal(x.code, 0, x.err);
    return x.out;
  };
  const rejected = (args: string[], input?: unknown, why?: RegExp) => {
    const x = run(args, input);
    assert.equal(x.code, 1, `應該被拒絕：${JSON.stringify(x.out)}`);
    if (why) assert.match(x.err, why);
    return x.err;
  };
  const planInput = (feature: number, tasks: PlannedTask[] = Fixtures.計畫, ids: PlannedTest[] = []) => ({
    feature,
    tasks: tasks.map((t, i) => ({
      code: pad(i),
      title: t.title,
      tests: t.tests.map(name => {
        const known = ids.find(x => x.name === name);
        return known ? { name, id: known.id } : { name } as { name: string; id?: number };
      }),
    })),
  });
  const start = (name = Fixtures.客戶訂閱): number => ok(['start'], { name }).feature;
  const plan = (feature: number, tasks?: PlannedTask[]): PlannedTest[] => ok(['plan'], planInput(feature, tasks)).tests;
  const toPhase = (test: number, ...phases: string[]) => phases.forEach(phase => ok(['phase'], { test, phase }));
  const S = {
    ...r, run, ok, rejected, start, plan, planInput, toPhase,
    inTdd(name?: string) {
      const feature = start(name), tests = plan(feature);
      ok(['tdd']);
      return { feature, tests };
    },
    finish(test: number, message = `test: ${test}\n\nGreen-By: ${AI_GREEN_BY}`) {
      toPhase(test, 'green');
      const sha = r.commit(message);
      return { sha, out: ok(['complete', String(test), sha]) };
    },
    view: (feature?: number): Inspectable => buildView(r.repo, feature === undefined ? undefined : String(feature)),
    db: (): Inspectable => openStore(r.repo)!,
    snapshot() {
      const db = S.db();
      try { return JSON.stringify([db.features(), db.all('SELECT * FROM steps'), db.all('SELECT * FROM tests'), db.all('SELECT * FROM events')]); }
      finally { db.close(); }
    },
  };
  return S;
}

export type Scenario = ReturnType<typeof scenario>;

export const contextOf = (view: any) => ({ stage: view.state.stage, test: view.state.tdd?.testId, phase: view.state.tdd?.phase });

export function submit(S: Scenario, type: string, payload?: unknown) {
  const view = S.view(), db = S.db();
  try { return db.submit({ type, payload, feature: view.featureId, ctx: contextOf(view) }); }
  finally { db.close(); }
}
