# Legacy Git Audit

Confirms that this feature's commits did not accidentally break the legacy observable behavior identified in Discover. Prefer an independent reviewer (see [skeptic.md](skeptic.md) for who can play one); otherwise run it with the current model.

## Inputs

1. Legacy entry points and observable behaviors found in Discover
2. The characterization tests and their current state (green / red / gone)
3. The diff of every commit in this feature
4. The list of legacy behavior deliberately replaced

## Steps

1. **Scope the change**: `git log --oneline <base>..HEAD` and `git diff <base>..HEAD`. Without a clear base branch, use the feature's commit count N: `git diff HEAD~N HEAD`.
2. **Mark affected paths** by comparing the diff with legacy entry points, seams, hidden dependencies, shared infrastructure (schema, config, DI registration) and paths covered by characterization tests.

   | Risk | Meaning |
   |---|---|
   | HIGH | Directly changes the implementation of a legacy observable behavior |
   | MEDIUM | Changes shared infrastructure that legacy paths rely on |
   | LOW | Only adds files; no legacy path modified |

3. **Check characterization tests** on HIGH and MEDIUM paths: still green, deliberately replaced by a new specification test, or silently deleted?
4. **Check the replacement list**: the old characterization test was updated or renamed, and the new specification test exists and passes.

## BLOCKER

- A characterization test deleted without a replacement
- Deliberately replaced behavior with no new test covering it

A BLOCKER is never deferred: name the commit that caused it, propose the smallest fix (add the test or revert the unintended change), and rerun the audit after the fix.

A WARNING does not block completion; it becomes a Follow-up concern and the user decides whether to handle it now.

## Report

```text
**[Legacy Git Audit 報告]**
審查範圍：<commit range>

## BLOCKER
1. <描述> — <file:line> — <原因>
（無則寫：無）

## WARNING
1. <描述> — <file:line> — 建議：<補測試／確認是否刻意>
（無則寫：無）

## SAFE
- <確認未受影響的 legacy 路徑>

## 結論
PASSED／FAILED（有 BLOCKER 即 FAILED）
```
