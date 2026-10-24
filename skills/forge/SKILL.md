---
name: forge
description: Maester's outside-in TDD rhythm — API contract test first (use case replaced by a test double), then use-case tests drive out the domain; the AI writes one failing test at a time and the user writes the code that makes it pass, forging one link of their chain per test. Use when executing or planning TDD Tasks, or when the user says 開始 Task N, 下一個測試, 下一輪, 由我實作, 照我的節奏, outside-in, 契約測試, forge.
---

# Forge

Every test is one link of the user's chain, and a link cannot be forged by someone else. **The AI writes the red test (unless the repo's red-test setting hands it to the user); the user writes the green.**

## Language

Respond, write plan/phase content, test names and lessons in Traditional Chinese (zh-TW) unless the user explicitly asks for another language. Keep code identifiers and established technical terms in their original form.

## Setup

The CLI is `node <plugin-root>/bin/maester.mjs`; `<plugin-root>` is two directories above this SKILL.md. Below it is written `maester`. Commands and payloads are defined in [../chain/references/state-spec.md](../chain/references/state-spec.md).

## Test layers (outside in)

| Order | Layer | Subject | Test double | Verifies |
|---|---|---|---|---|
| 0 | Test infrastructure | — | — | Harness, fixtures, builders; may be written in one go |
| 1 | **Contract test** (API contract) | HTTP interface | Use case replaced by a **Fake** (DI container bean/service override) | Routing, authorization, request binding, response envelope, serialization (naming conventions), domain exception → HTTP status mapping |
| 2 | **Use case test** (sociable unit test) | Application service | Driven ports (gateway/repository) as **in-memory Fakes** | Business rules; domain types are driven out from this layer |
| 3 | **Narrow integration test** | Driven adapter (repository implementation) | None; a real database (Testcontainers) | Queries, mapping, transaction behavior |
| 4 | **DI wiring and end-to-end** | The whole composition root | None | Wiring is correct and the path works |

- Task 00 of a plan is infrastructure; Task 01 is always a contract test.
- From the Decision Table: business Rules and their Given/When/Then → use case tests; authorization, envelope and error mapping → contract tests; persistence semantics → narrow integration tests.
- Domain types get no solitary unit tests, except pure calculations with many combinations (money, periods, date boundaries and similar value objects) where testing through the use case would explode the fixtures.
- Integration tests are expected to pass immediately. A red one means the Fake and the real adapter disagree: first write a use case or adapter test that reproduces the same failure, fix it, then return to the integration test.

## Changing legacy behavior

Pin the current observable behavior first with **characterization tests** (Feathers), in the earliest Task. They are expected to pass immediately and are exempt from the "a test that passes is not a step" rule below. When a requirement deliberately replaces a pinned behavior, update or rename the matching characterization test into the new specification; never delete it silently.

## Each round: red → green → refactor

Small steps, one test per round.

1. **Red** (AI, or the user when the repo's red-test setting is `user`; see the state spec): write the test and any test helpers it needs, run it, and confirm it fails because **the behavior is missing**, or with a compile error the first time a new contract appears. A test that passes immediately is not a step: pick one that drives new code, or fold it into the related step.
   When the setting is `user`, the AI writes no file: it records the test name, the behavior and a snippet with `maester phase`, and waits for 「測試寫好了」 (`red_written`); then it runs the tests and confirms the red as above. Every 「write the next red test」 in this skill and the state spec follows the setting.
2. **Green** (user): give the smallest production-code **example** that would make it pass, without writing it to any file. When the user says it is green, run the tests to confirm.
3. **Refactor** (user): give refactoring **examples** for production and test code, without writing them to files. Production code may be skipped when nothing is worth changing, but **test code is reviewed item by item every round**, and the refactoring direction states its conclusion in two parts, 「產品碼」 and 「測試碼」:
   - **One place to change**: if the interface changed next round (path, header, request/response JSON, test double type, how the SUT is built and the request assembled, Fixtures values), how many places would need editing? More than one means centralizing into a constant, alias, Scenario, helper or Fixtures.
   - **Readability**: the test body holds only the scenario and the assertions; the name and the three parts (arrange / act / assert) tell which business behavior is verified. Magic values become business nouns from Fixtures; assertion messages and names use domain language.
   - **Duplication**: tests in one describe that differ only in data become a Scenario method or data-driven (for example `test.each`), without hiding which business case failed.
   - Refactor while staying green. When every item is fine, say explicitly 「測試碼：檢視過，這輪不用改」; never omit this part.

The AI writes the code of a step itself only when the user says 「幫我 green」 or 「幫我實作這一輪」.

Open every round with one or two sentences in the business's ubiquitous language (customers, roles, stores, subscriptions, permissions…, not class names): which business behavior the system gains this round and why it is needed.

Report only: that business sentence, the test name, why it is red, or the files changed. Test code, green and refactor examples go only into `maester phase`; the workbench renders them, so never repeat code in the reply. No explanations, no lists of possibilities. Plans contain no commit steps.

## Progress on the workbench

Plans, progress and every step's content live only in the repo's `.maester/maester.db`, written through `maester`. No markdown plans, no json. A statusline can show `maester progress`. The page shows the agent's context and 5-hour/weekly usage out of the box (Maester connects itself to the statusline on the first SessionStart and keeps the user's own statusline output).

