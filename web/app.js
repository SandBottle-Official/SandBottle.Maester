import { createComposer } from './composer.js';
/** @typedef {import('../src/view/types.ts').View & { error?: string, agent?: import('../src/server/agent.ts').AgentInfo | null, statusline?: boolean }} View */
const params = new URLSearchParams(location.search);
const KEY = params.get('key') || '';
const REPO = params.get('repo'), FEATURE = params.get('feature');
const composer = REPO ? createComposer({ onSubmit: text => send('prompt', { text }) }) : null;
// 新建會議的輸入框：第一行當會議名稱，整段交給 AI 當 Discover 的需求
const meetingComposer = REPO ? createComposer({ onSubmit: text => meeting('start', { text }), placeholder: '要討論的功能：第一行當會議名稱，下面寫需求、限制與想法…', label: '新會議要討論的功能', id: 'meeting-input' }) : null;
const q = `key=${encodeURIComponent(KEY)}&repo=${encodeURIComponent(REPO)}${FEATURE ? `&feature=${encodeURIComponent(FEATURE)}` : ''}`;
const app = document.getElementById('app');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const keyOf = (task, test) => `${pad(+task)}-${pad(+test)}`;
const LAYER = { 'use case': 'uc', 契約: 'ct', contract: 'ct', 整合: 'ct' };
const RT_STAGES = [['DISCOVER', '探索'], ['ROUND', '圓桌會議'], ['CODEX_REVIEW', '對抗式審查'], ['CANDIDATE_DESIGNS', '候選方案'], ['USER_DIRECTION', '你選方案'],
  ['DECISION_TABLE', 'Decision Table'], ['OPEN_QUESTIONS', 'Open Questions'], ['FINAL_CODEX_REVIEW', '最終對抗式審查'], ['USER_APPROVAL', '你同意設計'], ['TASK_BREAKDOWN', '拆 Task']];

/** @type {View | null} */
let view = null;
let connected = false;
// 使用者在看哪裡：mode 'tdd' | 'rt'；rt 是畫布上的圓桌階段（null 表示目前階段）；task 是畫布上的 Task；step 是右側的測試（null 表示目前這一步）
const ui = { mode: null, task: null, step: null, rt: null, tab: 'test', draft: {}, unlocked: new Set(), folds: {} };
ui.roadOpen = false; // draft：還沒送出的裁決 { 題目 id: { value, free } }；roadOpen：左側抽屜

/* ---------- theme ---------- */
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('maester-theme', t); } catch {}
  render();
}

/* ---------- code highlight（Shiki + T3 Code 的 Pierre 主題；載不到就純文字） ---------- */
let shiki = null;
const themes = {};
async function highlighter() {
  if (shiki !== null) return shiki;
  try {
    const mod = await import('https://cdn.jsdelivr.net/npm/shiki@4.5.0/+esm');
    for (const n of ['pierre-dark', 'pierre-light']) themes[n] = await (await fetch(`themes/${n}.json`)).json();
    shiki = mod;
  } catch { shiki = false; }
  return shiki;
}
async function highlightAll() {
  const blocks = /** @type {NodeListOf<HTMLElement>} */ (app.querySelectorAll('.code[data-raw]'));
  if (!blocks.length) return;
  const s = await highlighter();
  if (!s) return;
  const theme = themes[document.documentElement.dataset.theme === 'violet' ? 'pierre-light' : 'pierre-dark'];
  for (const b of blocks) {
    try {
      const box = b.querySelector('.body');
      box.innerHTML = await s.codeToHtml(b.dataset.raw, { lang: b.dataset.lang || 'text', theme });
      const added = (b.dataset.added || '').split(',').filter(Boolean).map(Number);
      box.querySelectorAll('.line').forEach((l, i) => added.includes(i + 1) && l.classList.add('add'));
    } catch {}
  }
}
function codeBlock(label, c) {
  if (!c?.code) return '';
  const added = (c.added || []).filter(Number.isInteger);
  return `<div class="code" data-raw="${esc(c.code)}" data-lang="${esc(c.lang)}" data-added="${esc(added.join(','))}">
    <div class="bar"><span title="${esc(label)}">${esc(label)}</span><button class="copy">複製</button></div>
    <div class="body"><pre>${c.code.split('\n').map((l, i) => `<span class="ln${added.includes(i + 1) ? ' add' : ''}">${esc(l) || ' '}</span>`).join('')}</pre></div></div>`;
}

