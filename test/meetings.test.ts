import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { describe, test } from 'node:test';
import { Fixtures } from './support/fixtures.ts';
import { scenario, type Scenario } from './support/scenario.ts';
import { CLI, openStore } from './support/system.ts';

// maester open 會先建好空的 maester.db；測試不起伺服器，直接建
const emptyDb = (S: Scenario) => openStore(S.repo, { write: true })!.close();

function onStore<T>(S: Scenario, work: (db: any) => T): T {
  const db = S.db();
  try { return work(db); } finally { db.close(); }
}

const pendingTypes = (S: Scenario) => S.view().pending.map((e: any) => e.type);

describe('網頁上的會議', () => {
  test('新建會議_成為目前功能並留下start_council給AI', () => {
    const S = scenario();
    emptyDb(S);
    const { feature } = onStore(S, db => db.startFromPage(` ${Fixtures.客戶訂閱} `));
    assert.equal(S.view().featureId, feature);
    assert.equal(S.view().state.feature, Fixtures.客戶訂閱);
    assert.deepEqual(pendingTypes(S), ['start_council']);
  });

  test('沒有名稱_拒絕', () => {
    const S = scenario();
    S.start();
    assert.throws(() => onStore(S, db => db.startFromPage('  ')), /需要功能名稱/);
  });

  test('繼續未完成的會議_換成目前功能並留下resume', () => {
    const S = scenario();
    const first = S.start();
    S.start(Fixtures.門市權限);
    onStore(S, db => db.resumeFromPage(first));
    assert.equal(S.view().featureId, first);
    assert.deepEqual(pendingTypes(S), ['resume']);
  });
});

describe('maester stop', () => {
  test('還沒有會議也能等_stop之後wait自己結束', async () => {
    const S = scenario();
    emptyDb(S);
    const wait = spawn(process.execPath, [CLI, 'wait'], { cwd: S.repo, env: process.env });
    let out = '';
    wait.stdout.on('data', chunk => { out += chunk; });
    const exited = new Promise(resolve => wait.on('exit', resolve));
    await new Promise(resolve => setTimeout(resolve, 500));
    S.ok(['stop']);
    assert.equal(await exited, 0);
    assert.deepEqual(JSON.parse(out), { stopped: true });
  });
});
