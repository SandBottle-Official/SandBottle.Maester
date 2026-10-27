# Changelog

## 1.3.1 — 2026-10-27

### Fixes

- On Windows, the workbench no longer flashes a console window every second: git runs started by the background server are now hidden.
- The workbench no longer re-runs git every second. It watches the repo and refreshes only when a file or `maester.db` changes, so an idle page costs nothing and edits still show up at once.

## 1.3.0 — 2026-10-26

### Features

- The workbench follows the current step: when the AI moves to a new test, phase or Task, the page switches to it instead of staying where you were.
- When a step is blocked (tests still red after 「跑測試」, a regression in an earlier test, a red test failing for the wrong reason), the page shows a red 「需要你調整」 card at the top with the cause, how to fix it and the failing output, and the main button reads 「我改好了，再跑一次測試」.
- The right-hand step panel is wider.

## 1.2.3 — 2026-10-26

### Fixes

- With 「AI 自動寫紅燈」 on, the AI now records the red test and enters green in one step, so the round no longer stalls at red. If it still stops at red, the page shows 「測試寫好了，跑測試」 instead of making you turn the switch off.

## 1.2.2 — 2026-10-25

### Fixes

- Long file paths on code blocks no longer break the header: the path stays on one line and is shortened from the left so the file name stays visible, the full path shows on hover, and 「複製」 stays in place.

## 1.2.1 — 2026-10-25

### Fixes

- The workbench no longer stalls on repos with many finished steps: commit details are cached by sha instead of re-running git for every step each second, so buttons and the red-test toggle respond at once.
- The AI keeps `maester wait` running for as long as the feature is not done, so messages sent from the page and 🔴 steps written by the user are never left without a listener.

### Workbench

- 「AI 自動寫紅燈」 is a switch and flips as soon as you press it.

## 1.2.0 — 2026-10-25

### Forge

- Choose who writes the red test, per repo: the workbench's 「AI 自動寫紅燈」 toggle is stored in `.maester/maester.db` and takes effect from the next red step. Unset repos keep the AI writing it.
- With the toggle off, the AI writes no file: it gives the test name, the behaviour to verify and a snippet, then waits for 「測試寫好了，跑測試」 (`red_written`). It runs the tests and moves to green only when the red fails for the right reason; otherwise it leaves a hint and stays in red without touching your test.
- `maester show`, `maester progress` and the workbench stepper show who writes the red test.

## 1.1.2 — 2026-10-25

### Workbench

- Usage reads like the statusline: 5-hour and weekly usage have small bars coloured green, amber and red at 50% and 80%, with the time until reset beside them.
- Sessions without a statusline (Agent SDK / stream-json hosts) borrow the account's 5-hour and weekly usage from any session's statusline, marked with `~` and the age of the reading; windows that have already reset are not borrowed.
- Context shown only as tokens reads `68k tokens`, so it is not mistaken for a percentage.
- On narrow screens the bars and context step aside so usage and reset times still fit.

## 1.1.1 — 2026-10-25

### Fixes

- Sessions without a statusline (Agent SDK / stream-json hosts) now show the model and context on the workbench. The hook always reports from the transcript; the server ignores it while the statusline reported in the last five minutes. 5-hour/weekly usage and cost still need the statusline.
- Note: these hosts count as unattended, so a background `wait` there stops after at most two hours and is started again.

## 1.1.0 — 2026-10-25

### Fewer tokens

- The AI writes each piece of code once: `maester phase` takes `{ "file" }` for code already on disk (the red test, code written for 「幫我 green」) and stores a snapshot, optionally only `lines: [start, end]`.
- Forge no longer repeats test code or examples in the terminal reply; the workbench shows them.
- Documented that local Claude Code sessions have no time limit on the background `wait`, so it is not restarted every two hours.

### Workbench

- Refactoring directions can carry example code, one block per file with copy.
- The TDD view follows the current step and phase to the matching tab.
- Shows the agent's context and 5-hour/weekly usage, keeping your own statusline output.

## 1.0.0 — 2026-10-24

First public release.

### Small Council (`/maester:council`)

- Uncle Bob, Martin Fowler and Eric Evans review a feature from different angles; an independent Skeptic builds concrete counterexamples.
- Business rules and trade-offs are always decided by you; the agreed design becomes a Decision Table with Given/When/Then and is split into TDD tasks.
- The Skeptic is platform-neutral: Codex when available in Claude Code, a fresh subagent otherwise.

### Forge (`/maester:forge`)

- Outside-in TDD: contract tests first, then use-case tests drive out the domain.
- The AI writes one failing test at a time; you write the code that makes it pass, and every round reviews the test code.
- Commits carry `Green-By: user` or `Green-By: ai`.

### Chain (`/maester:chain`)

- A local workbench that shows the council and a chain with one link per test; links you forged yourself are solid.
- Answer council questions and press the next step from the page.
- New sessions hand back events left in progress by an interrupted session.

### Platform

- Installs from one repository into both Claude Code and Codex.
- Strict TypeScript run directly by Node 22.18+; no build step and no runtime dependencies.
- CI on Windows, macOS and Linux.
- Security: key-gated local API, Host and Origin checks, Content-Security-Policy, escaped rendering.
- Responses default to Traditional Chinese.