/* ---------- events → inbox ---------- */
async function send(type, payload) {
  const s = view.state, ctx = { stage: s?.stage, test: s?.tdd?.testId, phase: s?.tdd?.phase };
  const r = await fetch(`/api/event?repo=${encodeURIComponent(REPO)}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-maester-key': KEY }, body: JSON.stringify({ type, payload, feature: view.featureId, ctx }) });
  if (r.ok) return '';
  const why = r.status === 403 ? '金鑰不對：請用 maester open 開啟的網址' : (await r.json().catch(() => ({}))).error || `送出失敗（${r.status}）`;
  const b = document.querySelector('.acts .next span'); if (b) b.textContent = why;
  return why;
}
// 新建或接續會議：伺服器換好目前功能、留事件給 AI，畫面回到目前功能；失敗時回傳原因
let resumeNote = '';
async function meeting(path, body) {
  const r = await fetch(`/api/${path}?repo=${encodeURIComponent(REPO)}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-maester-key': KEY }, body: JSON.stringify(body) });
  if (r.ok) { params.delete('feature'); location.search = params.toString(); return ''; }
  return (await r.json().catch(() => ({}))).error || `失敗（${r.status}）`;
}
const featureHref = f => { const p = new URLSearchParams(params); if (f.current) p.delete('feature'); else p.set('feature', f.id); return `?${p}`; };
const newMeetingButton = () => `<button class="primary new-meeting" data-new-meeting>新建會議</button>`;
function meetings(v) {
  const list = (v.features || []).map(f => `<li><a href="${esc(featureHref(f))}" class="${f.id === v.featureId ? 'on' : ''}"><span class="nm">${esc(f.name)}</span><span class="n">${f.current ? '目前' : f.stage === 'done' ? '已完成' : ''}</span></a>
    ${!f.current && f.stage !== 'done' ? `<button class="link resume" data-resume="${f.id}">繼續這個會議</button>` : ''}</li>`).join('');
  return `<h2>會議</h2>${list ? `<ul>${list}</ul>` : ''}${resumeNote ? `<p class="note resume-note">${esc(resumeNote)}</p>` : ''}${newMeetingButton()}`;
}
const meetingModal = () => `<div class="scrim" data-close-meeting></div><div class="modal" role="dialog" aria-modal="true" aria-labelledby="meeting-title">
  <div class="modal-head"><h2 id="meeting-title">新建會議</h2><button class="icon" data-close-meeting aria-label="關閉">✕</button></div>
  <p class="note">寫下要討論的功能，AI 會召開臨時動議。第一行會當成會議名稱。</p><div class="modal-body"></div></div>`;

const LABEL = { answer: '回答', approve_design: '設計確定', tests_ran: '跑測試', hint: '提示', help_green: '幫我寫綠燈', refactor_done: '重構好了', refactor_skip: '跳過重構', next_round: '下一輪', prompt: '你的訊息', red_written: '測試寫好了', start_council: '新建會議', resume: '繼續會議' };
// 送出後到 AI 處理完之前按鈕都鎖住；AI 中斷時可以「解除鎖定」重按
const inFlight = v => [...(v.processing || []), ...(v.pending || [])].filter(e => !ui.unlocked.has(e.id));
function busy(v) {
  if (v.readonly) return v.state?.done ? '這個功能已完成，只能查看' : '這不是目前功能，只能查看';
  const e = inFlight(v)[0];
  return e ? `AI 正在處理「${LABEL[e.type] || e.type}」` : '';
}
// 處理中時，dock 換成這一列；面板頂端另有一條進度線
function busyRow(v) {
  const list = inFlight(v);
  if (!list.length) return '';
  const e = list[0], waiting = e.status === 'pending';
  return `<div class="busy" role="status"><span class="spinner" aria-hidden="true"></span>
    <div class="busy-text"><b>${waiting ? '已送出，等 AI 接手' : 'AI 正在處理'}「${esc(LABEL[e.type] || e.type)}」</b>${list.length > 1 ? `<span>後面還有 ${list.length - 1} 件</span>` : ''}</div>
    <button class="link" data-unlock="${esc(list.map(x => x.id).join(','))}" title="AI 中斷、按鈕一直鎖著時用">解除鎖定</button></div>`;
}
const busyBar = v => inFlight(v).length ? '<div class="busybar" aria-hidden="true"></div>' : '';
// dock：固定在右欄底部，放這一步的動作；處理中時換成狀態列
// note 只放鎖定原因或送出失敗；流程說明放在按鈕的 title
const dock = (v, acts, note = '') => `<div class="dock">${busyRow(v) || `<div class="acts">${acts}</div>${note ? `<p class="dock-note">${esc(note)}</p>` : ''}`}</div>`;

/* ---------- 位置：完成與否看完成紀錄，不看排在目前步驟前後 ---------- */
function position(v) {
  const tasks = v.plan?.tasks || [], s = v.state?.tdd;
  const ti = s ? tasks.findIndex(t => +t.id === +s.task) : -1;
  return { tasks, ti, cur: s, status(taskIdx, testNo) {
    if (tasks[taskIdx]?.tests[testNo - 1]?.done) return 'done';
    return taskIdx === ti && testNo === +s.test ? 'current' : 'todo';
  } };
}
const commitNote = c => !c ? '' : c.missing ? '（commit 已不存在）' : c.inferred ? '（推測）' : '';

/* ---------- pieces ---------- */
function topBar(v, phase, P) {
  const dark = document.documentElement.dataset.theme !== 'violet';
  const title = v.state?.feature || v.plan?.feature || v.name;
  const task = P?.tasks[P.ti], doneN = task ? task.tests.filter((_, j) => P.status(P.ti, j + 1) === 'done').length : 0;
  return `<header class="top">
    <button class="icon" data-road-toggle aria-label="${ui.roadOpen ? '關閉清單' : '打開清單'}" aria-expanded="${ui.roadOpen}" title="臨時動議與 Task 清單"><svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2.5 4h11M2.5 8h11M2.5 12h11"/></svg></button>
    <span class="mark"><img src="brand/mark-${dark ? 'dark' : 'light'}.svg" width="22" height="22" alt="">Maester</span>
    <h1 title="${esc(title)}">${esc(title)}</h1>
    ${v.features?.length > 1 ? `<select class="btn" data-feature aria-label="切換功能">${v.features.map(f => `<option value="${f.id}" ${f.id === v.featureId ? 'selected' : ''}>${esc(f.name)}${f.current ? '（目前）' : f.stage === 'done' ? '（已完成）' : ''}</option>`).join('')}</select>` : ''}
    ${task && phase ? `<span class="where-chip">Task ${esc(task.id)}<span class="meter" aria-label="${doneN}／${task.tests.length} 完成">${task.tests.map((_, j) => `<i class="${P.status(P.ti, j + 1) === 'done' ? 'd' : j + 1 === +P.cur.test ? 'c' : ''}"></i>`).join('')}</span>${doneN}／${task.tests.length}</span>` : ''}
    <div class="right">
      ${agentChip(v.agent)}${usageButton(v)}
      <span class="sync ${connected ? '' : 'off'}" title="${connected ? '已同步' : 'server 斷線，重連中'}"><span class="dot"></span>${connected ? '已同步' : '重連中'}</span>
      <button class="icon" data-theme-to="${dark ? 'violet' : 'dark'}" aria-label="${dark ? '切換成白紫主題' : '切換成深色主題'}" title="${dark ? '白紫' : '深色'}">${dark
        ? '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1"/></svg>'
        : '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 9.5A5.5 5.5 0 1 1 6.5 3a4.5 4.5 0 0 0 6.5 6.5Z"/></svg>'}</button>
    </div></header>`;
}

const pct = n => `${Math.round(n)}%`;
const resetAt = w => w?.resetsAt ? `，${new Date(w.resetsAt * 1000).toLocaleString('zh-Hant', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 重置` : '';
// agent 資訊來自 statusline（maester agent），只在 server 記憶體
const kTokens = n => n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
// 用量要靠 statusline；沒接上時給一顆按鈕，按了才改 Claude Code 設定
const usageButton = v => v.statusline || v.readonly ? '' : `<button class="link" data-statusline title="你還原或換掉了 statusline，所以沒有用量；按這裡重新接上，原本的 statusline 照常顯示">${esc(statuslineNote || '顯示用量')}</button>`;
let statuslineNote = '';
// 跟 statusline 一樣：用量分級上色，重置倒數直接寫在數字旁
const usageLevel = used => used >= 80 ? 'bad' : used >= 50 ? 'warn' : 'ok';
function untilReset(w) {
  if (!w?.resetsAt) return '';
  const m = Math.max(0, Math.round((w.resetsAt * 1000 - Date.now()) / 60000)), d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60);
  return d ? `${d}d${h}h` : h ? `${h}h${m % 60}m` : `${m}m`;
}
function agentChip(a) {
  if (!a) return '';
  // 借來的用量標 ~，提示是其他 session 回報的、可能不是最新
  const borrowed = a.limitsAt ? `；${Math.round((Date.now() - a.limitsAt) / 60000)} 分鐘前取自其他 session 的 statusline` : '';
  const usage = (k, w, label) => w && `<span class="usage ${usageLevel(w.used)}${borrowed ? ' borrowed' : ''}" title="${esc(`${label}${resetAt(w)}${borrowed}`)}">${k}<i class="bar"><i style="width:${Math.min(100, Math.max(0, w.used))}%"></i></i><span>${borrowed ? '~' : ''}${pct(w.used)}</span>${untilReset(w) ? `<small>${untilReset(w)}</small>` : ''}</span>`;
  const context = a.context != null ? `<span class="ctx" title="${esc(a.contextSize ? `context window ${a.contextSize.toLocaleString()} tokens` : 'context')}">context ${pct(a.context)}</span>`
    : a.contextTokens != null ? `<span class="ctx" title="這一輪送進模型的 token 數；沒有 statusline，所以不知道 context 上限">context ${kTokens(a.contextTokens)} tokens</span>` : '';
  const cost = a.cost != null ? `<span title="這個 session 的花費（USD）">$${a.cost.toFixed(2)}</span>` : '';
  const ago = Math.round((Date.now() - a.at) / 60000);
  return `<span class="agent-chip" title="${esc(`${a.model || 'agent'} · ${ago ? `${ago} 分鐘前更新` : '剛更新'}`)}">${a.model ? `<b>${esc(a.model)}</b>` : ''}${context}${usage('5h', a.fiveHour, '5 小時用量') || ''}${usage('週', a.sevenDay, '週用量') || ''}${cost}</span>`;
}

