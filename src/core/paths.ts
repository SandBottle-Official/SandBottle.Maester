import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DATA_DIR_NAME = '.maester';
export const DB_FILE_NAME = 'maester.db';
export const DEFAULT_PORT = 4848;
const LEGACY_JSON_FILES = ['state.json', 'plan.json'];

export const maesterHome = () => process.env.MAESTER_HOME || path.join(os.homedir(), '.maester');
export const port = () => Number(process.env.MAESTER_PORT || DEFAULT_PORT);
export const dataDir = (repo: string) => path.join(repo, DATA_DIR_NAME);
export const dbPath = (repo: string) => path.join(dataDir(repo), DB_FILE_NAME);
export const hasLegacyJson = (repo: string) => LEGACY_JSON_FILES.some(file => fs.existsSync(path.join(dataDir(repo), file)));
