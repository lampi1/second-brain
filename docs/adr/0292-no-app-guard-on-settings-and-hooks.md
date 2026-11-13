# ADR 0292 · No permission question outside the brain's rules: the app's guard on settings and hooks is removed

Date: 2026-11-13 · Status: accepted (owner, thread «Preparare la 1.0 con analisi profonda», after ADR 0290 went to
his PC: «adesso che hai tolto l'auto mi compaiono un sacco di domande non ti avevo detto basta sempre permessi
concessi sempre per tutte le harness? tranne quelli del brain») · Supersedes: the settings-and-hooks guard of ADR
0254 and ADR 0290 («rule 6» in `auto-permit.ts`), the «edit that names no file» ask · Builds on: ADR 0254, ADR 0290

## Context

ADR 0254 said the app has no opinion of its own on what is dangerous, and kept one: a request that could change the
agents' settings or hooks asked the user. To see a command that builds such a path, the guard asked for every
`$(…)` glued to a path, every `printf` with an escape, every place under `.git`, `.claude`, `.cursor`, `.codex`,
`.vscode`, `.idea`. While Claude Code's «auto» mode answered most requests before the app, few of these reached it.
With ADR 0290 every request of a Claude chat reaches the app, and the guard turned ordinary work into questions.
Tried on ordinary commands with the owner's example rules: `DIR=$(pwd)/out; mkdir -p "$DIR"`, `cp "$(pwd)/a" b`,
`ls $(git rev-parse --show-toplevel)/src`, `gh pr create --body "$(cat <<'EOF' …)"`, `rm .git/index.lock`, a new
skill under `.claude/skills`, an edit under `.cursor/agents` all asked. The owner had already said it earlier
on the same day: everything is allowed unless a rule of his brain holds it.

On the other engines a second cause: the app judged the copy of the input shortened for the screen (a string over
4000 characters), and a shortened request always went to the user.

## Decision

1. `auto-permit.ts` keeps no guard on settings or hooks and no «edit that names no file» ask. A user who wants the
   old guard writes it as a rule of `permissions.json` (for example `tools: ["*"]`, `match:
   ["\\.claude[\\\\/]settings", "\\.git[\\\\/]hooks"]`, `action: "ask-user"`).
2. What still reaches the user: what a rule of the brain holds (`ask-user`; `esegui` and `never-print` refuse), a
   request under rules that cannot be read (a broken file, a part over the limit, the time budget of ADR 0290), what
   a role the user limited on its card asks, a plan to approve, a real question of the agent.
3. One thing is the user's by its nature: a change of the brain's rules file itself, when the brain has one. An
   agent that may rewrite the rules has none, and «except the brain's» would mean nothing. It asks, with no
   «always»: a tool that names the file; a command with it among its words, read from the chat's folder and from
   the folders the line itself moves to (`cd x`, `git -C x`), home in its usual spellings (`~`, `$HOME`,
   `%USERPROFILE%`, Git Bash `/c/…` on Windows); a word that ends in `permissions.json` through a variable or a
   move the app cannot read (it does not know where it lands); Codex's session-long grant of a folder that holds
   the file; on OpenCode an edit of any `permissions.json` reaches the app, which asks only for the brain's.
   Reading it with a reader the app knows is free; writing the first rules of a brain that has none is free. The
   Orchestrator may answer this request for the user, as any other (ADR 0275).
   It is a net by name, not a wall. Not seen: a command that reaches the file without naming it (`git checkout --
   .`, `git stash`, `rm -f *.json` in the brain's folder), a later command after an earlier one moved the shell
   there, an edit Codex makes inside its own workspace without asking. The brain is a git repository: a change of
   the file shows in its history.
4. The checks that exist only so the rules can read what will run (a command with no line, a request an engine cut,
   Codex's session-long `grantRoot`) ask only where some rule could hold that tool. With no rule on it they pass.
5. Codex (commands, file changes, MCP calls) and the ACP engines (Cursor, OpenCode) send the whole input beside
   the short copy, as Claude does since ADR 0290: the request's own, or the one its tool call brought earlier (kept
   whole by the session while the call runs; OpenCode's request comes with none). The app's answer reads what will
   run, the panel shows the short one. When no whole input is known the app judges the short copy, and a cut one
   asks only under point 4.

## Consequences

- An agent may change `.claude/settings.json`, hooks, an engine's MCP list or git's configuration without asking.
  This is the owner's choice for his app; the rule in point 1 puts the question back for who wants it.
- The role gate is unchanged (it refuses, it never asks): an engine sub-agent other than a search, a request beyond
  the delegating chat's permissions.
- AGENTS.md rule 6 is unchanged: it is about what the app and the agents working on this repository do to the
  user's Claude and Cursor configuration, not about a guard at run time.
- Tests: `test/unit/chats/auto-permit.test.ts` (what the old guard asked now passes; the rules file; the checks
  only under a rule), `agent-policy-manager.test.ts` (a shortened request under a rule and without one),
  `whole-input.test.ts` (what Codex and the ACP engines hand over as whole).
- Known limit, older than this ADR: an ACP engine's request shows a decorated title, so a rule that names an MCP
  tool exactly may not see it there; a rule on `*` or on the text does.
- Not tried on a real PC yet.
