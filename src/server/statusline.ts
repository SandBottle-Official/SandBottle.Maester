import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reject } from '../core/errors.ts';
import { maesterHome } from '../core/paths.ts';
import { PLUGIN_ROOT } from './protocol.ts';

// 用量（5h／週）只在 statusline 的 JSON 裡：第一次 SessionStart 自動把 statusline 換成 maester，原本的指令照樣跑。
// 備份檔記著原本的 statusline；off 表示使用者還原或自己換掉了，之後不再自動接上
type StatusLine = { type?: string; command?: string; [key: string]: unknown };

const settingsFile = () => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json');
const backupFile = () => path.join(maesterHome(), 'statusline.json');
export const ourCommand = () => `node "${path.join(PLUGIN_ROOT, 'bin/maester.mjs')}" statusline`;
const isOurs = (command: unknown) => typeof command === 'string' && /maester\.mjs" statusline$/.test(command);

function readSettings(): Record<string, unknown> {
  let text: string;
  try { text = fs.readFileSync(settingsFile(), 'utf8'); } catch { return {}; }
  try { return JSON.parse(text); } catch { return reject(`${settingsFile()} 不是純 JSON，沒有動它`); }
}
const writeSettings = (settings: Record<string, unknown>) => {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2) + '\n');
};

type Backup = { original?: StatusLine | null; off?: boolean };
function readBackup(): Backup | null {
  try { return JSON.parse(fs.readFileSync(backupFile(), 'utf8')); } catch { return null; }
}
const writeBackup = (backup: Backup) => {
  fs.mkdirSync(maesterHome(), { recursive: true });
  fs.writeFileSync(backupFile(), JSON.stringify(backup, null, 2));
};

export const statuslineInstalled = () => { const b = readBackup(); return !!b && !b.off; };

// 使用者原本的 statusline 指令；maester statusline 會把同一份 stdin 轉給它
export const originalCommand = (): string | null => readBackup()?.original?.command ?? null;

// 只有從來沒接過才自動接；還原過或換掉過就尊重使用者
export function autoInstallStatusline() {
  if (!readBackup()) installStatusline();
}

export function installStatusline() {
  const settings = readSettings(), current = settings.statusLine as StatusLine | undefined;
  if (!statuslineInstalled()) {
    writeBackup({ original: isOurs(current?.command) ? null : current ?? null });
  }
  settings.statusLine = { ...current, type: 'command', command: ourCommand() };
  writeSettings(settings);
}

export function uninstallStatusline() {
  if (!statuslineInstalled()) return;
  const settings = readSettings(), original = readBackup()?.original;
  if (isOurs((settings.statusLine as StatusLine | undefined)?.command)) {
    if (original) settings.statusLine = original; else delete settings.statusLine;
    writeSettings(settings);
  }
  writeBackup({ off: true });
}

// plugin 更新後安裝路徑會變；SessionStart 時把指令指回目前的版本。使用者自己換掉了就記成 off，不再碰
export function repointStatusline() {
  if (!statuslineInstalled()) return;
  const settings = readSettings(), current = settings.statusLine as StatusLine | undefined;
  if (!isOurs(current?.command)) return writeBackup({ off: true });
  if (current?.command === ourCommand()) return;
  settings.statusLine = { ...current, command: ourCommand() };
  writeSettings(settings);
}
