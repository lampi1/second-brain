# Words used everywhere

The product's vocabulary, used the same way in code, docs, UI and chats. Moved here from `AGENTS.md` (ADR 0198); the map
there points to this page.

- **Orchestrator** = the coordinating chat and the one place where work starts (it plans, opens role chats, answers
  their mail; a full-height column on the right; it sees the work chats' state and the user's own messages to them,
  never their content, ADR 0083).
- **role** = one of the five fixed work roles (Strategist, Scout, Artisan, Sentinel, Herald) or the Orchestrator, that
  a chat runs (Router, Judge and Scribe are retired, ADR 0100).
- **delegation** = a role chat starting visible child chats with `agent_delegate` (permissions only go down, questions
  go to the parent first, one `agent_report` back, ADR 0083).
- **Grindhouse** = the home page, the one place for the agents (a strip each, the browsers they drive under them; the
  old Mosaico / Corsie views are retired, ADR 0068).
- **agent** = who works: a chat running a role, whose tools, ceiling, tier and skills decide its engine, model and
  permissions (not a per-chat choice or a routing row, ADR 0078, 0083).
- **skill** = how a job is done (`SKILL.md`, shared, loaded on demand; there are no "procedures", ADR 0077).
- **Brain** section = Agenti, Memoria (the hub: Proposte, Approvate, Skill, Regole, Script & Query, Idee, File,
  Apprendimento, Statistiche as tabs; no Dashboard, ADR 0122), Classificatori, Mappa.
- **brain** = the user's folder of notes, rules and tools the agents read and write (a template ships in the product;
  a fresh install starts empty).
- **Task** = the page of the user's work items and PRs (Azure DevOps, read only; called DevOps before ADR 0079).
- **stable / dev** = the user's frozen release vs. anything run from this repo (see `docs/agents/stable-dev.md`).
- **Aggiorna** (the button, Settings → Aggiornamenti) = update the app to main's tip.
