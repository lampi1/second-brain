# ADR 0032 · Model routing: a versioned table picks harness, model and effort per kind of task

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
  `{kind | '*', area?, harness, model, effort, why, since, evidence}`; the most specific row wins (kind and area > kind
  > area > any). The brain's `ops/tools/routing.mjs` and the app's `brain/routing.ts` apply the same rules.
- **Hard rules** (a table that breaks one is not saved; an agent's override that breaks one is refused): a model runs
  only on its own harness; the table picks only auto models of auto harnesses; chats on the app (areas `App`,
  `Pers · App`, the "Migliora l'app" space) never run on Cursor; effort is one the model offers and only for Claude;
  `max` never comes from the table, only from an agent naming it with a reason; every row has a "perché".
- **`app_create_chat`** gains `kind`, `effort` and `reason`. Omitted harness/model/effort: the table decides; no row:
  the user's "Chat aperte dalla Regia", per engine (naming an engine takes that engine's default model), as before.
  Naming something other than a row says is an override and needs `reason`; with no row naming stays free. A known
  model id brings its own engine. Routed only at chat creation: changing model or effort mid-chat restarts the prompt
  cache. The decision (`RouteDecision`: source table/default/override, reason, kind, area, table version) is stored on
  the chat (`ChatSummary.route`, `chats.json`) and returned to the agent.
- **Outcomes**: each routed chat writes into the improvement loop's shared ledger
  (`ops/state/improve/outcomes.jsonl`, append-only, the same id = the later line wins) one prediction at its first turn
  end (`domain 'routing'`, id `app:<chatId>`, item, `predicted {policy: 'routing', version, value}`) and its measured
  actuals at every turn end (`usd, minutes, turns, ctxPeak, handoffs`) with `outcome.known: false`: success needs the
  user's corrections and reopenings, which the loop settles. These two kinds of files are the only ones the app writes
  into the brain, and only under `ops/state/` (the brain's untracked state).
- **Settings**: Impostazioni → «Instradamento modelli» edits the table (`routing:get` / `routing:save`, by
  "utente (Impostazioni)"). Only the user writes it: the renderer is the user's (IPC sender check); agents only propose
  in chat. The app's Regia prompt says to omit model and effort and to give a reason for an override.
- **Exploration** (2026-10-13): with probability `exploration` (0 to 0.5, set in the brain; 0 = off) a chat whose
  agent named nothing tries another arm (harness, model, effort) instead: the one with the fewest routing predictions
  of its task kind in the ledger, among auto models on engines the caller may start, never max, never the arm it would
  get anyway, and only while under 20 samples (the loop's minimum per arm). Never for the app's chats or a Regia.
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
