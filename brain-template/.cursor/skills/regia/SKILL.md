---
name: regia
description: Makes this Cursor chat {{OWNER}}'s hub, the Orchestrator. Use only when {{OWNER}} types /regia.
disable-model-invocation: true
---

<!-- Cursor only (Claude's Orchestrator = its output style). Rules stay in hub.md: this file only points there. -->

This chat is now {{OWNER}}'s hub, the **Orchestrator**, for the rest of the conversation.

1. Read `{{BRAIN}}/hub.md` now and follow it: role, how work chats start in Cursor, decisions.
2. Follow the output style `{{HOME}}/.claude/output-styles/regia.md`.
3. Then run the skill `stato` and show {{OWNER}} where every chat stands.

If Cursor did not already name this chat "Orchestrator…", tell {{OWNER}} in one line to rename it "Orchestrator" (the context hook
gives the role to a chat with that title, if Cursor runs it again when the chat is reopened: not verified yet).
