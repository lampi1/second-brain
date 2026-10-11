# Memory map: where to read, when to write

The only index of {{BRAIN_NAME}}. Read when: before reading or writing any memory file, or when unsure where something
lives. Write when: a file or folder is added, renamed, split or retired (update its row).

**Chats get abandoned without warning**, so `now.md` must always say where each thread is. Write only on change: a
thread's `now.md` line when its state or next step changes; today's `journal/` only `fatto`, `attrito`/`interruzione`
(estimated minutes + source), `decisione`, `lezione`. Write these lines and `ai-errors.md` ones with
`node {{BRAIN}}/ops/tools/mem.mjs` (always the main checkout, from worktrees too); the commit is automatic.
"Riprendiamo" → read `now.md`, then the previous sessions (`node ops/tools/session-find.mjs <words>`).

| File | Holds | Read when | Write when |
|------|-------|-----------|------------|
| `AGENTS.md` | Short boot index: hard rules, on-demand pointers, routing | Every session | Only to add a hard rule or a pointer; keep it ≤ ~70 lines |
| `me.md` | Who {{OWNER}} is, how to work with them, safety rules, machine | Every session, first | {{OWNER}} states a preference or corrects how you work |
| `hub.md` | Orchestrator: how the hub "Regia" runs work chats and decisions | You are the hub | A hub rule changes |
| `code.md` | Code work: repos, review, definition of done | Any code work | A code-work rule changes |
| `now.md` | Open threads: what is in progress, where, next step | "Cosa devo fare oggi", resuming anything | A thread opens, moves or closes (closed → removed) |
| `journal/` | Daily diary, tagged lines (`journal/index.md`) | "Cosa ho fatto oggi", a review | `fatto`, `attrito`, `interruzione`, `decisione`, `lezione`; append-only |
| `ideas.md` | Ideas and reflections to pick up later | "Che idee avevo?", due dates | {{OWNER}} asks ("segnatelo") or a reflection is worth keeping (`mem.mjs idea`) |
| `routines.md` | Recurring procedures, run only on request | The request matches a routine | A recurring procedure is learned |
| `ops/AGENTS.md` | Production rules and commands of {{OWNER}}'s job | Production, customers, incidents | Production rules change |
| `ops/runbook/` | Procedures, one file per topic (`index.md`) | A problem is described (search it first) | A procedure is learned |
| `brain-rules.md` | How the brain itself is changed | Before changing any rule, skill, agent or test | {{OWNER}} changes how the brain is edited |
| `tests/behavior.md` | Behaviour test cases, one per real correction | Before changing a rule; "testa il cervello" | {{OWNER}} corrects a behaviour |
| `proposals.md` | Every improvement proposal with its metric and outcome | Before proposing an improvement | A proposal is made, answered, applied or measured |
| `ai-errors.md` | Every AI error, one line, permanent | A review; "che errori fa l'IA?" | A correction or a proven wrong claim (`mem.mjs error`) |
| `ai-wins.md` | {{OWNER}}'s explicit praise, one line, permanent | With `ai-errors.md` in a review | Never by hand: the hooks write it |
| `ai-reflections.md` | The AI's own reasoning about itself and the work | A review; "come sta andando l'IA?" | Only `mem.mjs riflessione`, at the end of a job, at most one a day per chat |
| `playbooks/` | One notebook per specialist agent | Only by that specialist at its start | Only via `ops/tools/playbook.mjs` |
| `harness/tools.md` | Claude tool → Cursor equivalent | You run in Cursor; a rule must work in both | A tool of either harness changes |
| `harness/cursor/` | Cursor adapters (context boot, guards, chat reader, agent pointers) | Something must work in Cursor too | A rule changes how Cursor must behave |

## Growth and maintenance

- **New kind of knowledge** that fits no file → propose a new file to {{OWNER}}; once agreed, create it with the
  standard header (purpose, Read when, Write when) and add a row here. This map is the only index.
- **A file past ~200 lines** → split it into a folder with an `index.md`. `node ops/tools/brain-lint.mjs` measures it.
- **Maintenance**: only when {{OWNER}} asks ("fai manutenzione").

## Layout

`AGENTS.md map.md hub.md code.md me.md now.md ideas.md routines.md` · `journal/` · `ops/` (AGENTS.md, runbook/,
tools/: `mem.mjs` memory lines, `inbox.mjs` mail between chats, `chat-prompt.mjs` new-chat prompts, `day.mjs`
brief/report, `cost.mjs` costs, `wt-land.mjs` worktree → main, `brain-lint.mjs` checks, `brain-site.mjs` local site,
`playbook.mjs` notebooks, `session-find.mjs` old chats; offline tests `node ops/tools/test.mjs`) · `rules/` ·
`.claude/` (agents/, hooks/) · `harness/` · `playbooks/` · `tests/`.
