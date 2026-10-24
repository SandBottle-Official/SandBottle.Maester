import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROTOCOL = 4;
export const KEY_HEADER = 'x-maester-key';
export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const PLUGIN_VERSION: string = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'package.json'), 'utf8')).version;

export type Ping = { ok: true; protocol: number; version: string; pid: number; root: string; clients: Record<string, number> };
