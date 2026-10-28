import path from 'node:path';
import { hasLegacyJson } from '../core/paths.ts';
import { openStore, type Store } from '../core/store.ts';
import type { FeatureRow, PlannedTestOut } from '../core/types.ts';
import { PLUGIN_ROOT } from '../server/protocol.ts';
import { phaseLine, type RedBy, STAGE_LABEL } from '../core/vocabulary.ts';

function otherFeaturesLine(store: Store) {
  const others = store.features().filter(f => !f.current);
  return others.length ? [`其他功能：${others.map(f => `${f.id} ${f.name}（${f.stage === 'done' ? '已完成' : '未完成'}）`).join('、')}`] : [];
}

function decisionLines(store: Store, feature: FeatureRow) {
  const decisions = store.decisions(feature.id);
  return decisions.length ? ['', '## 決策題', ...decisions.map(d => `- ${d.id} ${d.question} → ${d.answer ?? '（未回答）'}`)] : [];
}

function latestDocLines(store: Store, feature: FeatureRow) {
  const latestByKind = new Map(store.docs(feature.id).map(d => [d.kind, d]));
  if (!latestByKind.size) return [];
  return ['', '## 各種類最新的圓桌文件', ...[...latestByKind.values()].map(({ file, ...doc }) => `- ${file}：${JSON.stringify(doc)}`)];
}

function testLine(test: PlannedTestOut, redBy: RedBy) {
  const step = test.step;
  const marker = step?.completed_at ? '- [x]' : step ? '→ [ ]' : '- [ ]';
  const phase = step?.phase && !step.completed_at ? ` · ${phaseLine(step.phase, redBy)}` : '';
  const problem = step?.problem && !step.completed_at ? ` · ⚠ 等使用者調整：${JSON.parse(step.problem).title}` : '';
  return `${marker} ${test.name}（${test.id}）${phase}${problem}`;
}

// 每個主題只印最新一筆：那是現在要照著寫的；歷史留在 DB
function adaptationLines(store: Store) {
  const latest = [...new Map(store.adaptations().map(a => [a.topic, a])).values()];
  return latest.length ? ['', '## 使用者的寫法（Maester 已照著調整，之後的測試與範例都照這個）',
    ...latest.map(a => `- ${a.topic}：${a.user}（原本：${a.maester}${a.why ? `；因為 ${a.why}` : ''}）`)] : [];
}

function planLines(store: Store, feature: FeatureRow) {
  const plan = store.plan(feature.id);
  if (!plan.length) return [];
  const redBy = store.redBy();
  return ['', `## Task（[x] 完成、→ 目前步驟；括號內是測試 id）· 紅燈測試：${redBy === 'user' ? '使用者自己寫（AI 只給名稱、行為與片段，不寫檔）' : 'AI 自動寫'}`,
    ...plan.flatMap(task => [`### Task ${task.id} — ${task.title}`, ...task.tests.map(t => testLine(t, redBy))])];
}

function openEventLines(store: Store, feature: FeatureRow) {
  const open = [...store.events(feature.id, 'processing'), ...store.events(feature.id, 'pending')];
  return open.length ? ['', '## 未完成的網頁事件', ...open.map(e => `- ${e.id} ${e.type}（${e.status === 'processing' ? '處理中' : '待處理'}）`)] : [];
}

export function openEventsReminder(repo: string): string {
  const store = openStore(repo);
  if (!store) return '';
  try {
    const feature = store.current();
    const lines = feature ? openEventLines(store, feature) : [];
    if (!lines.length) return '';
    return [`Maester：「${feature!.name}」有網頁事件在等 AI，網頁會鎖住直到處理完。先在背景執行 \`node "${path.join(PLUGIN_ROOT, 'bin/maester.mjs')}" wait\` 領取，照 state spec 處理後 \`maester done <事件 id>\`。`,
      ...lines.slice(2)].join('\n');
  } finally { store.close(); }
}

export function showText(repo: string): string {
  const store = openStore(repo);
  if (!store) return hasLegacyJson(repo) ? '這個 repo 還是舊的 json 紀錄，先執行 maester migrate。' : '這個 repo 還沒有 Maester 紀錄。';
  try {
    const feature = store.current();
    if (!feature) return '還沒有功能。';
    return [
      `# 功能 ${feature.id}：${feature.name}（${STAGE_LABEL[feature.stage]}）`,
      ...otherFeaturesLine(store),
      ...adaptationLines(store),
      '', `## 圓桌：${feature.rt_state ?? '—'}${feature.scale ? ` · ${feature.scale}` : ''}`, feature.rt_note ?? '',
      ...decisionLines(store, feature),
      ...latestDocLines(store, feature),
      ...planLines(store, feature),
      ...openEventLines(store, feature),
    ].join('\n');
  } finally { store.close(); }
}
