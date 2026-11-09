# ADR 0248 · The statistics of rules and notes leave with them

Date: 2026-11-09 · Status: accepted (owner, issue #369, «risolvi tutte le issue aperte») · Builds on: ADR 0122 (Memoria
hub), ADR 0202 (Andamento), ADR 0235 (recall check), ADR 0243 (topic files no longer loaded), ADR 0245 (Diario e note)

## Context
The skills-centric batch (#361-#368) removed what most statistics measured: topic rules are skills, role notes are gone,
the only memory left to read is `now.md`, the journal, `ideas.md` and `ai-errors.md`. Davide asked to prune the
statistics, trend and error sections built around rules and notes (#369). They now showed zeros, or numbers about files
no run reads.

## Decision
- **Memoria → Statistiche is gone.** Its parts counted lines per role memory, weekly growth of notes, the oldest and
  busiest memories, duplicates across role memories, and curious facts drawn from them. The one useful part, skill use,
  already lives in Memoria → Skill (uses per role, last use). `memoria/statistiche` and `stats` open the Skill tab.
  Gone with it: `brainmodel/memory-stats.ts`, `BrainModelState.memoryStats`, `MemoryInsights.tsx`, the clean-start card.
- **«Quanto ritrova la memoria» is gone** (ADR 0235): it measured the launch facts, which no longer feed chats.
  `rules/recall-check.ts`, the IPC `memory:recallCheck` and its demo card are removed.
- **Memoria's head** loses «Righe in memoria»; **the role cards** (Agenti card back, the role's page) lose «Memoria: N
  righe».
- **Qualità** keeps three numbers (corrections per 100 turns, PRs held, reopened bugs). The «Errori tornati dopo la
  regola» card, its clause in the lead, and the rule line of each recurring error pattern (and of its «Discuti» draft)
  are removed (`lib/quality.ts` ruleStats/outOfCount, `lib/stats.ts` rules).
- **Kept:** Costi, Uso, the app's errors, the error themes, the classifiers, Apprendimento (it measures changes to skills
  and roles; its lessons count reads the lessons queue, still in use), and the recurring error patterns themselves.
- Dead texts, styles and Guida points went with the code; the Guida says where skill use is now.

## Consequences
- An old link to the Statistiche tab lands on Skill, never on an empty page.
- Skill success rates (useful / weak / unused) are no longer shown as a table; the Skill tab shows uses per role. If a
  success column is wanted again, it belongs on the skill's own card.
- The map's rule nodes and the Approvate tab's rule files stay until the rules folder itself is retired.
- The «N righe fuori dal conteggio» warning lived in the rules card and went with it; unreadable ai-errors.md rows still
  show as «Formato non riconosciuto» among the patterns. The Guida's error cycle now ends in «Skill o controllo», not
  «Regola».
