# ADR 0088 · The brain without the app: a shareable zip and a standalone install

> Amended by ADR 0156 (2026-10-24): a routine package may carry the memory of the roles that routine uses, on the user's
> switch.
> Amended by ADR 0125 (2026-10-22): the agent pack import/export this ADR builds on is gone; the shareable brain zip
> stays, with the parts it shares (`pack/zip.ts`, `toml.ts`, `rules.ts packRules`, the guard scan).

Date: 2026-10-20 · Status: accepted (owner, 2026-10-20: «vorrei che il brain fosse esportabile e condivisibile con i
colleghi che magari lo usano anche loro dalla loro harness magari slegata da quest'app … che si esportasse uno zip che
il brain fosse semplice da usare anche su Cursor o Claude Code o Codex senza per forza passare dall'app»; «vorrei anche
che si potesse da GitHub scaricare e usare solo il brain partendo da zero») · Builds on: ADR 0069/0077 (agent packs:
skills, rules, TOOLS.md, never memory), ADR 0072 (a fresh brain starts empty), ADR 0076 (brain scripts)

## Context
The brain is already a folder of Markdown files with an `AGENTS.md` index, the file Codex and Cursor read by
themselves and Claude Code reads through `CLAUDE.md`. Two things kept it tied to the app: an agent pack carries one
role at a time, and a brain created by `brain-template/install.mjs` had its skills only in `harness/claude/skills/`,
reachable by Claude Code only after copying them into `~/.claude` (`--user-config`) and by Codex never.

Each tool looks for skills in its own folder: Claude Code in `.claude/skills/`; Codex in `.agents/skills/`; Cursor in
`.agents/skills/` and `.cursor/skills/`, and also reads `.claude/skills/` for compatibility (cursor.com/docs/skills,
developers.openai.com/codex/skills, read 2026-10-20). Subagents: `.claude/agents/*.md`, `.cursor/agents/*.md`,
`.codex/agents/*.toml` (the same projections the agent packs already write, `pack/emit.ts` `emitTarget`).

## Decision
1. **Settings → Il mio spazio → "Condividi il brain"** (`BrainShareSetting.tsx`, IPC `brain:share`,
   `src/main/agents/pack/brain-share.ts`) writes one zip:
   - `AGENTS.md` generated for the reader's agent: hard rules, the rules table (each rule's `when` in words), the
     skills with their descriptions, the roles, the scripts; `CLAUDE.md` imports it; `README.md` (Italian) tells the
     person how to open it in Claude Code, Cursor or Codex, or copy it into a repository root;
   - the brain's rules as `rules/<name>.md` (`pack/rules.ts` `packRules`, the same selection as a pack);
   - the brain's own skills (`<brain>/.agents/skills`, then `<brain>/.claude/skills`; never the user's home), each in
     both `.agents/skills/` and `.claude/skills/`, `hooks` frontmatter dropped, binaries, links and files over 2 MB
     left out and counted; a role's own know-how travels as a skill named after the role;
   - the eight work roles as subagents for each tool, their instructions plus one line mapping the app's delegation
     tools to the tool's own subagents;
   - the brain's `scripts/` (flat, script extensions only, not `.deleted/`).
   Never memory: `me.md`, `now.md`, the journal, `memory/` and `agents/<id>/memory.md` are not read. The whole zip goes
   through the guard scan an agent pack uses (`scanTree`, the domains' deny lists); with findings nothing is written
   and the setting lists file:line and rule. The zip limits are wider than a pack's (`BRAIN_ZIP_LIMITS`).
2. **Standalone install from GitHub**: `node brain-template/install.mjs` also copies the template's skills into the new
   brain's `.claude/skills/` and `.agents/skills/`, so the folder works when opened in any of the three tools without
   the app and without touching the home folder. README section "Only the brain, without the app".

## Consequences
- A skill is duplicated in the zip and in a standalone brain (two folders). Cursor may list it twice if it reads both
  folders; accepted over a symlink, which a zip and Windows do not keep. The README in the zip says to edit both.
- The zip is a snapshot: a colleague's changes do not flow back. Importing it into the app is not part of this ADR.
- No new dependency: the zip writer is the packs' (`pack/zip.ts`, now with a limits parameter).
