import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR_NAME } from '../core/paths.ts';
import { COMMIT_SHA } from '../core/tdd.ts';
import type { ShaInfo, StepRow } from '../core/types.ts';

export const TEST_PATH = /(^|\/)(tests?|__tests__)\/|Tests?\.[a-z]+$|\.(test|spec)\.[a-z]+$|(^|\/)[^/]*\.Tests?(\.[a-z]+)*\//i;
const GIT_TIMEOUT_MS = 3000;
const FIELD = '\x1f';

export type ChangedFile = { file: string; add: number; del: number; test: boolean };

export type GreenBy = 'user' | 'ai';

export type CommitView = { sha: string; subject?: string; greenBy?: GreenBy | null; missing?: true; inferred: boolean; files: ChangedFile[] };

export function git(repo: string, args: string[]): string {
  try { return execFileSync('git', ['-C', repo, '-c', 'core.quotePath=false', ...args], { encoding: 'utf8', timeout: GIT_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { return ''; }
}

export const repoRoot = (cwd: string) => git(cwd, ['rev-parse', '--show-toplevel']).trim() || null;

function parseNumstat(output: string): ChangedFile[] {
  return output.split('\n').map(line => line.split('\t')).filter(columns => columns[2])
    .map(([added, deleted, file]) => ({ file, add: Number(added) || 0, del: Number(deleted) || 0, test: TEST_PATH.test(file) }));
}

function lineCount(file: string) {
  try { return fs.readFileSync(file, 'utf8').split('\n').length; }
  catch { return 0; }
}

export function changedFiles(repo: string): ChangedFile[] {
  const tracked = parseNumstat(git(repo, ['diff', '--numstat', 'HEAD']));
  const untracked = git(repo, ['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean)
    .map(file => ({ file, add: lineCount(path.join(repo, file)), del: 0, test: TEST_PATH.test(file) }));
  return [...tracked, ...untracked].filter(x => !x.file.startsWith(`${DATA_DIR_NAME}/`));
}

export function shaInfo(repo: string, sha: string): ShaInfo {
  if (!COMMIT_SHA.test(sha)) return { full: null, ancestor: false };
  const full = git(repo, ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]).trim() || null;
  return { full, ancestor: !!full && isAncestorOfHead(repo, full) };
}

function isAncestorOfHead(repo: string, sha: string) {
  try {
    execFileSync('git', ['-C', repo, 'merge-base', '--is-ancestor', sha, 'HEAD'], { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

// Before Maester, AI-written greens were recorded as `Green-By: claude`.
export const normalizeGreenBy = (trailer: string | undefined): GreenBy | null => {
  const author = trailer?.trim();
  if (!author) return null;
  return author === 'user' ? 'user' : 'ai';
};

export function greenByTrailers(repo: string, limit = 200): string[] {
  return git(repo, ['log', '-n', String(limit), '--format=%(trailers:key=Green-By,valueonly,separator=)']).split('\n').map(s => s.trim()).filter(Boolean);
}

export function commitOf(repo: string, step: StepRow): CommitView | null {
  if (!step.commit_sha) return null;
  const inferred = step.binding === 'inferred';
  const output = git(repo, ['log', '-1', `--format=%h${FIELD}%s${FIELD}%(trailers:key=Green-By,valueonly,separator=)`, step.commit_sha]).trim();
  if (!output) return { sha: step.commit_sha.slice(0, 7), missing: true, inferred, files: [] };
  const [sha, subject, greenBy] = output.split(FIELD);
  return { sha, subject, greenBy: normalizeGreenBy(greenBy), inferred, files: parseNumstat(git(repo, ['show', '--numstat', '--format=', step.commit_sha])) };
}
