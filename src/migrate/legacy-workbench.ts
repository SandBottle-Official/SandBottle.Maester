import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { messageOf } from '../core/errors.ts';
import { DB_FILE_NAME, dataDir, maesterHome } from '../core/paths.ts';

type Adoption = 'copied' | 'skipped';

const LEGACY_DIR_NAME = '.shouji';
const LEGACY_DB_NAME = 'shouji.db';
const legacyHome = () => process.env.SHOUJI_HOME || path.join(os.homedir(), '.shouji');
const isLegacyDbFile = (file: string) => path.basename(file).startsWith(LEGACY_DB_NAME);

// Opening a WAL database writes -shm/-wal beside it, so read from a scratch copy to leave .shouji/ byte-identical.
function snapshotDatabase(source: string, target: string) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'maester-adopt-'));
  try {
    const copy = path.join(scratch, LEGACY_DB_NAME);
    for (const suffix of ['', '-wal']) if (fs.existsSync(source + suffix)) fs.copyFileSync(source + suffix, copy + suffix);
    const connection = new DatabaseSync(copy);
    try { connection.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`); }
    finally { connection.close(); }
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}

function copyLegacyFolder(legacy: string, staging: string) {
  fs.cpSync(legacy, staging, { recursive: true, filter: source => !isLegacyDbFile(source) });
  const legacyDb = path.join(legacy, LEGACY_DB_NAME);
  if (fs.existsSync(legacyDb)) snapshotDatabase(legacyDb, path.join(staging, DB_FILE_NAME));
}

// Built in a sibling folder and renamed into place, so a failed or concurrent copy never leaves a half-made .maester/.
export function adoptLegacyData(repo: string): Adoption {
  const legacy = path.join(repo, LEGACY_DIR_NAME), target = dataDir(repo);
  if (!fs.existsSync(legacy) || fs.existsSync(target)) return 'skipped';
  const staging = `${target}.adopting-${process.pid}`;
  try {
    copyLegacyFolder(legacy, staging);
    fs.renameSync(staging, target);
    return 'copied';
  } catch (error) {
    if (fs.existsSync(target)) return 'skipped';
    throw new Error(`無法從 ${LEGACY_DIR_NAME}/ 複製舊紀錄：${messageOf(error)}（原資料沒有被改動）`);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

export function adoptLegacyHome(): Adoption {
  const legacyProjects = path.join(legacyHome(), 'projects.json');
  const projects = path.join(maesterHome(), 'projects.json');
  if (!fs.existsSync(legacyProjects) || fs.existsSync(projects)) return 'skipped';
  fs.mkdirSync(maesterHome(), { recursive: true });
  fs.copyFileSync(legacyProjects, projects);
  return 'copied';
}
