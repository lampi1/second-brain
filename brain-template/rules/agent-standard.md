---
when: {"prompt":["nuovo agente","scrivi un agente","agent file"],"tools":[],"paths":["**/.claude/agents/**"]}
---
# How to write a specialist agent ({{OWNER}}'s brain)

The standard every file in `.claude/agents/` follows (2026-10-10, Owner: "riscrivili bene ai massimi standard … non
vorrei fossero troppo"). Sources and measures: `reviews/2026-10-10-agenti.md`.
**Read when:** writing, changing, adding or removing an agent. **Write when:** {{OWNER}} changes how agents are written.

## When an agent, not a skill or a rule

- An agent is worth it when a job repeats (≥ 3 times in different chats), needs a **clean context** (big reads, a
  browser session, fresh eyes on a diff) and returns a **short result**. Otherwise: a rule, a skill or a script.
- **Few agents** (7 on 2026-10-10). Before adding one, check whether an existing agent can take the job as one more
  mode; an agent with no runs in 10 days is merged or removed.
- An agent is a fixed prompt **plus** six levers; set each on purpose: `description` (who calls it), `tools` (what it
  can do), `model` + `effort`, clean context, notebook (`playbooks/<name>.md`), report format.

## Frontmatter

```yaml
name: kebab-case, = file name
description: <what it does, one sentence>. Use when <{{OWNER}}'s words / situations>. Not for <X> (use <other agent>). <one hard limit>.
tools: minimal comma list (read-only agents: Bash, Read, Grep, Glob); MCP tools by exact name
model: opus            # harness/models.md: default, callers override by task kind; Cursor ignores it (model: inherit in the pointer)
effort: medium         # harness/models.md: every Opus run medium; high/xhigh only when {{OWNER}} asks
```

- `description` ≤ ~500 chars, English, third person: it is the only text the caller sees when choosing.
- No `Write`/`Edit` unless the job writes; a writer says in the body exactly where it may write.
- Cursor: no `tools` allowlist; `sync-agents.mjs` sets `readonly: true` only without a shell and without write tools.
  Claude-only tools (ToolSearch, `mcp__ccd_*`) may be named but the job must not depend on them.

## Body: always this order, 30-60 lines (hard max 80)

1. **Mission**: one sentence, task-scoped ("You review a diff you did not write"), no persona ("You are a senior…").
   Report language: Italian, code terms in English.
2. **Notebook line**, verbatim (owned by `ops/tools/playbook.mjs`): "Notebook: before working read
   `{{BRAIN}}/playbooks/<name>.md` and follow its "Punti"; end your final report with one line
   `Taccuino: usati <ids>` (or `Taccuino: nessuno`). Never edit the notebook yourself."
3. **Read first**: absolute paths, only what the job needs; rules live in their files, the agent points to them.
4. **Input**: what the caller must pass; what to do when it is missing (ask back in the report, never guess).
5. **Steps**: 3-7 numbered; exact commands only for fragile steps; heuristics for the rest.
6. **Rules**: few, each with its reason in a few words, calm wording (no CAPS); safety = one line pointing to
   `me.md` "Safety"; always "never search `{{HOME_WIN}}` recursively".
7. **Report**: exact format, verdict first, confirmed vs hypothesis, what could not be checked; max ~10 lines; long
   output goes to a file and the report gives its path.

## Never in an agent

- Rules copied from `me.md`, `AGENTS.md`, `code.md`, `rules/` (point to them: copies drift).
- Product knowledge (it lives in the repos' `AGENTS.md`/docs) or long lists of edge cases.
- "Double-check", "be thorough", "CRITICAL/MUST": Opus over-applies them.
- Bare work item/PR ids in the report text (`me.md` "Name things, not numbers").

## After a change

`node harness/cursor/sync-agents.mjs` (pointers; then `--check`), new or removed agent → `AGENTS` in
`ops/tools/playbook.mjs` + its notebook, `node ops/tools/brain-lint.mjs`, one real task of these days before/after,
the `code-review` skill on the diff, a line in `proposals.md`.
