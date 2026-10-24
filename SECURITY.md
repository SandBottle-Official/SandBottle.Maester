# Security

## What Maester runs on your machine

- **A SessionStart hook** (`hooks/hooks.json`) runs `node bin/maester.mjs ensure --hook` when a session starts. It only starts the local workbench server; it never prints output or fails the session.
- **A local HTTP server** bound to `127.0.0.1` (port `4848`, or `MAESTER_PORT`). It serves the workbench page and reads `.maester/maester.db` and git in repos you opened with Maester.
- **The `maester` CLI**, called by the skills. It reads and writes only `.maester/` in the current git repo, adds `.maester/` to `.git/info/exclude`, and runs read-only git commands (`log`, `show`, `diff`, `rev-parse`, `merge-base`).

Nothing is sent to any remote service by Maester itself. The page loads Shiki, CodeMirror and fonts from public CDNs (see `THIRD_PARTY_NOTICES.md`).

## Protections

- A random key in `~/.maester/key` (mode 600) is required for every API that reads repo data and for every button event. The page receives it through the URL that `maester open` prints.
- Requests whose `Host` is not `127.0.0.1:<port>` or `localhost:<port>` are rejected (DNS rebinding). Events also require a local `Origin`.
- Responses carry a Content-Security-Policy that allows scripts only from this server, the two pinned CDNs and hashed inline scripts, forbids framing (`frame-ancestors 'none'`), and send `Referrer-Policy: no-referrer`.
- All text from the database is HTML-escaped before rendering; line numbers are validated on write.
- Git is invoked without a shell; commit shas are validated before reaching git.

## What to keep in mind

- **Page events become instructions to your AI agent.** Anyone who has the workbench URL (it contains the key) can press buttons or send a message that the agent treats as yours. Do not share the URL or screenshots of the address bar.
- **Council documents and test code shown on the page come from what the agent read in your repo.** Treat a repo you do not trust the way you would treat its code.
- **CDN scripts run inside the workbench page.** Versions are pinned, but the code is fetched at runtime.

## Reporting a vulnerability

Please open a private security advisory on GitHub (Security → Report a vulnerability) instead of a public issue.
