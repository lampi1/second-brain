---
name: {{BRAIN_NAME}}
description: {{OWNER}}'s personal operating system ({{BRAIN_WIN}}). Use from any chat or repo for "cosa devo fare oggi", "a che punto eravamo", open threads; production and incidents (runbooks); saving or recalling ideas and reflections ("segnatelo", "che idee avevo?"); recurring chores; or when {{OWNER}} states a preference about how to work.
---

# {{BRAIN_NAME}}

Read `{{BRAIN_WIN}}\AGENTS.md` first and follow it: it is the canonical index (hard rules, what to read on demand,
routing by intent). `me.md` is already in context through `~/.claude/CLAUDE.md`.

- Memory lines (now, journal, errors, ideas): only with `node {{BRAIN}}/ops/tools/mem.mjs` (the main checkout, from
  worktrees too).
- A preference or a correction about how to work → the `brain-editor` agent with {{OWNER}}'s exact words.
