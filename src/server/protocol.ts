import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROTOCOL = 4;
export const KEY_HEADER = 'x-maester-key';
export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const PLUGIN_VERSION: string = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'package.json'), 'utf8')).version;

// Old sessions keep running their install's hooks; comparing lets them leave a newer server or statusline alone.
export function isNewerVersion(a: string, than: string) {
  const x = a.split('.').map(Number), y = than.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

export type Ping = { ok: true; protocol: number; version: string; pid: number; root: string; clients: Record<string, number> };