function road(v, P) {
  const rtState = v.state?.roundtable?.state, rtIdx = RT_STAGES.findIndex(([k]) => k === rtState);
  const rtOver = v.state?.stage === 'tdd';
  const rtItems = RT_STAGES.map(([k, n], i) => {
    const done = rtOver || i < rtIdx, on = ui.mode === 'rt' && k === (ui.rt ?? rtState);
    return `<li><a href="#" data-rt="${k}" class="${on ? 'on' : ''}${!done && i !== rtIdx ? ' later' : ''}"><span class="nm">${n}</span><span class="n">${done ? '完成' : i === rtIdx ? '進行中' : ''}</span></a></li>`;
  }).join('');
  const tdd = P.tasks.map((t, i) => {
    const done = t.tests.filter((_, j) => P.status(i, j + 1) === 'done').length;
    return `<li><a href="#" data-task="${esc(t.id)}" class="${ui.mode === 'tdd' && +t.id === +ui.task ? 'on' : ''}" title="${esc(t.title)}"><span class="nm"><span class="id">${esc(t.id)}</span>${esc(t.title)}</span><span class="n">${done}／${t.tests.length}</span></a></li>`;
  }).join('');
  return `<div class="scrim" data-road-toggle></div><nav class="drawer" aria-label="臨時動議與 Task 清單">
    <p class="drawer-repo">${esc(v.name)} · <code>${esc(v.branch)}</code></p>
    ${meetings(v)}
    ${v.roundtable.length || rtState ? `<h2>臨時動議</h2><ul>${rtItems}</ul>` : ''}
    ${P.tasks.length ? `<h2>TDD</h2><ul>${tdd}</ul>` : ''}
    ${yourWay(v)}
    ${v.greens.total ? `<div class="mine"><p class="big">${v.greens.user}／${v.greens.total}</p><p>${v.greens.user === v.greens.total ? '到目前為止的綠燈，都是你親手寫的。' : `其中 ${v.greens.total - v.greens.user} 輪由 AI 代寫。`}</p></div>` : ''}
  </nav>`;
}

// 每個主題最新一筆在上面，展開看調整歷史與臨時動議
function yourWay(v) {
  const topics = new Map();
  for (const a of v.adaptations || []) topics.set(a.topic, [...(topics.get(a.topic) || []), a]);
  if (!topics.size) return '';
  const item = a => `<p>${esc(a.user)}</p><p class="was">原本：${esc(a.maester)}</p>${a.why ? `<p class="was">因為 ${esc(a.why)}</p>` : ''}
    ${a.council?.length ? `<p class="was">臨時動議</p>${a.council.map(c => `<div class="say"><span class="who">${esc(c.who)}</span> ${esc(c.text)}</div>`).join('')}` : ''}`;
  return `<h2>你的寫法</h2><div class="way">${[...topics].map(([topic, list]) => {
    const now = list.at(-1), before = list.slice(0, -1).reverse();
    return `<details><summary><b>${esc(topic)}</b>${list.length > 1 ? `<span class="n">調整 ${list.length} 次</span>` : ''}</summary>${item(now)}
      ${before.map(a => `<div class="earlier">${item(a)}</div>`).join('')}</details>`;
  }).join('')}</div>`;
}

function linkState(v, P, taskIndex, testNo) {
  const status = P.status(taskIndex, testNo);
  if (status === 'current') return 'current';
  if (status !== 'done') return 'pending';
  const byYou = v.history[keyOf(P.tasks[taskIndex].id, testNo)]?.commit?.greenBy === 'user';
  return byYou ? 'forged by-you' : 'forged';
}
function chain(v, P) {
  const links = P.tasks.flatMap((t, i) => t.tests.map((test, j) => ({ name: test.name, state: linkState(v, P, i, j + 1) })));
  if (!links.length) return '';
  const forged = links.filter(l => l.state.startsWith('forged')).length;
  return `<div class="chain-row"><ol class="chain" aria-label="頸鍊：已完成 ${forged}／共 ${links.length} 節">${links.map(l => `<li class="${l.state}" title="${esc(l.name)}"></li>`).join('')}</ol>
    <span class="chain-count">${forged}／${links.length} 節</span></div>`;
}

