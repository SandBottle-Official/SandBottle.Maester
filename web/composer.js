// 送訊息給 AI 的輸入框。編輯器從 CDN 載入；載不到時退回一般 textarea（沒有 vim）。
// 版本與共用實例由 index.html 的 import map 決定
async function loadEditor() {
  const [state, view, commands, vimMod] = await Promise.all([
    import('@codemirror/state'), import('@codemirror/view'), import('@codemirror/commands'), import('@replit/codemirror-vim'),
  ]);
  return { ...state, ...view, ...commands, vim: vimMod.vim, Vim: vimMod.Vim, getCM: vimMod.getCM };
}

const readVim = () => { try { return localStorage.getItem('maester-vim') === 'on'; } catch { return false; } };

export function createComposer({ onSubmit }) {
  const el = document.createElement('section');
  el.className = 'composer';
  el.setAttribute('aria-label', '送訊息給 AI');
  el.innerHTML = `<div class="composer-box"><textarea id="composer-input" rows="2" placeholder="給 AI：想調整什麼？" aria-label="給 AI 的訊息"></textarea></div>
    <div class="composer-foot"><label class="switch"><input type="checkbox" class="vim-toggle" ${readVim() ? 'checked' : ''}><span>Vim</span></label>
      <span class="composer-mode" aria-live="polite"></span><span class="composer-note"></span><button class="primary composer-send" type="button">送出</button></div>`;
  const box = el.querySelector('.composer-box'), toggle = /** @type {HTMLInputElement} */ (el.querySelector('.vim-toggle'));
  const note = el.querySelector('.composer-note'), mode = el.querySelector('.composer-mode'), sendBtn = /** @type {HTMLButtonElement} */ (el.querySelector('.composer-send'));
  let text = () => el.querySelector('textarea').value, clear = () => { el.querySelector('textarea').value = ''; }, focus = () => el.querySelector('textarea').focus();
  let sending = false;

  async function submit() {
    const value = text().trim();
    if (!value || sending) return true;
    sending = true; sendBtn.disabled = true;
    try {
      const why = await onSubmit(value);
      if (why) note.textContent = why; else { clear(); showNote(toggle.checked); markFilled(); }
    } finally { sending = false; sendBtn.disabled = false; }
    return true;
  }
  // 收合時只留一行輸入框；有字或游標在裡面才露出送出列
  const markFilled = () => el.classList.toggle('filled', text().trim().length > 0);
  sendBtn.addEventListener('click', submit);
  el.querySelector('textarea').addEventListener('input', markFilled);
  el.querySelector('textarea').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } });
  const showNote = on => { note.textContent = on ? '⌘↩ 或 :w 送出 · Esc 回一般模式' : '⌘↩ 送出'; mode.textContent = ''; };
  showNote(false);
  toggle.disabled = true;

  loadEditor().then(cm => {
    const vimSlot = new cm.Compartment();
    const draft = text();
    box.innerHTML = '';
    const view = new cm.EditorView({
      parent: box,
      state: cm.EditorState.create({
        doc: draft,
        extensions: [
          vimSlot.of(readVim() ? cm.vim() : []),
          cm.history(),
          cm.keymap.of([{ key: 'Mod-Enter', run: () => { submit(); return true; } }, ...cm.defaultKeymap, ...cm.historyKeymap]),
          cm.EditorView.lineWrapping,
          cm.placeholder('給 AI：想調整什麼？'),
          cm.EditorView.contentAttributes.of({ 'aria-label': '給 AI 的訊息', id: 'composer-input' }),
          cm.EditorView.updateListener.of(u => { if (u.docChanged) markFilled(); }),
        ],
      }),
    });
    cm.Vim.defineEx('write', 'w', () => submit());
    const syncMode = () => {
      const vimState = cm.getCM(view)?.state?.vim;
      mode.textContent = !toggle.checked ? '' : vimState?.insertMode ? '插入' : vimState?.visualMode ? '選取' : '一般';
    };
    view.dom.addEventListener('keyup', syncMode);
    view.dom.addEventListener('mouseup', syncMode);
    text = () => view.state.doc.toString();
    clear = () => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '' } });
    focus = () => view.focus();
    toggle.disabled = false;
    toggle.addEventListener('change', () => {
      try { localStorage.setItem('maester-vim', toggle.checked ? 'on' : 'off'); } catch {}
      view.dispatch({ effects: vimSlot.reconfigure(toggle.checked ? cm.vim() : []) });
      showNote(toggle.checked); syncMode(); view.focus();
    });
    showNote(toggle.checked); syncMode();
  }).catch(() => { note.textContent = '⌘↩ 送出（編輯器載入失敗，Vim 不可用）'; });

  return { el, focus: () => focus() };
}
