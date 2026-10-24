# Changelog

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