function tddCanvas(v, P) {
  const ti = P.tasks.findIndex(t => +t.id === +ui.task), task = P.tasks[ti];
  if (!task) return `<main class="panel canvas"><p class="empty">${P.tasks.length ? '計畫裡沒有這個 Task。' : '還沒有 Task 清單。'}</p></main>`;
  let lesson = '';
  const rows = task.tests.map((t, j) => {
    const n = j + 1, st = P.status(ti, n), h = v.history[keyOf(task.id, n)];
    const sel = ui.step ? +ui.step.task === +task.id && +ui.step.test === n : st === 'current';
    if (sel) lesson = lessonBlock(st === 'done' ? h?.lesson : P.cur?.lesson);
    const by = st === 'done' && h?.commit?.greenBy ? `<span class="by">${h.commit.greenBy === 'ai' ? 'AI 寫綠燈' : '你寫綠燈'}</span>` : '';
    const mark = st === 'done' ? '<span class="st done" aria-label="完成">✓</span>' : st === 'current' ? '<span class="st now" aria-label="進行中"></span>' : '<span class="st" aria-label="還沒開始"></span>';
    const attrs = st === 'todo' ? 'class="row todo"' : `class="row${sel ? ' sel' : ''}" data-step="${esc(task.id)}:${n}" tabindex="0" role="button"`;
    return `<li ${attrs}>${mark}<span class="nm">${esc(t.name)}</span>${by}</li>`;
  }).join('');
  const layer = task.layer ? `<span class="tile ${LAYER[task.layer] || 'uc'}">${esc(task.layer)}</span>` : '';
  return `<main class="panel canvas" aria-label="畫布"><div class="spine">
    ${chain(v, P)}
    <header class="task-head"><p class="task-id">Task ${esc(task.id)} ${layer}</p><h2>${esc(task.title)}</h2></header>
    ${rows ? `<ol class="tlist">${rows}</ol>` : '<p class="empty">這個 Task 還沒有列出測試</p>'}
    ${lesson}
  </div></main>`;
}

