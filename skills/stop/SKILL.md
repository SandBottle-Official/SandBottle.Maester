---
name: stop
description: Stop Maester in this repo — every `maester wait` listener of the repo, in any session, exits; the workbench page stays readable. Use when the user says /maester:stop, 停止 maester, 關掉 maester, or wants Maester to stop listening to the page.
---

# Stop

Respond in Traditional Chinese (zh-TW) unless the user explicitly asks for another language.

The CLI is `node <plugin-root>/bin/maester.mjs`; `<plugin-root>` is two directories above this SKILL.md.

Run `maester stop` inside the repo and stop any `maester wait` you started in this session. Every `maester wait` of this repo exits on its next poll printing `{ "stopped": true }`; never restart one after that. Report in one line that Maester stopped listening and that `/maester:open` starts it again.
