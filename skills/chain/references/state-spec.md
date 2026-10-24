# Maester data spec

Council and TDD records (spec, plan, progress, council documents, decisions, page events, step → commit bindings) live **only in the repo's `.maester/maester.db`** (SQLite; the whole `.maester/` folder is listed in `.git/info/exclude` and never committed). No markdown plans, no `plan.json`, no `state.json`.

The AI never touches the database directly; everything goes through the CLI, written below as `maester` (the real command is `node <plugin-root>/bin/maester.mjs`). Write commands read JSON from stdin; on success they exit 0 and print a JSON result; when a rule rejects the write they exit 1, print the reason on stderr, and leave the database unchanged.

## Terms

Feature (one is current; others can be viewed on the page), Task, test (an immutable id assigned by the database), step (one test's red/green/refactor), binding (step → commit, explicit or inferred), event (a button pressed on the page).

## Server and setup

| Command | Use |
|---|---|
| `maester open` | Prepare the repo, start the server if needed, open the page and print its URL |
| `maester url` | Print the page URL without opening it |
| `maester ensure` | Start the server if it is not running (or is an outdated version); `--hook` is silent and never fails |

## Reading

| Command | Use |
|---|---|
| `maester show` | **Read first when resuming**: current feature, council stage, decisions, latest council document of each kind, Tasks and test ids with completion, current step, open events |
| `maester progress` | One-line progress for a statusline |
| `maester agent` | Reads Claude Code's statusline JSON from stdin and forwards model, context, 5-hour/weekly usage and cost to the page; kept only in server memory, never in `maester.db`; prints nothing. `--hook` (PostToolUse/Stop, async) reads the context tokens from the transcript instead, and does nothing once the statusline is connected |
| `maester statusline` | Claude Code's statusline, set automatically by the first SessionStart (or the page's 「顯示用量」 button): forwards the JSON like `agent`, then runs the user's original statusline (or prints `progress`). `--uninstall` restores the original and it is never set automatically again, nor after the user replaces it. SessionStart re-points it after a plugin update |
| `maester wait` | Claim the next pending event of the current feature and print it (marked processing); waits when there is none. |

## Features

| Command | Input | Rule |
|---|---|---|
| `maester start` | `{ "name": "客戶訂閱", "scale": "標準" }` | The new feature becomes current, council at DISCOVER; the previous current feature keeps its step |
| `maester switch <feature id>` | — | Switch back to an unfinished feature; finished ones are rejected |

A finished feature rejects every write. When a repo has old `state.json`/`plan.json` but no database, every write is rejected until `maester migrate` runs.

## Council

| Command | Input |
|---|---|
| `maester stage` | `{ "state": "CODEX_REVIEW", "note": "一句話", "scale": "標準" }`; state is one of DISCOVER, ROUND, CODEX_REVIEW, CANDIDATE_DESIGNS, USER_DIRECTION, DECISION_TABLE, OPEN_QUESTIONS, FINAL_CODEX_REVIEW, USER_APPROVAL, TASK_BREAKDOWN (`CODEX_REVIEW` and `FINAL_CODEX_REVIEW` are the Skeptic reviews) |
| `maester doc` | A council document; append-only; the page shows the latest document of each kind (see below) |
| `maester ask` | `{ "code": "d1", "question": "…？", "options": [{ "label": "回傳既有結果", "by": "Fowler" }], "freeText": true }` |
| `maester answer` | `{ "code": "d1", "value": "…" }`; written by the AI when the user answers in the terminal; the latest answer wins |
| `maester design` | Final design `{ "summary": "…", "decisions": [{ "topic": "…", "decision": "…", "reason": "…" }], "rejected": ["…"], "risks": ["…"], "followups": ["…"] }` |

Document kinds for `doc`:

```json
{ "kind": "discover", "summary": "multi-line plain text" }
{ "kind": "round", "n": 1, "items": [{ "who": "Uncle Bob", "text": "…" }] }
{ "kind": "codex", "n": 1, "points": [{ "text": "counterexample", "why": "why it deserves doubt", "responses": [{ "who": "Fowler", "verdict": "accept" }] }] }
{ "kind": "candidates", "items": [{ "name": "方案 B", "summary": "…", "chosen": true }] }
{ "kind": "decisionTable", "conditions": ["門市狀態"], "rules": [{ "id": "R2", "values": ["停用"], "action": "拒絕", "gwt": { "given": "…", "when": "…", "then": "…" } }] }
```

`kind: "codex"` is the Skeptic review (the stored name is kept for compatibility). `verdict` is `accept`, `reject` or `ask`.

## TDD

| Command | Input | Rule |
|---|---|---|
| `maester plan` | `{ "feature": 1, "tasks": [{ "code": "02", "title": "…", "layer": "use case", "tests": [{ "id": 17, "name": "R10_…", "rule": "R10" }, { "name": "新的測試" }] }] }` | Replaces the whole plan; existing tests carry their `id` (see `show`), new ones do not. Tests up to and including the current step keep their id, name and order |
| `maester tdd` | — | Only once, from the council stage; the current step becomes the first test 🔴 |
| `maester phase` | `{ "test": 17, "phase": "green", "title", "story", "layer", "ruleRef", "testCode": { "file", "lang", "code" }, "failure", "greenExample": { "file", "lang", "code", "added": [3, 4] }, "refactor", "refactorExample": [{ "file", "lang", "code", "added" }], "hint" }` | Only red→green→refactor, or the same phase to update content; omitted fields keep their value |
| `maester complete <test id> <sha>` | — | After the refactor commit (or a skipped refactor): binds explicitly, archives the step, moves to the next test 🔴 (after the last one the feature is done). The sha must be HEAD or an ancestor; red cannot complete; repeating the same sha does nothing |

