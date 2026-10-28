<p align="center"><img src="assets/icon.png" width="128" alt="SandBottle Maester"></p>

# SandBottle Maester

> A link cannot be forged by someone else.

Maester is a plugin for Claude Code and Codex that keeps you doing the part of the work that matters while building with AI:

- **`/maester:open`**: opens the local workbench, where you pick a past meeting or start a new one. A meeting is a 臨時動議: three masters and a Skeptic review the design, you decide the business rules, and the result becomes a Decision Table and TDD tasks. Then comes outside-in TDD: the AI writes the failing test; you write the code that makes it pass.
- **`/maester:stop`**: stops every Maester listener in this repo.

## Requirements

- Node.js 22.18 or later
- git

## Install

Claude Code:

```
/plugin marketplace add SandBottle-Official/SandBottle.Maester
/plugin install maester@maester
```

Codex:

```bash
codex plugin marketplace add SandBottle-Official/SandBottle.Maester
codex plugin add maester@maester
```

In Codex, run `/hooks` afterwards and trust the Maester hook.

## Notes

- Records are kept in `.maester/` inside the repo and are excluded from version control.
- Responses default to Traditional Chinese; ask the agent for another language at any time.
- The workbench uses port `4848` (override with `MAESTER_PORT`). If it does not open, check `~/.maester/server.log`.
- The workbench URL contains a key; do not share it. See [SECURITY.md](SECURITY.md).

## Development

```bash
npm ci
npm run check
```

## License

Code is released under the MIT License. The SandBottle name and logo are not covered by it; see [TRADEMARKS.md](TRADEMARKS.md).