// 行內 `code` 轉成 <code>，其餘照字面顯示
const inline = t => esc(t).replace(/`([^`]+)`/g, '<code>$1</code>');
function lessonBlock(l, cls = '') {
  if (!l?.topics?.length) return '';
  return `<section class="lesson ${cls}" aria-label="這一步學什麼"><h3>這一步學什麼</h3>
    ${l.intro ? `<p class="lesson-intro">${inline(l.intro)}</p>` : ''}
    ${l.topics.map(t => `<div class="topic"><p class="topic-name">${esc(t.name)}</p><dl>${(t.points || []).map(p => `<div class="pt">
      <dt><code>${esc(p.term)}</code>${p.analog ? `<span class="cs"><span class="cs-tag">對照</span><code>${esc(p.analog)}</code></span>` : ''}</dt>
      ${p.text ? `<dd>${inline(p.text)}</dd>` : ''}${p.code ? `<dd>${codeBlock(p.code.file || t.name, p.code)}</dd>` : ''}</div>`).join('')}</dl></div>`).join('')}
  </section>`;
}

const latest = (v, kind) => v.roundtable.filter(f => f.kind === kind).at(-1);
function gwt(v, ruleId) {
  const r = latest(v, 'decisionTable')?.rules?.find(r => r.id === ruleId);
  return r?.gwt ? `<details class="fold" data-fold="gwt" ${ui.folds.gwt ? 'open' : ''}><summary>對應的規格<span class="sum">${esc(r.id)}</span></summary><dl class="gwt"><dt>Given</dt><dd>${esc(r.gwt.given)}</dd><dt>When</dt><dd>${esc(r.gwt.when)}</dd><dt>Then</dt><dd>${esc(r.gwt.then)}</dd></dl></details>` : '';
}
// 一個檔案一個區塊，檔名放在區塊標題列
const fileBlocks = (list = [], fallback) => (list.length > 1 ? `<p class="files-count">${list.length} 個檔案</p>` : '')
  + list.map(f => codeBlock(f.file || fallback, f)).join('');
// 重構方向依空行或「產品碼：」「測試碼：」分段，每段一個區塊；條列行變成清單，其餘一行一段
const BULLET = /^\s*(?:[-*•・]|\d+[.、)])\s+/;
function refactorBlock(text) {
  const [, label, rest] = text.match(/^(產品碼|測試碼)\s*[：:]\s*([\s\S]*)$/) || [null, '', text];
  const lines = rest.split('\n').map(l => l.trim()).filter(Boolean);
  let html = '', list = '';
  const flush = () => { if (list) html += `<ul>${list}</ul>`; list = ''; };
  for (const line of lines) {
    if (BULLET.test(line)) { list += `<li>${inline(line.replace(BULLET, ''))}</li>`; continue; }
    flush();
    html += `<p>${inline(line)}</p>`;
  }
  flush();
  return `<div class="refactor-block">${label ? `<h4>${label}</h4>` : ''}${html}</div>`;
}
const refactorBlocks = text => (text || '').split(/\n\s*\n|\n(?=\s*(?:產品碼|測試碼)\s*[：:])/).map(t => t.trim()).filter(Boolean).map(refactorBlock).join('');
function codeTabs(s) {
  return `<section>
    <div class="tabs" role="tablist">${[['test', '紅燈測試'], ['impl', '綠燈範例'], ['refactor', '重構方向']].map(([k, n]) => `<button role="tab" data-tab="${k}" aria-selected="${ui.tab === k}">${n}</button>`).join('')}</div>
    ${ui.tab === 'test' ? (fileBlocks(s.testFiles, '測試') + (s.failure ? codeBlock('執行結果', { code: s.failure, lang: 'text' }) : '')) || '<p class="note">沒有測試碼。</p>' : ''}
    ${ui.tab === 'impl' ? fileBlocks(s.greenFiles, '綠燈範例') || '<p class="note">沒有綠燈範例。</p>' : ''}
    ${ui.tab === 'refactor' ? (refactorBlocks(s.refactor) + fileBlocks(s.refactorFiles, '重構範例')) || '<p class="note">沒有重構方向。</p>' : ''}
    ${s.hint ? `<div class="decision"><p class="q">提示</p><p style="white-space:pre-wrap">${esc(s.hint)}</p></div>` : ''}
  </section>${lessonBlock(s.lesson, 'narrow-only')}`;
}
const files = list => list.length ? `<ul class="files">${list.map(c => `<li><code>${esc(c.file)}</code><span class="mono"><span class="plus">+${c.add}</span> <span class="minus">−${c.del}</span></span></li>`).join('')}</ul>` : '<p class="note">沒有改動。</p>';

function historyStep(v, P, task, test) {
  const t = P.tasks.find(x => +x.id === +task), name = t?.tests[test - 1]?.name;
  const h = v.history[keyOf(task, test)], c = h?.commit;
  const who = c?.greenBy === 'ai' ? '綠燈由 AI 代寫' : c?.greenBy === 'user' ? '綠燈是你親手寫的' : '沒有記錄綠燈是誰寫的';
  return `<aside class="panel step" aria-label="過往紀錄">
    <section class="head">
      <p class="where">Task ${esc(task)} · 第 ${test} 個測試 · 已完成</p>
      <h2>${esc(h?.title || name)}</h2>${h?.story ? `<p class="lede">${esc(h.story)}</p>` : ''}
    </section>
    ${h && !h.empty ? codeTabs(h) : '<p class="banner">沒有步驟內容：這一輪在 Maester 開始記錄之前就完成了。</p>'}
    ${c ? `<details class="fold" data-fold="commit" ${ui.folds.commit ? 'open' : ''}><summary>commit<span class="sum"><code>${esc(c.sha)}</code> · ${c.missing ? 'commit 已不存在' : esc(who)}</span></summary>
      ${c.missing ? '<p class="note">可能被 amend 或 rebase 掉了。</p>' : `<p class="note">${esc(c.subject)}${c.inferred ? '（從舊計畫勾選的 commit 推測）' : ''}</p><h4>產品碼</h4>${files(c.files.filter(f => !f.test))}<h4>測試碼</h4>${files(c.files.filter(f => f.test))}`}</details>` : ''}
    ${h?.ruleRef ? gwt(v, h.ruleRef) : ''}
  </aside>${dock(v, '<button class="second" data-back>回到目前這一步</button>')}`;
}

// 卡住這一步的事：放在右欄最上面，寫清楚原因、怎麼調整，原始輸出折起來
function problemCard(p) {
  if (!p) return '';
  return `<section class="problem" role="alert"><p class="problem-tag"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M8 1.8 15 14H1z" stroke-linejoin="round"/><path d="M8 6.2v3.6M8 11.9v.1"/></svg>需要你調整</p>
    <h3>${esc(p.title)}</h3>
    ${p.why ? `<p class="problem-why">${inline(p.why)}</p>` : ''}
    ${p.fix ? `<div class="problem-fix"><p class="q">怎麼調整</p><p>${inline(p.fix)}</p></div>` : ''}
    ${p.output ? `<details class="fold" data-fold="problem" ${ui.folds.problem ?? true ? 'open' : ''}><summary>測試輸出</summary>${codeBlock('測試輸出', { code: p.output, lang: 'text' })}</details>` : ''}
  </section>`;
}

// 按「跑測試」時要 AI 跑哪些測試；記在這個瀏覽器，預設全部
const RUNS_TESTS = new Set(['tests_ran', 'refactor_done', 'red_written', 'help_green']);
const SCOPES = [['test', '這一個'], ['task', '這個 Task'], ['all', '全部']];
let testScope = (() => { try { return localStorage.getItem('maester-test-scope') || 'all'; } catch { return 'all'; } })();
const scopePicker = lock => `<div class="scope" role="radiogroup" aria-label="要跑哪些測試"><span>跑哪些測試</span>${SCOPES.map(([k, n]) =>
  `<button role="radio" aria-checked="${testScope === k}" data-scope="${k}" ${lock ? 'disabled' : ''}>${n}</button>`).join('')}</div>`;
const STEPS = [['red', '紅', 'AI 寫測試'], ['green', '綠', '你實作'], ['refactor', '重構', '整理程式']];
function stepper(ph, redBy) {
  const at = STEPS.findIndex(([k]) => k === ph);
  const steps = STEPS.map(([k, n, d]) => [k, n, k === 'red' && redBy === 'user' ? '你寫測試' : d]);
  return `<ol class="stepper" aria-label="這一輪的階段">${steps.map(([k, n, d], i) => `<li class="${i < at ? 'past' : i === at ? 'now' : ''}" ${i === at ? 'aria-current="step"' : ''}><span class="dotmark"></span><span class="sn">${n}</span><span class="sd">${d}</span></li>`).join('')}</ol>`;
}
// 跟著 repo；按了直接寫進 maester.db，不經過 AI，下一個紅燈才生效
let redByNote = '';
const redByToggle = v => {
  if (v.readonly) return '';
  const on = v.redBy !== 'user';
  return `<button class="switch" role="switch" aria-checked="${on}" data-red-by="${on ? 'user' : 'ai'}"
  title="開著：AI 每一輪直接寫紅燈測試。關著：AI 只給測試名稱、要驗的行為和片段，你自己寫。從下一個紅燈開始生效"><span class="knob" aria-hidden="true"></span>AI 自動寫紅燈${redByNote ? `<span class="why">${esc(redByNote)}</span>` : ''}</button>`;
};
function tddStep(v, P) {
  const s = P.cur, ph = s?.phase, lock = busy(v);
  if (!s) return `<aside class="panel step"><p class="empty">${v.state?.done ? '這個功能已完成。打開左上角清單看過往紀錄。' : 'AI 還沒寫入目前這一步。'}</p></aside>`;
  const retry = s.problem ? '我改好了，再跑一次測試' : '';
  const acts = (ph === 'green' || ph === 'refactor' || (ph === 'red' && s.testCode) ? scopePicker(lock) : '') + (ph === 'green' ? `<button class="primary" data-ev="tests_ran" ${lock ? 'disabled' : ''} title="測試全綠後 AI 先 commit 綠燈，再進重構">${retry || '我寫好了，跑測試'}</button>
      <div class="minor"><button class="link" data-ev="hint" ${lock ? 'disabled' : ''}>給我一個提示</button><button class="link" data-ev="help_green" ${lock ? 'disabled' : ''}>直接幫我寫綠燈</button></div>`
    : ph === 'refactor' ? `<button class="primary" data-ev="refactor_done" ${lock ? 'disabled' : ''} title="AI 跑測試、commit 重構，再寫下一個紅燈">${retry || '重構好了，跑測試並 commit'}</button>
      <div class="minor"><button class="link" data-ev="refactor_skip" ${lock ? 'disabled' : ''} title="不 commit，直接進下一個測試">這輪不重構</button></div>`
    : v.redBy !== 'user' && !s.testCode ? `<p class="note">AI 正在寫這一輪的紅燈測試。</p>`
    : s.testCode ? `<button class="primary" data-ev="red_written" ${lock ? 'disabled' : ''} title="AI 跑測試，確認因為行為還沒實作而紅，再進綠燈">${retry || '測試寫好了，跑測試'}</button>
      <div class="minor"><button class="link" data-ev="hint" ${lock ? 'disabled' : ''}>給我一個提示</button></div>`
    : `<p class="note">AI 正在準備這一輪要你寫的測試。</p>`);
  const note = lock;
  const changed = v.changes.filter(c => !c.test);
  const openDecisions = (v.state?.roundtable?.decisions || []).filter(d => d.answer == null);
  return `<aside class="panel step" aria-label="目前這一步">${busyBar(v)}
    <section class="head">
      ${stepper(ph, v.redBy)}${redByToggle(v)}
      <h2>${esc(s.title || P.tasks[P.ti]?.tests[s.test - 1]?.name || '')}</h2>
      ${s.story ? `<p class="lede">${esc(s.story)}</p>` : ''}
    </section>
    ${problemCard(s.problem)}
    ${openDecisions.length && !v.readonly ? decisionCards(openDecisions, lock) : ''}
    ${codeTabs(s)}
    ${s.ruleRef ? gwt(v, s.ruleRef) : ''}
    <details class="fold" data-fold="changes" ${ui.folds.changes ? 'open' : ''}><summary>這一輪你改了<span class="sum">${changed.length ? `${changed.length} 個檔案` : '還沒有'}</span></summary>${files(changed)}<p class="note">只算產品碼；測試碼不算在內。</p></details>
  </aside>${dock(v, acts, note)}`;
}

const dtTable = dt => `<div style="overflow-x:auto"><table class="dt"><tr><th>Rule</th>${(dt.conditions || []).map(c => `<th>${esc(c)}</th>`).join('')}<th>結果</th></tr>
  ${(dt.rules || []).map(r => `<tr><td>${esc(r.id)}</td>${(r.values || []).map(x => `<td>${esc(x)}</td>`).join('')}<td>${esc(r.action)}</td></tr>`).join('')}</table></div>`;
const rtNode = (title, body, tile = '') => `<div class="node"><div class="head">${tile}<span class="t">${title}</span></div>${body}</div>`;
const RT_DOC = {
  discover: f => rtNode('探索', `<div style="white-space:pre-wrap">${esc(f.summary)}</div>`),
  round: f => rtNode(`圓桌會議 ${esc(f.n)}`, (f.items || []).map(i => `<div class="say"><span class="who">${esc(i.who)}</span><div>${esc(i.text)}</div></div>`).join('')),
  codex: f => rtNode(`對抗式審查 ${esc(f.n ?? '')}`, (f.points || []).map((p, i) => `<div class="say"><div><b>第 ${i + 1} 點</b>　${esc(p.text)}</div>${p.why ? `<div class="who">${esc(p.why)}</div>` : ''}<div>${(p.responses || []).map(r => `<span class="verdict ${esc(r.verdict)}">${esc(r.who)}：${esc({ accept: '接受', reject: '駁回', ask: '問你' }[r.verdict] || r.verdict)}</span>`).join('')}</div></div>`).join(''), '<span class="tile ct">Skeptic</span>'),
  candidates: f => rtNode('候選方案', (f.items || []).map(c => `<div class="say"><b>${esc(c.name)}</b>${c.chosen ? ' <span class="verdict accept">你選的</span>' : ''}<div class="who">${esc(c.summary)}</div></div>`).join('')),
  decisionTable: f => rtNode('Decision Table', dtTable(f)),
  design: f => rtNode('最終設計', `${f.summary ? `<div style="white-space:pre-wrap">${esc(f.summary)}</div>` : ''}${(f.decisions || []).map(d => `<div class="say"><b>${esc(d.topic)}</b><div>${esc(d.decision)}</div>${d.reason ? `<div class="who">${esc(d.reason)}</div>` : ''}</div>`).join('')}`),
};
// 每個階段對應的文件；兩次對抗式審查靠 Decision Table 前後分開
const RT_DOCS = {
  DISCOVER: ['discover'], ROUND: ['round'], CODEX_REVIEW: ['codex', 'before'], CANDIDATE_DESIGNS: ['candidates'], USER_DIRECTION: ['candidates'],
  DECISION_TABLE: ['decisionTable'], OPEN_QUESTIONS: ['decisionTable'], FINAL_CODEX_REVIEW: ['codex', 'after'], USER_APPROVAL: ['design'], TASK_BREAKDOWN: ['design'],
};
function rtCanvas(v) {
  const stage = ui.rt ?? v.state?.roundtable?.state ?? 'DISCOVER', [kind, side] = RT_DOCS[stage] || [];
  const firstDt = v.roundtable.findIndex(f => f.kind === 'decisionTable');
  const docs = v.roundtable.filter((f, i) => f.kind === kind && (!side || firstDt < 0 ? side !== 'after' : side === 'before' ? i < firstDt : i > firstDt));
  const name = RT_STAGES.find(([k]) => k === stage)?.[1] || '臨時動議';
  return `<main class="panel canvas"><div class="spine"><p class="where">${esc(name)}</p>${docs.map(f => RT_DOC[f.kind](f)).join('') || '<p class="empty">這個階段還沒有文字紀錄。</p>'}</div></main>`;
}

// 等使用者裁決的題目：臨時動議與 TDD 中途的選擇都用這一塊，在網頁上就能選
const decisionCards = (open, lock) => `<section><h3>等你裁決</h3>${open.map(d => `<div class="decision"><p class="q">${esc(d.question)}</p>
      <div class="opts">${(d.options || []).map(o => `<button class="opt${!ui.draft[d.id]?.free && ui.draft[d.id]?.value === o.label ? ' on' : ''}" data-answer="${esc(d.id)}" data-value="${esc(o.label)}" ${lock ? 'disabled' : ''}>${esc(o.label)}${o.by ? `<span class="who">${esc(o.by)}</span>` : ''}</button>`).join('')}</div>
      ${d.freeText !== false ? `<textarea data-free="${esc(d.id)}" placeholder="或寫下你的想法…" ${lock ? 'disabled' : ''}>${esc(ui.draft[d.id]?.free ? ui.draft[d.id].value : '')}</textarea>` : ''}
    </div>`).join('')}${(() => { const n = open.filter(d => ui.draft[d.id]).length; return `<button class="primary" style="margin-top:12px;width:100%" data-send-all ${lock || !n ? 'disabled' : ''}>送出裁決（${n}／${open.length}）</button>`; })()}</section>`;

function rtStep(v) {
  const rt = v.state?.roundtable || {}, lock = busy(v), decisions = rt.decisions || [];
  const open = decisions.filter(d => d.answer == null), answered = decisions.filter(d => d.answer != null);
  const dt = latest(v, 'decisionTable'), live = v.state?.stage === 'roundtable';
  const stage = RT_STAGES.find(([k]) => k === rt.state)?.[1] || '臨時動議';
  return `<aside class="panel step">${busyBar(v)}
    <section class="head"><p class="where">臨時動議${rt.scale ? ` · ${esc(rt.scale)}` : ''}${live ? '' : ' · 已完成'}</p><h2>${esc(live ? stage : '臨時動議紀錄')}</h2>${live && rt.note ? `<p class="lede">${esc(rt.note)}</p>` : ''}</section>
    ${live && open.length ? decisionCards(open, lock) : ''}
    ${answered.length ? `<section><h3>你的裁決</h3>${answered.map(d => `<div class="decision"><p class="q" style="font-size:16px">${esc(d.question)}</p><p>${esc(d.answer)}</p></div>`).join('')}</section>` : ''}
    ${dt ? `<section><h3>Decision Table</h3>${dtTable(dt)}</section>` : ''}
  </aside>${dock(v, live && rt.state === 'USER_APPROVAL' ? `<button class="primary" data-ev="approve_design" ${lock ? 'disabled' : ''}>設計確定，開始拆 Task</button>` : live ? '' : '<button class="second" data-back>回到目前這一步</button>',
    live ? lock || (open.length ? '' : '議會正在討論') : '')}`;
}

/* ---------- render ---------- */
function render() {
  if (!REPO) return renderProjects();
  const v = view;
  if (!v) return;
  if (v.error) { app.innerHTML = `<p class="empty">讀取失敗：${esc(v.error)}</p>`; return; }
  const P = position(v);
  // 進到新的一步、新的階段或出了要調整的事時，畫面跳回目前這一步；分頁跟著切：紅、綠看測試，重構看重構方向
  const stepKey = `${v.featureId}|${v.state?.stage}|${v.state?.roundtable?.state}|${P.cur ? `${P.cur.testId}:${P.cur.phase}:${P.cur.problem?.title ?? ''}` : ''}`;
  if (stepKey !== lastStep) {
    if (lastStep !== undefined) Object.assign(ui, { mode: null, task: null, step: null, rt: null });
    ui.tab = PHASE_TAB[P.cur?.phase] || 'test';
    lastStep = stepKey;
  }
  ui.mode ??= v.state?.stage === 'roundtable' ? 'rt' : v.state?.stage === 'tdd' || P.tasks.length ? 'tdd' : v.roundtable.length ? 'rt' : null;
  ui.task ??= P.cur?.task ?? P.tasks[0]?.id;
  const phase = v.state?.stage === 'tdd' ? P.cur?.phase : null;
  document.title = `Maester · ${v.state?.feature || v.plan?.feature || v.name}`;
  document.body.className = phase && phase !== 'green' ? `phase-${phase}` : '';
  const err = v.errors.map(e => `<p class="banner" style="margin:0 8px 8px">${esc(e)}</p>`).join('') ;
  if (!ui.mode) {
    queueMicrotask(placeMeetingComposer);
    app.innerHTML = topBar(v, null, P) + err + `<div class="empty"><h2>開一場新會議</h2><p>寫下要討論的功能，AI 會召開臨時動議；過往會議在左上角的清單裡。</p>${newMeetingButton()}</div>` + (ui.meetingOpen ? meetingModal() : '');
    return;
  }
  const viewing = ui.step && P.status(P.tasks.findIndex(t => +t.id === +ui.step.task), ui.step.test) === 'done';
  const side = panel => `<div class="side">${panel}</div>`;
  const body = ui.mode === 'rt' ? rtCanvas(v) + side(rtStep(v))
    : tddCanvas(v, P) + side(viewing ? historyStep(v, P, ui.step.task, ui.step.test) : tddStep(v, P));
  // 同一個畫面重畫（選裁決、切換範例分頁、SSE 更新）時保留各 panel 的捲動位置，換畫面才回到頂端
  const ctx = `${ui.mode}|${ui.rt}|${ui.task}|${ui.step?.task}:${ui.step?.test}`;
  const scrolls = ctx === lastCtx ? [...app.querySelectorAll('.work .panel')].map(p => p.scrollTop) : [];
  lastCtx = ctx;
  const typing = composer?.el.contains(document.activeElement);
  app.innerHTML = topBar(v, phase, P) + err + `<div class="work">${body}</div>` + (ui.roadOpen ? road(v, P) : '') + (ui.meetingOpen ? meetingModal() : '');
  app.querySelectorAll('.work .panel').forEach((p, i) => { if (scrolls[i]) p.scrollTop = scrolls[i]; });
  // 輸入框是同一個節點搬回來，內容與 vim 狀態都在；搬動會失焦，所以補回焦點
  if (composer && !v.readonly) { app.querySelector('.dock')?.append(composer.el); if (typing) composer.focus(); }
  placeMeetingComposer();
  highlightAll();
}
let lastCtx = null;
// 輸入框是同一個節點，每次重畫搬進 modal；剛打開時把游標放進去
function placeMeetingComposer() {
  const slot = app.querySelector('.modal-body');
  if (!slot || !meetingComposer) return;
  const typing = meetingComposer.el.contains(document.activeElement);
  slot.append(meetingComposer.el);
  if (typing || ui.meetingFocus) { meetingComposer.focus(); ui.meetingFocus = false; }
}
const openMeeting = open => { Object.assign(ui, { meetingOpen: open, meetingFocus: open, roadOpen: false }); render(); };
/** @type {string | null | undefined} */
let lastStep;
const PHASE_TAB = { red: 'test', green: 'test', refactor: 'refactor' };

async function renderProjects() {
  const list = await (await fetch(`/api/projects?key=${encodeURIComponent(KEY)}`)).json();
  app.innerHTML = `<div class="projects"><h1 style="font-size:26px;margin-bottom:12px">Maester · 專案</h1>
    ${list.length ? list.map(p => `<a href="/?key=${encodeURIComponent(KEY)}&repo=${encodeURIComponent(p.repo)}"><span>${esc(p.name)}</span><span class="note">${esc(p.repo)}</span></a>`).join('') : '<p class="note">還沒有專案。在 repo 裡執行 maester open。</p>'}</div>`;
}

app.addEventListener('click', e => {
  const target = /** @type {HTMLElement} */ (e.target);
  if (target.matches('[data-close-meeting]')) return openMeeting(false);
  if (target.matches('.scrim')) { ui.roadOpen = false; return render(); }
  const a = /** @type {HTMLElement | null} */ (target.closest('[data-task],[data-rt],[data-step]'));
  if (a) {
    e.preventDefault();
    if (a.closest('.drawer')) ui.roadOpen = false;
    if (a.dataset.task) Object.assign(ui, { mode: 'tdd', task: a.dataset.task, step: null });
    if (a.dataset.rt) Object.assign(ui, { mode: 'rt', rt: a.dataset.rt });
    if (a.dataset.step) {
      const [task, test] = a.dataset.step.split(':'), cur = view.state?.tdd;
      ui.step = cur && +cur.task === +task && +cur.test === +test ? null : { task, test: +test };
      ui.tab = 'test';
    }
    return render();
  }
  const t = target.closest('button');
  if (!t || t.disabled) return;
  if ('roadToggle' in t.dataset) { ui.roadOpen = !ui.roadOpen; return render(); }
  if (t.dataset.unlock) { t.dataset.unlock.split(',').forEach(id => ui.unlocked.add(id)); return render(); }
  if (t.dataset.themeTo) return setTheme(t.dataset.themeTo);
  if (t.dataset.tab) { ui.tab = t.dataset.tab; return render(); }
  if ('back' in t.dataset) { Object.assign(ui, { mode: null, task: null, step: null }); return render(); }
  if (t.dataset.scope) { testScope = t.dataset.scope; try { localStorage.setItem('maester-test-scope', testScope); } catch {} return render(); }
  if (t.dataset.ev) return send(t.dataset.ev, RUNS_TESTS.has(t.dataset.ev) ? { scope: testScope } : undefined);
  if (t.dataset.resume) return meeting('resume', { feature: +t.dataset.resume }).then(why => { resumeNote = why; if (why) render(); });
  if ('newMeeting' in t.dataset) return openMeeting(true);
  if ('closeMeeting' in t.dataset) return openMeeting(false);
  if (t.dataset.redBy) {
    view.redBy = t.dataset.redBy === 'user' ? 'user' : 'ai'; redByNote = ''; render();
    fetch(`/api/red-by?repo=${encodeURIComponent(REPO)}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-maester-key': KEY }, body: JSON.stringify({ value: t.dataset.redBy }) })
      .then(async r => { redByNote = r.ok ? '' : (await r.json().catch(() => ({}))).error || `切換失敗（${r.status}）`; render(); });
    return;
  }
  if ('statusline' in t.dataset) {
    statuslineNote = '設定中…'; render();
    fetch('/api/statusline', { method: 'POST', headers: { 'x-maester-key': KEY } })
      .then(async r => { statuslineNote = r.ok ? '' : (await r.json().catch(() => ({}))).error || `設定失敗（${r.status}）`; render(); });
    return;
  }
  if (t.dataset.answer) { ui.draft[t.dataset.answer] = { value: t.dataset.value }; return render(); }
  if ('sendAll' in t.dataset) {
    const answers = Object.entries(ui.draft).map(([decision, a]) => ({ decision, value: a.value, ...(a.free ? { free: true } : {}) }));
    ui.draft = {};
    return send('answer', { answers });
  }
  if (t.classList.contains('copy')) {
    navigator.clipboard.writeText(/** @type {HTMLElement} */ (t.closest('.code')).dataset.raw).then(() => { t.textContent = '已複製'; }, () => { t.textContent = '複製失敗'; });
    setTimeout(() => { t.textContent = '複製'; }, 1500);
  }
});
app.addEventListener('change', e => {
  const target = /** @type {HTMLSelectElement} */ (e.target);
  if (!target.matches('[data-feature]')) return;
  params.set('feature', target.value);
  location.search = params.toString();
});
app.addEventListener('input', e => {
  const target = /** @type {HTMLTextAreaElement} */ (e.target);
  const id = target.dataset?.free;
  if (!id) return;
  const value = target.value.trim();
  if (value) ui.draft[id] = { value, free: true }; else delete ui.draft[id];
  const btn = /** @type {HTMLButtonElement | null} */ (app.querySelector('[data-send-all]')), n = Object.keys(ui.draft).length;
  if (btn) { btn.disabled = !n; btn.textContent = btn.textContent.replace(/（\d+／/, `（${n}／`); }
  /** @type {NodeListOf<HTMLElement>} */ (app.querySelectorAll(`.opt[data-answer="${CSS.escape(id)}"]`)).forEach(o => o.classList.toggle('on', !value && ui.draft[id]?.value === o.dataset.value));
});
app.addEventListener('keydown', e => {
  const target = /** @type {HTMLElement} */ (e.target);
  if (e.key === 'Enter' && target.matches('[data-step]')) target.click();
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  // vim 用 Esc 回一般模式，游標在輸入框裡時不關 modal
  if (ui.meetingOpen && !meetingComposer?.el.contains(document.activeElement)) openMeeting(false);
  else if (ui.roadOpen) { ui.roadOpen = false; render(); }
});
app.addEventListener('toggle', e => {
  const target = /** @type {HTMLDetailsElement} */ (e.target);
  const fold = target.dataset?.fold;
  if (fold) ui.folds[fold] = target.open;
}, true);

// ?once=1：只抓一次不連 SSE（截圖、除錯用）
if (REPO && params.get('once')) fetch(`/api/view?${q}`).then(r => r.json()).then(v => { view = v; connected = true; render(); });
else if (REPO) {
  const es = new EventSource(`/api/stream?${q}`);
  es.onopen = () => { connected = true; render(); };
  es.onerror = () => { connected = false; render(); };
  // 使用者正在打字時不重畫，免得裁決的自由填寫被洗掉
  es.onmessage = m => { view = JSON.parse(m.data); if (!app.querySelector('.decision textarea:focus')) render(); };
} else render();
