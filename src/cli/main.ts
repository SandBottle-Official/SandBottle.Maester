import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { messageOf, reject } from '../core/errors.ts';
import { dataDir, dbPath, port } from '../core/paths.ts';
import { openStore, type Store } from '../core/store.ts';
import { migrateLegacyJson } from '../migrate/legacy-json.ts';
import { adoptLegacyData, adoptLegacyHome } from '../migrate/legacy-workbench.ts';
import { ensureServer, openerFor, ping } from '../server/client.ts';
import { addProject, readKey } from '../server/projects.ts';
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
  for (;;) {
    const event = withStore(repo, store => store.claim(), { write: false });
    if (event) return console.log(JSON.stringify(event));
    await sleep(WAIT_INTERVAL_MS);
  }
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
    default:
      console.log('用法見 skills/chain/references/state-spec.md');
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