When the user says 「開始 Task N」「繼續」 or a new conversation resumes, run `maester open` and `maester show`, continue from the current step (→) and report where you are; when it stops at 🟢 the user is implementing, so do not rewrite the red test. When Tasks or tests change, write the whole plan with `maester plan` (existing tests keep the ids printed by `show`; nothing up to the current step may change).

Record every phase change immediately with `maester phase` (with the current test id), without waiting for a commit:

- After running red: `phase: red` with the business sentence, test code (only `{ "file", "lines" }` covering the new test; `maester` reads it from disk), failure output (just the lines that show why it is red), green example and the Rule it covers.
- Waiting for the user: `phase: green`.
- Entering refactor: `phase: refactor` with the refactoring direction in `refactor` (「產品碼」 and 「測試碼」 as separate paragraphs, blank line between) and the example code in `refactorExample`, one entry per file.
- Giving a hint: same phase, write `hint`.
- Optionally a `lesson` for the framework syntax this step introduces; its `analog` is a comparison in a language the user already knows, naming that language inside the text (for example `C#：[HttpPost]`).

Keep one `maester wait` running with `run_in_background` for as long as the feature is not done, in every phase (the page can send a `prompt` at any time, and 🔴 waits on the user when the red-test setting is `user`); continue according to the event received (the table is in the state spec), then `maester done <event id>`.

## Commits: one at green, one at refactor

At most two commits per test, both only when every test is green; otherwise do not commit and report why:

1. **After green** (the user says 「綠了」, the page sends `tests_ran`, or an AI-written green passed): commit this round's test and production code as `feat:` or `test:` with a one-line summary of the tested behavior, then move to refactor.
2. **After refactor** (「重構好了」 or `refactor_done`): commit any changes as `refactor:`; then `maester complete <test id> <HEAD sha>` and write the next red test. When refactoring is skipped, do not commit; `complete` binds the green commit.

- `git add` only files touched this round. If the user already committed, do not commit again; use that sha.
- End each message with a trailer: `Green-By: user` when the user wrote the green, `Green-By: ai` for a round the user asked the AI to implement; the refactor commit repeats the round's value.
- After `maester complete` on the last test the feature is marked done. 「下一輪」 means refactoring is finished.

## Test style

- Test names describe business behavior in the user's language, e.g. `ConfirmOrder已付款時回傳確認編號`.
- Nested classes per scenario (Testcase Class per Fixture), each with one `Scenario` responsible for fixture setup.
- Test data comes from an Object Mother (`Fixtures`) with business-noun constants, never magic values in the test body.
- Scenarios, test doubles and harness code get no tests of their own.

## Code is documentation

No `<summary>` or comments that restate the code; names carry intent. Only a "why" the code cannot express gets a one-line comment. Specification details live in the project's spec documents. Example code in plans follows the same rule.

## Project mapping

Which test project holds each layer, the harness and Fake class names, and where plans and specs live come from the project's agent instructions (`CLAUDE.md` or `AGENTS.md`); if absent, explore the existing tests first, then ask the user.
