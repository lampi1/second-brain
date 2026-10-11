# brain-template

The empty brain. Do not edit it in place: run `node brain-template/install.mjs` (from the repo root) to create your
own brain folder from it. `{{...}}` placeholders are filled by the installer with your answers.

Layout after install: `AGENTS.md` (boot index for every agent), `map.md` (where everything lives), `me.md` (you),
`hub.md`, `code.md`, `routines.md`, `brain-rules.md`, memory files (`now.md`, `journal/`, `ideas.md`, `ai-errors.md`,
`ai-wins.md`, `ai-reflections.md`, `proposals.md`, `tests/behavior.md`, `playbooks/`), `ops/` (your production
runbooks, empty, and the generic tools in `ops/tools/`), `.claude/` (agents, hooks), `harness/` (Claude and Cursor
adapters, skills, output style, hook wiring).
