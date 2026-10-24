---
name: chain
description: Open the Maester workbench — the local web page that shows the Small Council (council) and the chain of TDD links (forge) for the current repo, and lets the user answer questions and press next-step buttons. Use when the user says /maester:chain, 打開網頁看進度, 開工作台, 開 Maester, show my chain, or wants to see council or TDD progress.
---

# Chain

## Language

Respond in Traditional Chinese (zh-TW) unless the user explicitly asks for another language.

## Setup

The CLI is `node <plugin-root>/bin/maester.mjs`; `<plugin-root>` is two directories above this SKILL.md. Below it is written `maester`.

## Open the workbench

Run `maester open` inside the repo and give the user the printed URL. Opening the page costs no tokens: the local server reads only `.maester/maester.db` and git, and the browser renders everything.

Then run `maester show`. While the current feature is not done, keep one `maester wait` running with `run_in_background` so the page is never left without a listener, whatever the stage or phase: the page's message box can send a `prompt` at any time, and the user also acts on the page at council questions, at 🟢/🔵, and at 🔴 when the repo's red-test setting is `user`. Handle each event as the state spec says, ending with `maester done <event id>`. When a new session starts, the SessionStart hook returns events an interrupted session left 處理中 to 待處理, so the next `wait` delivers them.

- The server listens on `127.0.0.1:4848` (`MAESTER_PORT` overrides it); a SessionStart hook starts it in the background.
- If the page does not load, read `~/.maester/server.log`.
- Repos that used the earlier workbench keep their history: the first `maester` command copies the old data folder into `.maester/` and leaves the original untouched.
- The data format and every command are in [references/state-spec.md](references/state-spec.md).
