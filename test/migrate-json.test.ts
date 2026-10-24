import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { Fixtures } from './support/fixtures.ts';
import { scenario } from './support/scenario.ts';
import { DATA_DIR, DB_FILE } from './support/system.ts';

const progressMarkdown = (first: string, second: string) => `# 客戶訂閱 — Task 計畫

> 進度：Task 02 · 3／4 · 🔵 重構：等使用者決定

### Task 0: 測試基礎建設
- [x] **已完成：** \`ConfigureServices\`、\`Scenario\`

### Task 2: GrantPromotional
- [${first}] **Step 1: 紅 → 綠** — \`R10_建立試用\`
- [${second}] **Step 2: 紅 → 綠** — \`R10_記錄給予人\`
- [ ] **Step 3: 紅 → 綠** — \`R10_管理員全勾\`
- [ ] **Step 4: 紅 → 綠** — \`R11_拒絕\`
`;

function legacyJsonRepo() {
  const S = scenario();
  const commitPlan = (first: string, second: string, message: string) => {
    S.w('docs/plans/p.md', progressMarkdown(first, second));
    S.g('add', '.');
    S.g('commit', '-qm', message);
  };
  commitPlan(' ', ' ', 'docs: 計畫');
  commitPlan('x', ' ', 'test: R10_建立試用');
  const checkedSha = S.g('rev-parse', 'HEAD');
  commitPlan('x', 'x', 'test: R10_記錄給予人');
  S.w(`${DATA_DIR}/plan.json`, { schemaVersion: 1, feature: Fixtures.客戶訂閱, planPath: 'docs/plans/p.md', tasks: [
    { id: '00', title: '測試基礎建設', tests: [{ name: 'ConfigureServices' }, { name: 'Scenario' }] },
    { id: '02', title: 'GrantPromotional', layer: 'use case', tests: [{ name: 'R10_建立試用', rule: 'R10' }, { name: 'R10_記錄給予人' }, { name: 'R10_管理員全勾' }, { name: 'R11_拒絕' }] }] });
  S.w(`${DATA_DIR}/state.json`, { schemaVersion: 1, feature: Fixtures.客戶訂閱, stage: 'tdd', tdd: { task: '02', test: 3, phase: 'refactor', title: '管理員全勾', story: '管理員每間門市都要有' },
    roundtable: { state: 'TASK_BREAKDOWN', scale: '標準', decisions: [{ id: 'd1', question: 'A？', options: [{ label: 'A', by: 'Fowler' }], freeText: true, answer: 'A' }] } });
  S.w(`${DATA_DIR}/roundtable/01-discover.json`, { kind: 'discover', summary: '現況' });
  return { S, checkedSha };
}

const readJson = (repo: string, file: string) => JSON.parse(fs.readFileSync(path.join(repo, DATA_DIR, file), 'utf8'));
const legacyFiles = ['state.json', 'plan.json', 'roundtable/01-discover.json'];

describe('遷移', () => {
  test('R43 舊plan json與md_匯入成目前功能並停在md進度行', () => {
    const { S } = legacyJsonRepo();
    S.ok(['migrate']);
    const v = S.view();
    assert.deepEqual([v.state.feature, v.state.tdd.task, v.state.tdd.test, v.state.tdd.phase, v.state.tdd.story], [Fixtures.客戶訂閱, '02', 3, 'refactor', '管理員每間門市都要有']);
    assert.deepEqual(v.plan.tasks.map((t: any) => t.tests.map((x: any) => x.done)), [[true, true], [true, true, false, false]]);
    assert.equal(v.roundtable[0].summary, '現況');
    assert.equal(v.state.roundtable.decisions[0].answer, 'A');
    assert.equal(S.ok(['progress']), `${Fixtures.客戶訂閱} · Task 02 · 3／4 · 🔵 重構：等使用者決定`);
  });

  test('R43 目前位置以md進度行為準_完成時功能標成完成', () => {
    const { S } = legacyJsonRepo();
    S.w(`${DATA_DIR}/state.json`, { ...readJson(S.repo, 'state.json'), tdd: { task: '00', test: 1, phase: 'red' } });
    S.ok(['migrate']);
    const t = S.view().state.tdd;
    assert.deepEqual([t.task, t.test, t.phase], ['02', 3, 'refactor']);

    const done = legacyJsonRepo().S;
    const finished = fs.readFileSync(path.join(done.repo, 'docs/plans/p.md'), 'utf8').replace(/> 進度：.*/, '> 進度：完成').replaceAll('- [ ]', '- [x]');
    done.w('docs/plans/p.md', finished);
    done.ok(['migrate']);
    assert.equal(done.view().state.done, true);
  });

  test('R44 名稱對不上或重名_整個失敗且不留DB', () => {
    const { S } = legacyJsonRepo();
    const plan = readJson(S.repo, 'plan.json');
    plan.tasks[1].tests[0].name = 'R10_舊名稱';
    plan.tasks[0].tests[1].name = 'ConfigureServices';
    S.w(`${DATA_DIR}/plan.json`, plan);
    const err = S.rejected(['migrate']);
    assert.match(err, /R10_舊名稱/);
    assert.match(err, /重名測試：ConfigureServices/);
    assert.deepEqual(fs.readdirSync(path.join(S.repo, DATA_DIR)).filter(f => f.startsWith(DB_FILE)), []);
  });

  test('R45 已勾選沒有history_綁勾成x的commit為推測', () => {
    const { S, checkedSha } = legacyJsonRepo();
    S.ok(['migrate']);
    const c = S.view().history['02-01'].commit;
    assert.deepEqual([c.sha, c.inferred, c.subject], [checkedSha.slice(0, 7), true, 'test: R10_建立試用']);
  });

  test('R46 DB已存在_拒絕', () => {
    const { S } = legacyJsonRepo();
    S.ok(['migrate']);
    S.rejected(['migrate'], undefined, new RegExp(`已經有 ${DB_FILE}`));
  });

  test('R47 遷移後舊檔不動', () => {
    const { S } = legacyJsonRepo();
    const read = () => legacyFiles.map(f => fs.readFileSync(path.join(S.repo, DATA_DIR, f), 'utf8'));
    const before = read();
    S.ok(['migrate']);
    assert.deepEqual(read(), before);
    assert.equal(S.g('status', '--porcelain'), '');
  });
});
