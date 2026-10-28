---
name: open
description: The Maester entry point. `/maester:open` opens the workbench in the browser, where the user picks a past meeting or starts a new one (a 臨時動議 that ends in TDD Tasks), then the AI keeps listening to the page and runs council or forge as the meeting needs. Use when the user says /maester:open, /maester, 打開網頁看進度, 開工作台, 開 Maester, 開會, 新建會議, show my chain, or wants to see council or TDD progress.
---

# Open

## Language

Respond in Traditional Chinese (zh-TW) unless the user explicitly asks for another language.

## Setup

The CLI is `node <plugin-root>/bin/maester.mjs`; `<plugin-root>` is two directories above this SKILL.md. Below it is written `maester`. The data format and every command are in [references/state-spec.md](references/state-spec.md).

## Open the workbench

1. Run `maester open` inside the repo and give the user the printed URL. Opening the page costs no tokens: the local server reads only `.maester/maester.db` and git, and the browser renders everything.
2. Run `maester show`, then keep one `maester wait` running with `run_in_background` for as long as this session works the repo, until `/maester:stop` (a `wait` that prints `{ "stopped": true }` is never restarted). The user chooses on the page; you act on the events.
3. Handle each event as the state spec says, ending with `maester done <event id>`, and start the next `wait`:
   - `start_council`: the user started a new meeting on the page (it is already the current feature, at DISCOVER). Load the `council` skill and run it from Discover.
   - `resume`: the user chose to continue an unfinished meeting (it is already current). Run `maester show`; load `council` when its stage is the council, `forge` when it is TDD, and continue from where it stopped.
   - Everything else (answers, TDD buttons, `prompt`) follows the skill of the current stage.

When the user asks in the terminal instead (「開始新會議：客戶訂閱」), do the same without the page: `maester start`, then the `council` skill.

- The server listens on `127.0.0.1:4848` (`MAESTER_PORT` overrides it); a SessionStart hook starts it in the background.
- If the page does not load, read `~/.maester/server.log`.
- When a new session starts, the SessionStart hook returns events an interrupted session left 處理中 to 待處理, so the next `wait` delivers them.
- Repos that used the earlier workbench keep their history: the first `maester` command copies the old data folder into `.maester/` and leaves the original untouched.
