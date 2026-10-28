---
name: council
description: Convene Maester's Small Council — Uncle Bob, Martin Fowler and Eric Evans debate one feature while an independent Skeptic tries to break the design; the agreed spec becomes a Decision Table with Given/When/Then and is split into TDD Tasks for forge. Use when the user asks for 大師圓桌, 召開圓桌, 請三位大師一起設計, 設計後輸出 task, Small Council, or a design review that should end in TDD tasks. Not for pure concept questions, code review or debugging.
disable-model-invocation: true
---

# Small Council

The council exists to **force every assumption, invariant, data authority, dependency direction and boundary condition into the open**, then turn the confirmed spec into TDD Tasks. The masters ask; the user decides.

## Language

Respond, write council documents, ask questions and write plan/phase content in Traditional Chinese (zh-TW) unless the user explicitly asks for another language. Keep code identifiers and established technical terms in their original form.

User-facing names (replies, council documents, stage notes): the Small Council is 「臨時動議」, a Round is 「圓桌會議」, a Skeptic review is 「對抗式審查」 (the final one 「最終對抗式審查」).

## Setup

The CLI is `node <plugin-root>/bin/maester.mjs`; `<plugin-root>` is two directories above this SKILL.md. Below it is written `maester`. Every record lives in the repo's `.maester/maester.db` and is written only through the CLI; commands and payloads are defined in [../chain/references/state-spec.md](../chain/references/state-spec.md). Never write markdown or json records.

Before Discover, read the lenses this skill relies on: [uncle-bob](references/uncle-bob.md), [fowler](references/fowler.md), [evans](references/evans.md), [decision-table](references/decision-table.md), [skeptic](references/skeptic.md).

## Hard Gates

1. **No Tasks without explicit user approval of the design.** Only 「這個方案可以」「設計確定了」「開始拆 task」 or an equivalent statement counts.
2. **Never invent business rules.** Anything that changes behavior, invariants, the authoritative source, error behavior, retry/duplicate handling, state transitions, money, permissions, time rules or domain terms, and is not in the requirement, becomes an Open Question for the user.
3. **Business semantics belong to the user.** A master's architectural preference is never a business rule.

### All must be true before Task breakdown

- [ ] The codebase has been explored
- [ ] At least one full Round, with every Skeptic challenge answered by the masters
- [ ] Every conflict between masters has been ruled on by the user
- [ ] The user has chosen a Candidate Design
- [ ] The Decision Table is complete, every Open Question answered by the user, every Rule has Given/When/Then
- [ ] The Final Skeptic Review is done and all three masters state they have no further concerns
- [ ] The user has explicitly approved the final design

## Scale

| Scale | When | Flow |
|---|---|---|
| 精簡 | One use case, no cross-context work, no legacy behavior change | One Round; the Skeptic only does the Final Review |
| 標準 | Everything else | A Skeptic review after every Round, and again after the Decision Table |

State the chosen scale and why at the start; the user may change it. Neither scale may skip a Hard Gate.

## Flow

```text
DISCOVER → ROUND ⇄ CODEX_REVIEW → CANDIDATE_DESIGNS → USER_DIRECTION
→ DECISION_TABLE ⇄ OPEN_QUESTIONS → DT review (標準)
→ FINAL_CODEX_REVIEW → master confirmation → USER_APPROVAL
→ TASK_BREAKDOWN → user chooses A or B → forge
→ Legacy Git Audit (only when legacy behavior changed)
```

`CODEX_REVIEW` and `FINAL_CODEX_REVIEW` are the stored stage codes for the Skeptic reviews; keep them for compatibility. Never skip a state. A genuinely new problem found late sends you back to the state that owns it.

## Recording on the workbench

- Open with `maester open`, then `maester start` for a new feature (or `maester show` to resume one).
- On every state change run `maester stage` with a one-sentence `note`. When a state finishes, append a council document with `maester doc`: Discover, each Round, each Skeptic review (`kind: "codex"`), Candidate Designs, Decision Table. Documents are append-only; corrections are new documents.
- Every question for the user (master conflicts, Open Questions, Skeptic points needing a ruling, design choice, the A/B choice after breakdown) goes through `maester ask`, all questions of one batch at once so the user answers them together on the page. Then run `maester wait` with `run_in_background`. Treat an `answer` event (already recorded by the server) or `approve_design` exactly like the user saying it in the terminal, then `maester done <event id>`. Record terminal answers with `maester answer`. Approval on the page satisfies Hard Gate 1.
- After approval, write the Final Design Summary with `maester design`.

