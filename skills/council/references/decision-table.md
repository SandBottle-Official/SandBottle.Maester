# Decision Table and Given/When/Then

A Decision Table turns a requirement written in prose into rules that can be checked one by one. Each column of conditions plus one row of values is a Rule; each Rule has an action and at least one concrete scenario.

## Building the table

1. **List the conditions.** Every input or state that changes the outcome: actor, entity status, amounts, dates, flags, prior history. Take them from the requirement, the masters, the Skeptic and existing legacy behavior.
2. **Write the full value set for each condition.** Use the domain's real values (`未開始／處理中／已付款／失敗／已退款`), not yes/no. Split numeric conditions at their boundaries (`< 0`, `0`, `1..30`, `> 30`).
3. **Enumerate combinations.** Start from the full cartesian product, then collapse rows whose action does not depend on a condition by writing `—` (any value) for it. Keep collapsed rows explicit enough that no combination is left without a Rule.
4. **Name the action for each Rule** as an observable outcome: what is returned, stored, published or rejected, with the error the caller sees.
5. **Check the table**: every combination is covered exactly once; no two Rules overlap with different actions; impossible combinations are marked as impossible with the reason; there is a defined default.
6. **Raise Open Questions** for every cell the requirement does not decide. Never fill them in; ask the user.

## Given/When/Then

One scenario per Rule at minimum, using domain nouns and concrete values:

```gherkin
Given 台北店已有一筆有效的試用訂閱 T-1
When 店長再次申請試用
Then 回傳既有的試用訂閱 T-1，且不建立新的訂閱
```

- **Given** sets only the facts this Rule depends on.
- **When** is a single business action.
- **Then** states the observable result, including what must *not* happen when that matters.
- Values are specific (`T-1`, `30 天`, `NT$1,200`), never "some valid data".

## Common gaps

- Boundaries: the first and last valid value, zero, empty, exactly-at-limit dates.
- Duplicates and retries: the same command twice, concurrent submissions.
- Missing or stale data: the referenced entity no longer exists or changed meanwhile.
- Permissions: the same action by a different role.
- Time: time zones, end of month, expiry exactly now.
- Partial failure: one side effect succeeded, the next failed.
- Legacy behavior: what the system does today in each combination, and whether that is being kept or replaced.

## Recording

Store the table with `maester doc` as `kind: "decisionTable"`: `conditions` is the ordered list of condition labels, each rule has `id` (`R1`…), `values` in condition order, `action`, and `gwt` with `given`, `when`, `then`.
