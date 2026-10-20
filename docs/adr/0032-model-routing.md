# ADR 0032 · Model routing: a versioned table picks harness, model and effort per kind of task

> Routing parts superseded by [ADR 0078](0078-agent-first-routing.md): an agent's profile decides engine, model and
> effort; the table only fills a model the profile leaves open, and the override rule applies only to agentless chats.

Date: 2026-10-13 · Status: accepted

## Context
The Regia opened every work chat with the same engine, model and effort (the user's "Chat aperte dalla Regia"), and
the brain's rule said "no engine switching". A log read, a triage and a hard bug fix cost the same model. The owner
(2026-10-13): the Regia chooses model and effort per kind of work, tracked and improved over time, configurable; Claude
first, built so Cursor and private APIs fit later. The $ figures were off too: cost weights (Sonnet ×0.7, Haiku ×0.2,
one cache-read factor) did not match the real per-model prices.

## Decision
- **One price table and model registry in the brain**: `harness/models.json` (harnesses, models with aliases, real
  list prices: input, cache write 5 min / 1 h, cache read, output, long-prompt tier, fast factor, efforts). The brain's
  `ops/tools/prices.mjs` and `cost.mjs` price with it; the app's live turn cost (`chats/live-cost.ts`) reads the same
  file (`setPriceTable` from wiring), Opus 5.5 list price without a brain. A row is `routing: 'auto'` (the table may
  pick it) or `'manual'` (only when named); today only Claude rows are auto.
- **Task kind**: the brain's zero-token classifier (`estimates.mjs` `TASKS`, travelling in `estimates.json` as
  `tasks`): qa-run, review, bug-fix, ops-read, writing, triage, research-web, investigation, app-feature, regia, altro.
  The area is the title's label (`areaOf`, the same as the estimates). The estimates keep their own kinds.
- **The table** lives in the brain: `ops/state/improve/routing/v<N>.json` + `current.json` `{version, appliedAt, by}`;
  every save is a new version plus one line in `ops/state/improve/audit.jsonl`; old versions stay. A row is
  `{kind | '*', area?, harness, model, effort, why, since, evidence}`; the most specific row wins (kind and area > area >
  kind > any; an area row beats a kind-only row since 2026-10-14, so "App · any" keeps every app chat on its model: an area row carries a rule of the user's ("i lavori sull'app sempre
  in opus medio"), a kind-only row is a guess on the kind read from the title and the one the brain's loop changes, so
  a kind row never takes an area's chats; the stable build before that ranked kind first and sent an "App · …" chat
  read as qa-run to Sonnet). The brain's `ops/tools/routing.mjs` and the app's `brain/routing.ts` apply the same rules.