## Follow the user's way

Read the 「使用者的寫法」 section of `maester show` before Discover; it overrides this skill's naming and style defaults. When the user's terms, Rule wording, Task granularity or test naming differ from what the council proposed, adopt theirs and record it with `maester adapt`, as described in forge's 「Follow the user's way」. This never relaxes a Hard Gate.

## Step 1 — Discover

Describe what exists before any master speaks. Explore what this feature touches: entry points (controller, endpoint, consumer, job), use cases, domain model, gateways/repositories and their implementations, DI registration, persistence schema, external integrations, error-handling strategy, **existing test patterns and test doubles**, and recent commits that may have started the work.

- If the codebase has no aggregates, CQRS, repositories, domain events or layers, do not invent them to please a master. Describe the present first, then discuss whether introducing one is worth it.
- For legacy code, identify observable behavior, side effects, hidden dependencies, seams and existing coverage first; they are the baseline for the Legacy Git Audit. No large refactoring talk before that understanding exists.

## Step 2 — Discussion

### Round rules

- In one Round each master speaks once, normally Uncle Bob → Fowler → Evans.
- Each turn carries **one** main concern: a question, a position, a reply to the previous master, or an explicit 「這一輪我沒有新的疑慮」. Never manufacture a concern to fill the turn.
- When a concern depends on an undefined business rule, domain meaning, data authority, invariant or scope, wait for the user's answer before building on it.
- No Decision Table at the end of a Round.

### Conflicts between masters

Never blend positions into one conclusion. Lay them side by side and ask the user which way to go; when ownership is unclear, first ask who defines the rule. No convergence without a ruling.

A frequent split: a Gateway isolates I/O; an Anti-Corruption Layer stops semantic pollution. An ACL is needed only when the external model's nouns or behavior would leak into this bounded context.

### The Skeptic

The Skeptic is a full-time doubter, not a fourth master. How to run it, what to send, and its output format are in [references/skeptic.md](references/skeptic.md).

### Masters answer the Skeptic

Never just 「同意」「不同意」「這不用管」. Each master answers point by point:

```text
**<Master> 回應 Skeptic 第 N 點：**
假設 Skeptic 是對的，影響是：<concrete consequence>
目前設計是否已處理：<analysis>
結論：接受修正／駁回／需要問使用者 — <reason>
```

- **Accept** when the counterexample can really happen here, the design does not handle it, and ignoring it would cause a production error or slip past existing tests. Update the design explicitly.
- **Reject** only with one of: it cannot happen in this bounded context (with the reason), the design already handles it, it belongs to another bounded context, it is explicitly out of scope, or a system constraint rules it out. 「應該不會發生」 is not a reason.

Record each verdict as `accept`, `reject` or `ask` in the review document's `responses`.

### Scope discipline

Split findings into **In Scope** (correctness, invariants, boundaries, integration, persistence, testability, production safety of this feature — must be handled) and **Follow-up** (unrelated naming, logging, repo-wide debt, unrelated performance — record as `Follow-up concern:` without growing the feature).

## Candidate Designs

When the discussion yields no new major concern, present **2–3** reasonable designs; if only one is reasonable, present one rather than padding with bad options.

For each: core structure, responsibility boundaries, dependency direction, persistence/external I/O strategy, test strategy, pros and cons, preconditions, and migration cost when legacy changes. Masters may state a preference; the user chooses. No final Decision Table before the choice.

## Decision Table

After the choice, build the table following [references/decision-table.md](references/decision-table.md). Conditions come from the requirement, the masters, the Skeptic and existing legacy behavior. In addition:

