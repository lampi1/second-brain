# 0218. «Balanced mode»: the engine, model and effort of a delegation follow the credits left

Date: 2026-11-01. Status: proposed (waiting for the owner's review).

## Context

The owner (2026-11-01): «se abilito la scelta modello automatica, lo Strategist o l'Orchestrator scelgano modelli ed
effort in base ai miei crediti disponibili, per tutti i provider attivi … anche Cursor; provando una chat e vedendo il
risultato; e in base ai dati, stats e performance salvati nell'app per livello agenti. Gli agenti abbiano anche il
ruolo suggerito. L'opzione si chiami Balanced mode. Deve essere una scelta rapida: non deve fare sempre il controllo dei
crediti, solo quando serve.» Then: «in pratica l'autodelega deve rendere omogeneo il consumo proporzionalmente ai
crediti rimasti». And: in OpenCode he linked his OpenAI account (OAuth, ChatGPT plan) next to the free Zen models;
each is its own source of credit.

The same day both OpenCode Zen's free credits and his OpenAI plan ran out. OpenCode never told the chat: it stopped.
Its log (`~/.local/share/opencode/log/opencode.log`, read 2026-11-01) has the cause:

- `providerID=opencode … error.error="AI_APICallError: Free usage limit reached. …"` (Zen free models)
- `providerID=openai … error.error="AI_APICallError: The usage limit has been reached"` (OpenAI via OAuth)

Today a role chat always runs on its card's engine with its tier's model (ADR 0210): nothing moves work away from a
provider whose credits are gone.

## Decision

A new setting **«Balanced mode»** (`balancedMode`, off by default, protected: it decides whose credits are spent). The
owner (2026-11-01): «non vorrei si chiamasse autodelega … scelta facilmente nel menu modelli dell'orchestrator, quando la
attivo tutti gli agenti vanno in … balanced mode». Its main switch is the first row of the Orchestrator's model menu
(ModelPicker, `orchestrator-model-balanced`); Impostazioni → Ruoli e deleghe mirrors it. While it is on, every role
card's model button reads «Balanced» (the card's own choice is kept and comes back when it goes off). Off: nothing
changes. On: every role chat that `app_create_chat` or `agent_delegate` starts gets its engine, model and effort from
`agents/balanced-mode.ts`, among the engines the caller may start, and the answer says who chose and why
(`route.reason`, `route.balanced.by`).

Then (same day): «no voglio lo scelga l'orchestrator in base ai dati in suo possesso». So **the delegating agent
chooses** (§3b) from the data of a read-only tool, and the formula of §3 is its proposal and the fallback when the agent
passes no choice.

### 1. Credit pools and how each is read

A **pool** is one source of credit: an engine, and for OpenCode the provider prefix of the model (`openai/gpt-6-astra`
→ `opencode:openai`, `opencode/…` → `opencode:zen`, any other prefix its own pool). `agents/credits.ts` `poolOf`.

