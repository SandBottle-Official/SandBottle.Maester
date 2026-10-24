import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR_NAME, dataDir } from '../core/paths.ts';
import { addProject } from '../server/projects.ts';

const EXCLUDE_ENTRY = `${DATA_DIR_NAME}/`;

export function excludeFromGit(repo: string) {
  const excludeFile = path.resolve(repo, execFileSync('git', ['-C', repo, 'rev-parse', '--git-path', 'info/exclude'], { encoding: 'utf8' }).trim());
  const current = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, 'utf8') : '';
  if (current.split('\n').includes(EXCLUDE_ENTRY)) return;
  fs.mkdirSync(path.dirname(excludeFile), { recursive: true });
  fs.appendFileSync(excludeFile, `${current && !current.endsWith('\n') ? '\n' : ''}${EXCLUDE_ENTRY}\n`);
}

export function prepareRepo(repo: string) {
  fs.mkdirSync(dataDir(repo), { recursive: true });
  excludeFromGit(repo);
  addProject(repo);
}