- Conditions list the **full domain value set** (a payment status of NotStarted/Pending/Paid/Failed/Refunded is never reduced to yes/no).
- Ask Open Questions one by one; never answer them yourself. After each answer update the table, the design, the invariants and the scenarios.
- Every Rule has at least one Given/When/Then with real domain nouns and concrete values; these become forge's test skeleton.
- Mark **legacy behavior that is deliberately replaced**; the Legacy Git Audit uses this list.

At scale 標準, run a Decision Table review by the Skeptic aimed at missing, contradictory or overlapping rules, impossible combinations, incomplete value sets, undefined defaults, missing boundaries, unverifiable actions, and Given/When/Then that disagrees with the table.

## Step 3 — Convergence

1. **Each master confirms** and states there are no further concerns:
   - Uncle Bob: layer boundaries, dependency direction, I/O isolation, testability, no needless abstraction.
   - Fowler: every pattern earns its place, authoritative source, transaction and persistence responsibility, commands and queries kept apart.
   - Evans: ubiquitous language, every invariant has an owner, aggregate boundaries not bent by technical needs, bounded contexts not mixed.
2. **Final Skeptic Review** covering architecture, domain semantics, integration, persistence, failure behavior, concurrency, retry, duplicates, backward compatibility, testability, the Decision Table and rollout risk.
3. **Final Design Summary**: selected design, key decisions (topic / decision / reason), rejected alternatives, remaining risks the user explicitly accepted.
4. **Ask the user** 「這份設計是否確定？確定後我才拆成 TDD Tasks。」 No explicit approval, no Step 4.

## Step 4 — Task breakdown

Rhythm, layer order, who writes production code and when to commit all follow **forge**; this skill only slices the spec into Tasks:

- When legacy behavior changes, Task 00 is Characterization (see forge).
- Each Task is a **cohesive behavior slice** naming the Rules it covers and its main test layer.
- Task titles state the Rule range and observable behavior, e.g. `Task 03 — R3 重複確認回傳既有確認編號`; never `Add test`, `Fix code`, `Red`, `Green`.
- No Task may be "the whole feature"; split beyond about 15 tests or three layers.

Preview the list first:

```text
Task 拆解完成，共 N 個：
Task 00 — Characterization：捕捉現有訂單確認行為
Task 01 — 契約：POST /orders/{id}/confirm 的路由、授權與錯誤映射
Task 02 — R1／R2 訂單確認：已付款可確認、未付款拒絕
...

你要：
A) 先檢視設計與 Task 計畫
B) 直接從 Task 00 開始
```

**Never start implementing after the breakdown**; wait for A or B.

Both start with `maester plan` (each Task's scope, Rules covered and test layer), then `maester tdd`. Plans and progress live only in `maester.db`; no markdown, no committed plan.

- **A**: stop after writing the plan and ask the user to review it on the page or with `maester show` before saying go. The design content to present is listed in [references/output-templates.md](references/output-templates.md).
- **B**: go straight into forge from the first red test of the first Task.

## Step 5 — Legacy Git Audit

Only when this feature **changed legacy behavior**, after all Tasks are done; with A, remind the user at hand-off. TDD protects only the known spec; this audit checks that the commits did not silently break behavior found in Discover. Protocol, risk levels and report format: [references/legacy-git-audit.md](references/legacy-git-audit.md).

## Red flags

| Thought or act | Correction |
|---|---|
| The requirement is clear, just split Tasks | Back to Hard Gate 1 |
| Every master forces a question | Saying "no new concern" is allowed |
| One master asks five things at once | One main concern per turn |
| Masters disagree but one conclusion is written | Lay out positions; the user rules |
| The Skeptic merely agrees | It must build a concrete counterexample |
| Skeptic points accepted or rejected wholesale | Evaluate each; rejections need a legitimate reason |
| Alternatives first appear at the end | Candidate Designs come before the Decision Table |
| Aggregates bolted onto a codebase without them | Describe the present first |
| Filling in an undefined rule yourself | Make it an Open Question |
| Coding right after the breakdown | Wait for A or B |

**No elegant pattern outranks confirmed domain behavior.** The masters probe from different angles, the Skeptic tries to overturn the design, the Decision Table turns prose into a verifiable spec, and TDD builds only on what was confirmed.
