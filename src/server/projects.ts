import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { maesterHome } from '../core/paths.ts';

const projectsFile = () => path.join(maesterHome(), 'projects.json');
const KEY_BYTES = 16;

export function readKey(): string {
  fs.mkdirSync(maesterHome(), { recursive: true });
  const file = path.join(maesterHome(), 'key');
  try { return fs.readFileSync(file, 'utf8').trim(); }
  catch {
    const key = crypto.randomBytes(KEY_BYTES).toString('hex');
    fs.writeFileSync(file, key, { mode: 0o600 });
    return key;
  }
}

export function readProjects(): string[] {
  try { return JSON.parse(fs.readFileSync(projectsFile(), 'utf8')); }
  catch { return []; }
}

export function addProject(repo: string) {
  const projects = readProjects();
  if (projects.includes(repo)) return;
  fs.mkdirSync(maesterHome(), { recursive: true });
  fs.writeFileSync(projectsFile(), JSON.stringify([...projects, repo], null, 2));
}
