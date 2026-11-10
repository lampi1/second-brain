# ADR 0257 · Skill changes come only from Maintenance, never one card per run

Date: 2026-11-10 · Status: accepted (owner, 2026-11-10: «le proposte di modifica skill fossero solo dopo la
manutenzione non ogni volta … deve essere la manutenzione con un modello forte che propone modifiche se veramente
necessarie negli standard di scrittura skill»; «proposte di modifica o nuove skill in base alla lettura da parte della
manutenzione di tutte le chat e i fili di lavoro dall'ultima manutenzione») · Supersedes in part: ADR 0242 (lessons
the user approves one at a time)

## Context
Since ADR 0242 every `remember` line of agent_report and every memory_propose became a card in Memoria → Proposte.
Davide got too many role-skill cards: one per run, most of them not worth a change.

## Decision
- **A lesson is noted, never a card** (`skills/lessons.ts`): the line waits in `userData/skill-lessons.json` with state
  `noted`; the same line again counts one more `seen` and points to the latest chat and run; the least recently noted
  beyond 200 leave (logged). The Proposte deck has no lesson
  source any more. A card made before this ADR (`open`) reads as noted, so the old cards leave the deck and wait for
  Maintenance too; one the user already approved or rejected stays decided.
- **Maintenance reads it with the chats** (`brainmodel/research.ts`): the research (the strongest model of an engine
  that is on, ADR 0132) gets the inventory of every chat and work thread active since the previous research that ended
  done or capped (the start of that run; 30 days back the first time; at most 200, newest first, each read on demand,
  whole: the user's messages, agent and Orchestrator mail marked as not the user's, the answers, every tool with its
  status and a short excerpt of a failed one's output, the app's warnings; no thinking; a long chat starts at its
  first item since the previous pass; secrets in command lines and errors are removed: auth headers, JWTs, passwords
  of connection strings, values of keys named like a secret) and the section
  `lessons` (the noted lines by skill, most repeated first, between the pack's nonce markers, private paths removed).
- **Only when really needed, to the standard**: the research frame says skills are the main job of the pass, that a
  noted line alone is not a reason, and gives the skill-writing standard (a brain skill about writing skills comes
  first; one skill per task area; the Agent Skills format, whose source is
  [agentskills.io/specification](https://agentskills.io/specification): only `SKILL.md` is required, with `name` equal
  to the folder and a `description` of what it does and when to use it, while `scripts/`, `references/` and `assets/`
  are optional; a short procedure under 500 lines, nothing case-specific; long text in references/, code in scripts/).
  Changes go through maintenance_propose kind `skill` as any brain change: a card with a diff and Undo, within the
  research's caps.
- **Read once**: when a research that opened the `lessons` section ends done or capped, the noted lines it was shown
  become `reviewed`; one that never opened it, or was stopped or failed, shows them again next time. A line noted again
  after the research took its copy, or after it was reviewed, waits again (it came back).
- The agents' texts (agent_report `remember`, memory_propose, the role frame) say the line is noted for Maintenance and
  the user is not asked about each one.

## Consequences
- Skill changes now wait for a «Manutenzione» click; nothing reaches a skill between two passes.
- With more than 200 active chats since the previous pass the research sees only the newest 200.
- The research store keeps its last 30 runs: after 30 runs without one that ended done or capped the window falls back
  to 30 days.