- **Hard rules** (a table that breaks one is not saved; an agent's override that breaks one is refused): a model runs
  only on its own harness; the table picks only auto models of auto harnesses; chats on the app (areas `App`,
  `Pers · App`, the "Migliora l'app" space) never run on Cursor; effort is one the model offers and only for Claude;
  `max` never comes from the table, only from an agent naming it with a reason. Every row an agent writes has a
  "perché"; the user may leave it out (2026-10-14, "non deve essere richiesto il motivo e mi aspetto che dopo
  l'aggiornamento lo scrivi te non io": the brain's loop fills an empty or placeholder one with the data, as an agent's
  version, without touching model or effort). Since
  2026-10-14 also: never Fable (the user: "non userei fable costa troppo"; neither a row nor exploration), and a row for
  the app's chats names only the registry's `appChats` model and effort (Opus 5.5 medium: "i lavori sull'app sempre in
  opus medio"; other Claude models reach them only through exploration).
- **`app_create_chat`** gains `kind`, `effort` and `reason`. Omitted harness/model/effort: the table decides; no row:
  the user's "Chat aperte dalla Regia", per engine (naming an engine takes that engine's default model), as before.
  Naming something other than a row says is an override and needs `reason`; with no row naming stays free. A known
  model id brings its own engine. Routed only at chat creation: changing model or effort mid-chat restarts the prompt
  cache. The decision (`RouteDecision`: source table/default/override, reason, kind, area, table version) is stored on
  the chat (`ChatSummary.route`, `chats.json`) and returned to the agent.
- **DevOps "Apri chat"** (2026-10-14, the user: "quando dalla sezione devops premo fai partire chat mi aspetto che
  comunque passi dalle configurazioni di scelta del modello") goes through the same decision (`chat:createRouted`,
  `main/chats/routed.ts`): the record gives the kind when it says it (a bug → bug-fix, a PR → review, a test plan or
  case → qa-run; else the brain's rules on the item's type and title) and the area (its project or repo, which an area
  row can name); no row: the user's last "Nuova chat" choice, as before. The chat carries its route, so it reaches the
  ledger like the Regia's.
- **The other user paths** (2026-10-14, the user's choice in a panel of the Regia dell'app) go through it too: a brain
  page's "Apri una chat" (Discuss.tsx), a new Regia (Ricomincia da capo, Cambia motore, Pulisci: kind `regia`, the
  engine the user picked is an override with its reason) and the "Regia dell'app" (improve/service.ts: kind `regia`,
  area App, so the app's hard rule holds: on Cursor it is refused, never moved). Only the "Nuova chat" dialog is not
  routed: there the user chooses everything.
- **Outcomes**: each routed chat writes into the improvement loop's shared ledger
  (`ops/state/improve/outcomes.jsonl`, append-only, the same id = the later line wins) one prediction at its first turn
  end (`domain 'routing'`, id `app:<chatId>`, item, `predicted {policy: 'routing', version, value}`) and its measured
  actuals at every turn end (`usd, minutes, turns, ctxPeak, handoffs`) with `outcome.known: false`: success needs the
  user's corrections and reopenings, which the loop settles. These two kinds of files are the only ones the app writes
  into the brain, and only under `ops/state/` (the brain's untracked state).
- **Who writes it** (changed 2026-10-14, the user: "l'AI in completa autonomia possa definire i modelli delle nuove
  chat e sub agenti. Io voglio solo vedere le impostazioni e modificarle tanto quanto lei"): an agent writes a new
  version by itself, with no ok, through the MCP tool `app_routing_save` (the whole table + `reason` + `evidence`, by
  "agente: <its title>"; `app_routing` reads it) or the brain's `routing.mjs save --file … --reason … --evidence … --by …`.
  The user edits the same table in Impostazioni → «Instradamento modelli» (`routing:save`, by "utente (Impostazioni)")
  and sees the Cronologia: every change from `audit.jsonl` with who, when, why and the data; «Ripristina»
  (`routing:restore`; agents: `routing.mjs restore <N>`, always an agent's restore whatever `--by` says) brings an older version back as a new version, checked against today's
  rules. Both paths apply the same hard rules; a save that breaks one writes nothing. Every save names the version it
  started from (`baseVersion`, `--base`): another version in force since then refuses it (two writers send whole tables:
  never undo the other's change in silence). A table with rows has the row "any kind · App, Pers · App" on `appChats`
  (a kind-only row would otherwise route the app's chats). Sub-agents follow the same table.
  The app's Regia prompt says to omit model and effort and to give a reason for an override.
- **The user's switches** (2026-10-14, "ogni configurazione voglio che abbia un toggle che se lo disabilito blocca
  all'app la possibilità di modificare quel modello per quel task in autonomia ma di default tutti modificabili"): a row
  has `locked` (the page's «L'AI può cambiarla» off). No agent changes, removes, locks or unlocks a locked row,
  nor adds or moves a row that would win its chats (more specific, or as specific and earlier) (`agentLimits`, in both
  rule files; an agent's restore too), and exploration leaves its chats alone. The table's
  `costWeight` (0-10, default 7: the λ the user chose that day, like OpenRouter's `cost_quality_tradeoff`) is the user's
  only, a field of the page saved like the exploration.
- **The daily loop** (the brain's `ops/improve/routing-loop.mjs`, the 10-point design the user approved on 2026-10-14):
  zero tokens, run by `estimates.mjs --update`. For each unlocked kind-only row it compares the row's arm with every
  other arm of the same engine the table would accept in that row on the settled outcomes of the app's chats: quality as Beta(1+successes, 1+failures)
  drawn Thompson-style, cost as the mean measured $ relative to the row's, utility = quality − (λ/10)·relative cost. A
  challenger replaces the row only with ≥ 20 known outcomes on both sides, P(better) ≥ 0.9 and a quality at most 5
  points lower; the guard puts the old row back when the new arm's own 20 outcomes fall more than 5 points below, and
  never tries that arm again for that kind. Every change is an agent's version ("agente: loop modelli") with the numbers
  in the audit line. At every run it also writes the "perché" the user left out, from the data, without touching model
  or effort. Considered and left for later: a FrugalGPT cascade (cheap model first, escalate on failure) and a
  RouteLLM-style router learned on the prompt, once each kind has a few hundred outcomes.
- **Exploration** (2026-10-13; the field «Esplorazione» 0-50% since 2026-10-14, saved like the rows, its change in the
  audit line): with probability `exploration` (0 = off) a chat whose
  agent named nothing tries another arm (harness, model, effort) instead: the one with the fewest routing predictions
  of its task kind in the ledger (the app's chats only, `app:` ids), among auto models of the engine the chat gets
  anyway (an app chat stays on Claude, a Cursor work chat on Cursor: never the other engine's tokens), never Fable,
  never max, never the arm it would get anyway, and only while under 20 samples (the loop's minimum per arm). Never
  for a Regia.
  The route says `source: 'explore'` and why; the ledger keeps it like any other prediction.
- **Not in the app**: the routing report, the success outcomes (`known: true`, from the brain's ai-errors.md) and the
  panel of proposals belong to the shared improvement loop in the brain.

## Consequences
- The Regia spends less on routine work without asking, and every exception carries its reason in the logs and the
  ledger. Prices and the top bar's "Oggi" match the providers' list prices.
- The rules live twice (`routing.mjs` in the brain, `routing.ts` in the app): both are unit-tested on the same cases;
  a change to one needs the other.
- A Cursor chat titled "App · …" is now refused; an agent must use another title or Claude.
- No new dependency.

> Chat-space behavior above is historical: [ADR 0071](0071-all-workers-in-grindhouse.md) removes the app partition. All workers live in the Grindhouse; source-code launch checks remain.