**Who writes the red test** is a per-repo setting (`meta.red_by` in `maester.db`, toggled on the page with 「AI 自動寫紅燈」; `show` prints it on the Task heading, `progress` and the page's stepper reflect it). Unset means `ai`. Read it every time a red step starts; a toggle never changes a red step already under way.

- `ai` (default): the AI writes the red test to disk, runs it, records it with `phase`, then moves to green.
- `user`: the AI writes **no files**. It records `phase` red with `title` (the test name), `story` (the behavior the test verifies), `testCode` as a snippet (`{ "lang", "code" }`, no `file`) and the expected `failure`, then waits for `red_written`.

`testCode`, `greenExample` and `refactorExample` may be a single file `{ file, lang, code }` or an array (one block per file on the page). When the code is already on disk (the red test, code the AI wrote for 「幫我 green」), send only `{ "file": "repo/relative/path" }`: `maester` reads the file and stores a snapshot, and `lang` defaults to the extension. Add `"lines": [start, end]` to keep only those lines (for example just the new test); `added` then uses the file's line numbers. Write `code` only for examples that exist nowhere else.

`lesson` (optional) teaches the framework syntax and concepts of the step, shown under the selected test:
`{ "intro": "一句話", "topics": [{ "name": "Hono", "points": [{ "term": "app.post(path, handler)", "analog": "C#：[HttpPost]", "text": "說明，可用 `行內程式碼`", "code": { "lang": "ts", "code": "…" } }] }] }`. `analog` compares with a language the user already knows and names that language; `code` is optional.

`layer`: `契約`, `use case`, `整合`. Code is always raw text plus a Shiki language id in `lang`.

## Page events

The page sends the current feature and context (stage, test, phase); a mismatch is rejected. `maester wait` prints:

```json
{ "id": "mvlduxzq-3z8m", "type": "answer", "status": "processing", "feature": 1,
  "payload": { "answers": [{ "decision": "d1", "value": "…", "free": true }] },
  "ctx": { "stage": "tdd", "test": 17, "phase": "refactor" } }
```

Always finish with `maester done <event id>`; until then the page shows the event as unfinished. An event whose context has passed (for example a repeated 「下一輪」 for a round already completed) is still delivered; the AI decides and then marks it done.

| `type` | What the AI does |
|---|---|
| `answer` | The server already recorded the answers; continue the council accordingly |
| `approve_design` | Same as the user saying 「設計確定」 |
| `red_written` | Only when red is written by the user: run the tests. Red for the right reason (the behavior is missing, or the first compile error of a new contract) → record the user's test with `phase` red `testCode: { "file", "lines" }`, then `phase` green with the green example. Passing, or red for the wrong reason → write a `hint` saying what is wrong and stay in red; never edit the user's test |
| `tests_ran` | Run the tests; when all green, commit the green (`feat:`/`test:`, `Green-By: user`) and enter refactor |
| `hint` | Write a `hint` in the same phase without giving away the full answer |
| `help_green` | Same as 「幫我 green」: the AI writes the green, runs the tests, commits (`Green-By: ai`), then enters refactor |
| `refactor_done` | Run the tests; commit any changes (`refactor:`), `complete` bound to HEAD, write the next red test |
| `refactor_skip` | No commit; `complete` bound to the green commit, write the next red test |
| `next_round` | Older button, same as `refactor_done` |
| `prompt` | `payload.text` is a message from the page; treat it as if typed in the terminal. Not tied to a step; accepted even when the page is stale |

From sending an event until the AI marks it done, the page locks its buttons and shows a working indicator; if the AI was interrupted the user can press 「解除鎖定」. So every event, `prompt` included, must end with `done`.

To wait for the user, run `maester wait` with `run_in_background: true` and the longest timeout the harness allows (Claude Code: 7200000 ms); waiting costs no tokens. A Claude Code session the user works in locally (terminal, desktop app, IDE) has no time limit on background commands; only unattended sessions (`-p`, Agent SDK, CI, cloud) stop them, and `BASH_MAX_TIMEOUT_MS` raises that limit. A `wait` stopped at its time limit has claimed nothing, so when it is stopped while the feature is not done, start it again. When a new session process starts (SessionStart `startup`, `resume` or `clear`, not `compact`), the hook returns events left processing by the previous session to pending, and prints the unfinished events so the new session starts a `wait` and picks them up. Two sessions working one repo at the same time is not supported: a second session starting would hand the first one's event out again. If the user answers in the terminal instead, handle it as usual and stop the background task.

## Migrating old json records

| Command | Use |
|---|---|
| `maester migrate` | Import old `state.json`/`plan.json`/markdown progress into `maester.db`; old files are untouched; refuses when a database already exists |

## Computed by the server (never written)

- Commit subject, `Green-By`, changed files and line counts: read live from git; a missing sha shows 「commit 已不存在」. `Green-By: claude` from older commits counts as AI.
- Files changed in the current round: git.
