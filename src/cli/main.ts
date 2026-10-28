import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { messageOf, reject } from '../core/errors.ts';
import { dataDir, dbPath, hasLegacyJson, port } from '../core/paths.ts';
import { openStore, type Store } from '../core/store.ts';
import { migrateLegacyJson } from '../migrate/legacy-json.ts';
import { adoptLegacyData, adoptLegacyHome } from '../migrate/legacy-workbench.ts';
import { ensureServer, openerFor, ping, postAgent } from '../server/client.ts';
import { statuslineFromTranscript } from '../server/agent.ts';
import { addProject, readKey } from '../server/projects.ts';
import { autoInstallStatusline, originalCommand, repointStatusline, uninstallStatusline } from '../server/statusline.ts';
import { repoRoot } from '../view/git.ts';
import { progressLine } from '../view/progress.ts';
import { openEventsReminder, showText } from '../view/show.ts';
import { WRITE_COMMANDS } from './commands.ts';
import { excludeFromGit, prepareRepo } from './prepare-repo.ts';

const WAIT_INTERVAL_MS = 1000;
const USAGE_EXIT_CODE = 2;
const ORPHANING_SOURCES = new Set(['startup', 'resume', 'clear']);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const requireRepo = (repo: string | null) => repo ?? reject('不在 git repo 裡');
const workbenchUrl = (repo: string) => `http://127.0.0.1:${port()}/?key=${readKey()}&repo=${encodeURIComponent(repo)}`;

function withStore<T>(repo: string | null, work: (store: Store) => T, { write = true } = {}): T {
  const root = requireRepo(repo);
  if (write) prepareRepo(root);
  const store = openStore(root, { write }) ?? reject('這個 repo 還沒有 maester.db');
  try { return work(store); } finally { store.close(); }
}

async function ensure(repo: string | null, isHook: boolean) {
  // 只在 Claude Code 的 plugin hook 裡自動接 statusline：Codex 與測試不帶這兩個變數
  try {
    if (isHook && process.env.CLAUDECODE && process.env.CLAUDE_PLUGIN_ROOT) autoInstallStatusline();
    repointStatusline();
  } catch {}
  await ensureServer();
  if (repo && (!isHook || fs.existsSync(dataDir(repo)))) addProject(repo);
  if (!isHook || !repo || !fs.existsSync(dbPath(repo))) return;
  // A new process (startup/resume/clear, not compact) means the session that claimed a processing event is gone.
  if (ORPHANING_SOURCES.has(hookSource())) withStore(repo, store => store.requeueProcessing());
  // The hook's stdout becomes session context: without it a new session never learns the page is waiting on it.
  const reminder = openEventsReminder(repo);
  if (reminder) console.log(reminder);
}

function hookSource(): string {
  if (process.stdin.isTTY) return '';
  try { return String(JSON.parse(fs.readFileSync(0, 'utf8')).source ?? ''); }
  catch { return ''; }
}

async function open(repo: string | null) {
  const root = requireRepo(repo);
  prepareRepo(root);
  // 先建好 maester.db：還沒有會議時 maester wait 也要能等網頁的「新建會議」
  if (!hasLegacyJson(root)) withStore(root, () => null);
  await ensureServer();
  const url = workbenchUrl(root);
  if ((await ping())?.clients?.[root]) return console.log(`已經開著：${url}`);
  console.log(url);
  const opener = openerFor(process.platform, url);
  try { execFileSync(opener.command, opener.args, { stdio: 'ignore' }); }
  catch { console.error('沒有辦法自動開啟瀏覽器，請手動打開上面的網址。'); }
}

async function waitForEvent(repo: string | null) {
  if (!repo || !fs.existsSync(dbPath(repo))) reject('這個 repo 還沒有 maester.db');
  const startedAt = new Date().toISOString();
  for (;;) {
    const event = withStore(repo, store => store.stoppedAt() > startedAt ? { stopped: true } : store.claim(), { write: false });
    if (event) return console.log(JSON.stringify(event));
    await sleep(WAIT_INTERVAL_MS);
  }
}