| Pool | Readable? | How (no network, no tokens) | Period used |
|---|---|---|---|
| `claude` (subscription) | **yes** | the plan windows the app already reads (brain/usage.ts: stream-json `rate_limit_event`, `get_usage`, `~/.claude.json` cache): left = 1 − max(5 h %, 7 d %), reset = the binding window's | 5 h or 7 d, the binding one |
| `cursor` | **not readable** | no usage API for personal accounts (brain/usage.ts `CURSOR_PLAN_NOTE`; `cursor-models.json` lists models, not quota). Instead: a limit error in a Cursor turn (signal), then the half-open retry (§2) | 30 d (assumed) |
| `opencode:zen` (free models) | **partly**: only "finished" | OpenCode's own log: the last `Free usage limit reached` for `providerID=opencode` against the last stream start of that provider. `opencode stats` shows tokens and $0, never the quota | 1 d (assumed) |
| `opencode:openai` (ChatGPT plan via OAuth) | **partly**: only "finished" | the same log: `The usage limit has been reached` for `providerID=openai`. The plan's rate-limit headers are not logged by OpenCode and the Codex CLI is not installed: the percentage left is not readable. Instead: the error, plus the app's estimate (none: OpenCode reports $0) | 7 d (assumed, the plan's weekly window) |
| `opencode:<other>` | partly | the same log, any `providerID` | 30 d (assumed) |
| `codex` | **not yet read** | Codex app-server sends `account/rateLimits/updated` (chats/codex.ts ignores it today): a follow-up can feed it like Claude's. Until then: signals | 7 d |
| `anthropic-api` | not read here | the month's API spend is in engines/spend.ts; the plan's credit is not known to the app. Signals only | 30 d |

Every pool also learns from **signals**: a turn that ends in error whose text says the limit is reached (`usage
limit`, `limit reached`, `quota`, `insufficient_quota`, `credit balance`, `402`, `429`, `rate limit` …; `limitSignal`)
marks the pool exhausted at once, without any check. This is how Cursor, Codex and the API engines are known, and why
a stopped OpenCode chat counts as soon as its error reaches the app (the OpenCode chat fix surfaces it; the log probe
covers the gap).

### 2. Cache and «solo quando serve»

The state of each pool lives in `<userData>/credits.json` with the moment it was read: left (0..1 or unknown), reset,
status (`ok` · `low` · `exhausted` · `unknown` · `probation`), source. A pick reads only this cache and the run
statistics already in memory: **no network, no process, no file read on the hot path** (the cache file is read once at
start).

A check (`CreditBook.refresh`, local probes only: the usage monitor, OpenCode's log tail) runs only when
`needsCheck` says so:

- the pool has no state yet;
- its state is older than 30 min (`ok`/`low`/`unknown`);
- it is `exhausted` and its reset (or its cool-down) has passed;
- the delegation is costly (tier `top`) and the state is older than 5 min.

A signal never waits for a check: it writes the state directly. An `exhausted` pool whose reset is unknown gets a
cool-down (1 h, doubled at each new failure, at most 24 h); when it ends the pool goes to **probation**: the next
fitting delegation may go there with a quarter weight. That chat is the «chat di prova»: if it works, its turn end
sets the pool back to `ok`; if it hits the limit, the signal makes it `exhausted` again with a longer cool-down. No
token is spent only to test a pool.

### 3. The choice

Input: the role (its card: engine, own model, effort, tier, tierMax), the tier asked, the title and prompt, the engines
the caller may start. For each usable engine the candidate is the tier's model on it (agents/model-tier.ts: the
user's Impostazioni → Modelli per livello, then the registry), mapped to its pool.

1. **Quality floor** (from the stats the app keeps per role and level): over the runs of this role on this model with
   a counted verdict (`runsSuccess`, the same share the Agenti page shows), a candidate with enough verdicts (≥ 5) and
   less than 50 % success is left out. A candidate with fewer verdicts stays (unknown is not bad).
2. **Exhausted pools are left out.** If nothing is left, the role's own card is used and the reason says that every
   pool is out.
3. **Proportional share** (the owner: «omogeneo … proporzionalmente ai crediti rimasti»): each pool's weight is its
   pace, the credit left over the share of its period still to go: `w = left / max(timeLeft / period, 0.05)`, so a
   pool with credit that renews soon gets more work, and all pools run out together at their reset. Unknown left =
   0.5, unknown reset = half the period, probation = a quarter of the weight. The target share is `w / Σw`.
4. **Deficit pick** (deterministic): the app counts the balanced picks of the last 24 h per pool; the pool whose real
   share is furthest below its target wins. Ties: the role's own engine, then the higher success, then the lower mean
   cost. The same state gives the same pick, so the two reads of one launch (the route and the chat) agree; the pick
   is recorded right after the chat is created, so the next delegation, even in the same `agent_delegate` call, sees it.
5. **Effort**: the role's, else the tier's (light → low, mid → medium, top → high), lowered to one the model takes
   (`effortOn`), none when the engine takes none.

**Suggested role**: the kind of work of the title and prompt (`taskOf`) gives a role (review → Sentinel, research →
Scout, plan/design → Strategist, writing/communication → Herald, code → Artisan). The answer carries it as
`route.balanced.suggestedRole` when it differs from the role asked: a hint, never a change.

### 3b. The agent's choice

`balanced_status` (MCP, read-only, no network, on the app mount and on the chat mount for the roles that delegate)
returns: on/off; each pool with status, left, renewal, target and real share; the stats per role × model × kind of
work (runs, success, mean cost); the formula's proposal for a role; and a short how-to. The agent then passes
`balanced: { harness, model?, effort?, why }` to `app_create_chat` or to each task of `agent_delegate`. The app only
checks hard limits, in this order, and refuses with the reason: the engine is enabled and trusted; the caller may start
it; the model is not above the role's tierMax; the model is known on that engine; its pool is not exhausted. `balanced`
with the mode off is refused. `route.balanced.by` is `agent` or `formula`; the reason starts with «Balanced mode,
scelta dell'agente: <why> …» (plus what the formula proposed) or «Balanced mode, scelta della formula: …».

### 4. What the caller sees

`app_create_chat` and each child of `agent_delegate` answer with `route.reason`, e.g.
`Balanced mode, scelta della formula: opencode:openai (credito 70%, rinnovo tra 2 g) · quota 38% su obiettivo 45% · modello openai/gpt-6-astra · livello mid · 9 run, 78% riuscite`,
and `route.balanced` = `{ by, pool, share, target, skipped: [{ pool, why }], suggestedRole? }`.

## Consequences

- Off by default and protected: the stable app and every user who does not turn it on behave as before.
- The choice is fast and offline; the price is that a pool's real left is known only for Claude: for the others the
  app learns from errors, so the first chat after a quota ends still fails once (now visibly).
- A role card's engine is no longer binding while Balanced mode is on; tierMax and the tools, ceiling and skills of the
  role still are.
- Open: read Codex's `account/rateLimits/updated`; a real reset time for Zen and the ChatGPT plan (not exposed today).