const TRANSCRIPT_TAIL_BYTES = 1_000_000;
const readStdin = () => process.stdin.isTTY ? '' : fs.readFileSync(0, 'utf8');

function tailOf(file: string) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size, start = Math.max(0, size - TRANSCRIPT_TAIL_BYTES), buffer = Buffer.alloc(size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    return buffer.toString('utf8');
  } finally { fs.closeSync(fd); }
}

// agent 資訊只轉給 server 放在記憶體，不寫 DB
async function forwardStatusline(text: string) {
  let workspace: { project_dir?: string; current_dir?: string } = {};
  try { workspace = JSON.parse(text).workspace ?? {}; } catch { return; }
  // 不在 repo 裡也送：server 要從任何 session 拿帳號的 5h／週用量
  const repo = repoRoot(workspace.project_dir || workspace.current_dir || process.cwd());
  await postAgent(repo ?? '', readKey(), text);
}

// SDK／stream-json 模式不跑 statusline，所以 hook 一律從 transcript 估 context；statusline 剛回報過時 server 會忽略這份
async function forwardHook() {
  const input = JSON.parse(readStdin() || '{}');
  const repo = repoRoot(input.cwd || process.cwd());
  if (!repo || !fs.existsSync(dataDir(repo)) || !input.transcript_path) return;
  const info = statuslineFromTranscript(tailOf(input.transcript_path));
  if (info) await postAgent(repo, readKey(), JSON.stringify({ ...info, source: 'hook' }));
}

// 頁面按「顯示用量」後的 statusline：先轉給 server，再照跑使用者原本的指令；沒有就印進度
async function statusline(repo: string | null, args: string[]) {
  if (args.includes('--uninstall')) {
    uninstallStatusline();
    return console.log('已還原原本的 statusline');
  }
  const text = readStdin();
  await forwardStatusline(text);
  const command = originalCommand();
  if (command) {
    // Claude Code 在 Windows 用 Git Bash 跑 statusline，原本的指令是 bash 語法；shell: true 會交給 cmd.exe 而跑不出來
    const shell = process.platform === 'win32' ? process.env.CLAUDE_CODE_GIT_BASH_PATH || 'bash' : true;
    spawnSync(command, { shell, input: text, stdio: ['pipe', 'inherit', 'inherit'] });
    return;
  }
  const line = repo ? progressLine(repo) : '';
  if (line) console.log(line);
}

function locateRepo() {
  adoptLegacyHome();
  const repo = repoRoot(process.cwd());
  if (repo && adoptLegacyData(repo) === 'copied') excludeFromGit(repo);
  return repo;
}

async function run([command, ...args]: string[]) {
  const repo = locateRepo();
  const write = WRITE_COMMANDS[command];
  if (write) return console.log(JSON.stringify(withStore(repo, store => write(store, args, requireRepo(repo)))));
  switch (command) {
    case 'ensure': return ensure(repo, args.includes('--hook'));
    case 'open': return open(repo);
    case 'url': return console.log(workbenchUrl(requireRepo(repo)));
    case 'progress': {
      const line = repo ? progressLine(repo) : '';
      if (line) console.log(line);
      return;
    }
    case 'show': return console.log(repo ? showText(repo) : '不在 git repo 裡');
    case 'migrate': return console.log(JSON.stringify(migrateLegacyJson(requireRepo(repo))));
    case 'wait': return waitForEvent(repo);
    case 'agent': return args.includes('--hook') ? forwardHook() : forwardStatusline(readStdin());
    case 'statusline': return statusline(repo, args);
    default:
      console.log('用法見 skills/open/references/state-spec.md');
      process.exitCode = USAGE_EXIT_CODE;
  }
}

export async function main(argv: string[]) {
  const isHook = argv.includes('--hook');
  try { await run(argv); }
  catch (error) {
    if (isHook) return;
    console.error(messageOf(error));
    process.exitCode = 1;
  }
}
