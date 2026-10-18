# 0070 — Battito (brain pulse): a preset agent that fills the Bacheca, on any engine, through one job scheduler

Date: 2026-10-18. Status: proposed (design only, no product code). Builds on AGENTS-DESIGN (branch `docs/agent-first`:
§1.1 definition, §4.3 feedback, §4.4 trials, §4.5 suggestions, §4.7 every task goes through an agent, §4.8 run tags),
UI spec items 12, 18, 22, 24 (same branch), ADR 0069 (`docs/agent-pack`: know-how skill, `agent_learn_propose`),
0046 (engine registry), 0052 (text calls on the API key), 0057 (it/en).

## Context

Brother (18/10): bring the brain to life with a scheduled agent that posts useful cards (ideas, tips, reminders,
connections, small facts about his own stats) on a board and around the app; off globally and per type; low tokens;
3 runs a day (morning, midday, evening) only while the app is open. Hard rules: it is an **agent** like every task
(editable model, engine, effort, instructions, versions, metrics); **nothing Claude-specific** (a user may have only
Codex, only Cursor or only an API key). Same day, via the coordinator: agents are per user except the shipped presets;
whatever needs his approval is **never a popup** but an async "Da approvare" section; the scheduler must also carry
the app's periodic maintenance jobs, each run as an agent; choices checked against current products.

What exists on main (2279008):
- `src/main/headline.ts`: hourly, visible window only, scrubbed digest ≤ 6000 chars, 5 candidates in one call, hard
  cap 1500 tokens, last 30 lines sent back, previous/built-in fallback, spend in `headline.json` shown in Costi. It
  calls only `TextModel` (`index.ts:119-131`, `engines/text.ts`), which serves **only the Anthropic API engine**:
  with Claude Code, Codex or Cursor alone it never calls a model. Model/effort are loose settings, not an agent.
- `compare/headless.ts` `HeadlessRunner`: a hidden, read-only, one-prompt run on **any** engine through
  `sessionFor` (claude, acp, codex, api), refused unless `engineOn` + `agentsMayOpen` (`refusal`, :198), only fakes
  under `SB_TEST`, answers every permission itself, returns text, `costUsd|null`, `tokens|null`. This is the
  engine-agnostic one-shot path; it lacks a per-run timeout, an output cap and an agent run record.
- Seeds pick the first enabled+trusted engine (`agents/catalog.ts:198-204`); `AgentRun` needs a `chatId`
  (`shared/agents.ts:135`); ideas are written only by the brain's `mem.mjs idea` (`wiring.ts:404`); §4.5 gap
  detection is designed, not shipped.

### Current practice (read 2026-10-18 unless marked)

- **ChatGPT Pulse**: one background run a day, 5-10 cards, save / follow up / thumbs, a "curate" control [1].
  Copied: few cards, feedback that steers, per-type choice.
- **GitHub Copilot Memory**: memories carry citations checked against the current code before use; expire after 28
  days [2]. Copied: every card cites digest refs, re-checked at render; TTL.
- **Cursor Memories**: generated memories wait for approval in Settings, generation can be switched off [3].
  Copied: learned rules wait in one approval queue, never inline.
- Inboxes (GitHub notifications, Linear Inbox) triage when you choose, no modal; scheduled agents (ChatGPT Tasks,
  Claude Code routines, Cursor background agents) run server-side on cron (all UNVERIFIED, from memory). Ours run
  locally, only while the app is open, as Brother decided.

## Decision

### 1. Battito is a preset agent

Seed `default-pulse` "Battito" (preset, shipped in code like the §3 presets; Brother's edits, know-how and metrics
stay in his `agents.json`, never shipped back). Role "tiene vivo il cervello: idee, consigli, promemoria,
collegamenti"; category `personal`; avatar `eye`; tools `{allow: []}` (it needs only the digest), ceiling `plan`;
own skill `battito` (card rules, types, learned rules; ADR 0069 §2 layout). Engine: the seed rule (first
enabled+trusted engine); model: that engine's registry row with `tier: 'mid'` (Sonnet-class; the template's
`models.json` tiers only Claude and Cursor rows, so the API engine uses Claude's rows via `priceEnginesOf` and Codex
gets `model: null`, its default); effort `low` where the
engine has `caps.effort`. Editable on its agent page like any agent (engine, model, effort, instructions → new
version; Orchestrator edits go on §4.4 trial; Brother's edits set `userLocked`). New flag `routable: false`:
`scoreAgents` never picks it for a task, and it cannot be archived (like `Generale`), only switched off. Not on
probation (preset).

### 2. One engine-agnostic one-shot path (`src/main/agents/oneshot.ts`)

`runOnce({agentId, system, prompt, maxOutputTokens, timeoutMs, purpose}) → {ok, text, engine, model, effort,
costUsd|null, costBasis: 'reported'|'estimated'|'unknown', tokens|null, durationMs} | {ok:false, reason, noEngine?}`.
- **Engine pick**: the agent version's engine if usable (`engineOn`, `agentsMayOpen`, key present when the engine
  needs one); else, with `jobs.fallback = auto`, the first usable of: API engines → Codex → Claude Code → Cursor →
  other ACP (order = how well the run is capped and metered, not a vendor preference); model on fallback = that
  engine's row with the same `tier`, else `null`; none usable → `noEngine` (§5 built-in cards, no model).
- **Transport**: an Anthropic-protocol API engine → `TextModel.complete` (hard `max_tokens`, exact list cost; its
  `MODEL` check stays for the MCP route only). Everything else → `HeadlessRunner.run` with: an empty folder
  `<userData>/oneshot` as cwd, `denyRead` = brain root + home, new `HeadlessRequest.timeoutMs` (120 s) and
  `maxTokens` (passed to `ApiSession` for OpenAI-protocol engines, `chats/api.ts:224`), new `noTools: true` (every
  permission refused, not just writes).
- **Record**: an `AgentRun` with new `source: 'oneshot'`, `chatId: 'os_<12 hex>'` (synthetic, never in
  `chats.json`), `tags.engine`, the engine actually used; ended at once, outcome set later (§6). Runs on a fallback
  engine are tagged and kept out of §4.4 baselines (like with like).
- **Cost gaps**: no reported cost but tokens → `estimated` from the registry price of that model; neither → chars/4
  for tokens and `unknown` cost, counted against the run cap only. Costi shows the basis ("stima", "non riportato").

| Engine | Transport | Structured output | Output cap | Cost | Tokens | Effort |
|---|---|---|---|---|---|---|
| Anthropic API | `TextModel` | JSON by prompt + strict parser (native schema: UNVERIFIED in-app) | hard `max_tokens` | reported (list × usage) | yes | yes |
| Other HTTP API (OpenAI protocol) | `HeadlessRunner` → `ApiSession` | JSON by prompt | hard once `maxTokens` is passed | reported when priced | `include_usage` | no |
| Claude Code | `HeadlessRunner` (plan mode, no MCP/hooks) | JSON by prompt (`--json-schema`: UNVERIFIED) | soft: no flag used (`CLAUDE_CODE_MAX_OUTPUT_TOKENS` env: UNVERIFIED) | reported | yes | yes |
| Codex | `HeadlessRunner` (read-only sandbox) | JSON by prompt (turn `outputSchema`: UNVERIFIED) | soft (no known cap: UNVERIFIED) | estimated from tokens | yes (app-server usage: UNVERIFIED) | yes |
| Cursor | `HeadlessRunner` (read-only config copy) | JSON by prompt | soft | unknown until Cursor fills `usage` | none today | no |
| Kimi / other ACP | `HeadlessRunner` | JSON by prompt | soft | unknown | none | no |
| none | — | built-in cards | — | 0 | — | — |

Soft cap = the digest's size cap, "at most N cards" in the prompt, an answer over 8000 chars discarded, the 120 s
timeout. CLI engines add their own system prompt and tool list to every run (UNVERIFIED size, likely thousands of
input tokens); PR 1 measures it per engine and shows it in Costi.

### 3. One job scheduler (`src/main/jobs/`)

`Job {id, agentId, schedule: {slots: 'HH:MM'[]} | {everyMin}, visibleOnly, budgetKey, run(ctx)}`. Battito is job 1
(`pulse`); the headline (§9) and maintenance jobs register the same way: the §4.4/§4.7 daily evaluator, the §4.5
suggestions, rollups and prune, brain lint. **Each job is owned by an agent** (preset "Manutentore" for maintenance),
so its cost, runs and on/off live on an agent page; a step with no model costs 0 and records no engine. A job's
output that would change anything (a file, an agent, a rule) is never applied: it becomes a "Da approvare" item (§7).
- Tick every 5 min. A slot is due when now ≥ slot time today and that slot has no record today. Runs only while the
  window is visible and not minimized (the headline's `visible()`), never in tray-idle, never under `SB_TEST` or
  `VITEST` (fakes only in tests, as `refusal` does), one job at a time, first tick 15 s after window ready.
- **Missed slots**: at open, only the latest missed slot of today runs, once; yesterday's never.
- Demo: no model; canned cards from `pulse-demo.ts`, frozen clock under `SB_DEMO_FREEZE`.

### 4. Card model and storage

```ts
type PulseType = 'idea' | 'consiglio' | 'promemoria' | 'collegamento' | 'curiosita' | 'agente';
type Place = 'board' | `agent:${string}` | 'search' | `file:${string}`;   // file: brain-relative path
interface PulseCard {
  id: string /* pc_<12 hex> */; type: PulseType; title: string /* ≤ 80 */; body: string /* ≤ 280 */;
  why: string /* ≤ 160, the evidence in words */; refs: { kind: 'now'|'idea'|'journal'|'ai-error'|'agent'|'chat'|'file'; ref: string }[] /* 1-3 */;
  places: Place[]; action?: { kind: 'chat'; agentHint?: string; prompt: string /* ≤ 500 */ };
  runId: string; engine: string | null; source: 'model' | 'builtin' | 'demo';
  createdAt: number; expiresAt: number; key: string /* dedupe hash */;
  state: 'new' | 'seen' | 'saved' | 'acted' | 'dismissed' | 'expired'; dismissReason?: 'irrilevante'|'gia-noto'|'sbagliato'|'troppo-spesso';
}
```
- Per run ≤ 4 cards; live on the board ≤ 6 (newest first, older rotate out); per place ≤ 2. TTL: promemoria 24 h,
  consiglio and curiosità 48 h, idea and collegamento 72 h, agente 7 d. A card whose ref no longer resolves (line
  gone, agent archived, file moved) expires at render (Copilot-style re-check).
- **Dedupe**: `key` = sha1 of normalized type+title; refused if in the last 200 keys or ≥ 0.6 token overlap with
  the last 50 titles; the last 30 titles and the last 10 dismissed (with reason) go back in the prompt.
- Validation in main: unknown type, a ref not present in the digest, a place outside the allowed set, a `file:`
  outside the brain → card dropped. Text rendered as plain text (no markdown links, no HTML).
- `<userData>/pulse.json` `{version:1, cards ≤ 200 (resolved pruned after 30 d), keys ≤ 200, runs ≤ 90 [{runId,
  slot, at, digestHash, engine, usd, basis, tokens, result}], day {date, runs, usd}}`, atomic `writeLocal`.

### 5. Inputs, budget, skip

Digest built in main (`pulse/digest.ts`, reusing `scrub`/`lastLines`), each line ≤ 160 chars, numbered refs
(`[n3]`, `[i2]`) the cards must cite: now.md lines (≤ 12); ideas.md titles with **Riprendere** due in ≤ 7 days or
overdue (≤ 8) + 5 newest; today's and yesterday's journal tail (≤ 10); ai-errors tail (≤ 8); one line per active
agent from analytics (runs 7 d · success · $/run · trend, ≤ 10); §4.5 gap hits when shipped (≤ 5, else omitted);
the last 15 chat titles + state (no message text); brain files changed in 7 days (names only, ≤ 20). Never whole
files, never chat bodies, never `.brain.env` or anything outside the brain. Total ≤ 6000 chars (~1.5 k tokens).
- **Skip when unchanged**: `digestHash` (without the clock) equal to the last run's → no model call, slot recorded
  `skipped-unchanged`.
- **Budget**: output ≤ 1200 tokens per run; a run starts only if today's spend + the median of the engine's last 5
  runs (default $0.02) ≤ `pulse.dailyUsd` (default $0.10) and runs today < number of slots (+1 for "Aggiorna ora").
  Engines with unknown cost: run cap only, flagged in Costi.
- **No engine**: built-in cards computed from the same data with no model (ideas due, today's cost vs the week,
  an agent with 3 runs and no outcome, a chat near its context limit), `source: 'builtin'`; the status says why
  ("Nessun motore disponibile: Battito usa le carte dell'app", link to Motori).

### 6. Actions and how Battito is judged

- **Salva nelle idee**: main runs the brain's `mem.mjs idea --area lavoro|personale --per owner --title <title>
  --file <tmp: Idea / Perché / Fonte: IA · Battito · <why>>`; no `mem.mjs` → button disabled with the reason. State
  `saved`; the feed's `idea` event comes from the brain watcher as today.
- **Fallo**: sends the card (title, body, refs) as a task to the Orchestrator chat with an `[Battito]` label; the
  Orchestrator applies §4.7 (scoreAgents → the agent, or on-the-fly), the UI focuses its column. The app never starts
  the run itself. Type `agente` → the §4.5 `agent_suggest` item in "Da approvare" (Create there), never a creation.
- **Non mi serve** (optional reason chip): state `dismissed`; ≥ 3 dismissals of the same type+reason in 14 days →
  `agent_learn_propose {agentId: 'default-pulse', rule, evidence: card ids}` (ADR 0069), which lands in "Da approvare".
- **Seen**: ≥ 1 s on screen → `seen`; an unseen expired card counts for nothing.
- **Run outcome** (§1.2 `RunOutcome`, basis `human`: Brother's clicks), set when all its cards are resolved or
  expired: any `saved`/`acted` → success; only dismissed → fail; mixed → partial; all unseen → unknown. So §4.4
  trials apply unchanged. Agent page metrics: useful rate = (saved + acted) / (saved + acted + dismissed), per type,
  cost per useful card, dismiss reasons. A type under 20 % useful over ≥ 10 resolved cards drops to ≤ 1 per run and
  files a learned-rule proposal.

### 7. One async surface: the Bacheca, with "Da approvare"

**One surface, two sections**, because the triage gesture is the same (look when he wants, act or dismiss) while
the stakes differ: **Per te** (pulse cards: optional, expire, one click acts) and **Da approvare** (anything that
would change a file, an agent or a rule: learned-rule proposals, agent suggestions/splits/merges, maintenance job
outputs; never expire, never auto-apply, Approva · Modifica · Scarta, the evidence one click away). No popup, no
Windows notification, no `question` feed kind, not in "Aspetta te": a quiet count on the Dashboard nav entry only.
ADR 0069's "Regole imparate" tab lists the same proposals filtered to one agent (one store, two views). This mirrors
Cursor's pending memories [3] and inbox triage, and keeps the existing popups only for chats blocked on Brother.

**Places**: Dashboard top (Bacheca band under the headline: Per te + Da approvare (n)); each agent page ("Dal
Battito", `agent:<id>`); the search empty state (≤ 2 `collegamento`/`curiosita`); the file viewer side panel for
`file:<path>` cards. The Grindhouse stays strips only (UI spec item 24).

### 8. Settings, IPC, PRs

**Settings** (dot keys, Settings → Battito): `pulse.on` (default on), `pulse.types.<type>`, `pulse.places.<place>`,
`pulse.slots` (1-3 × `HH:MM`, default 08:30 · 13:00 · 18:30), `pulse.dailyUsd` (0.01-2, default 0.10),
`jobs.fallback` (`auto` | `off`). Engine, model, effort only on the agent page (a link from Settings). Costi: Battito
under per-agent costs with the cost basis; API spend also lands in `ApiSpend` with purpose `pulse`.

**IPC** (`contract.ts` map + `INVOKE_CHANNELS`, `test/unit/contract.test.ts`, demo wiring): `pulse:list {place}` →
`{cards, status}`; `pulse:status` → `{on, engine|null, reason?, nextSlot, today {runs, usd, basis}, lastRun?}`;
`pulse:seen {ids}`; `pulse:save {id}` → `{ok} | {ok:false, error}`; `pulse:act {id}` → `{ok, chatId}`;
`pulse:dismiss {id, reason?}`; `pulse:runNow` (counts in budget; off in demo); `approvals:list {agentId?}`;
`approvals:decide {id, decision: 'approve'|'edit'|'discard', text?}`; events `pulse:changed`, `approvals:changed`.
The renderer never sends a path: `file:` places are brain-relative and resolved in main.

- **PR 1 · one-shot agent path + Battito + scheduler (main)**: `agents/oneshot.ts`, `HeadlessRequest.timeoutMs |
  maxTokens | noTools`, `AgentRun.source: 'oneshot'`, `routable`, seed `default-pulse`, `jobs/scheduler.ts`.
  Tests: agent engine used; fallback order when off / untrusted / not for agents / no key; `fallback=off` → noEngine;
  per-engine fakes (claude, codex, cursor `.mjs`, local API) return text and the right cost basis; timeout kills;
  noTools refuses a read; slots: missed slot runs once, hidden window / tray / `SB_TEST` never run.
- **PR 2 · pulse + approvals core + IPC**: digest, parser, validator, dedupe, store, budget, built-in cards, actions,
  outcomes, approvals store, settings keys, demo cards, Costi line. Tests: secret and email fixtures scrubbed, digest
  ≤ cap; unchanged digest → no call; budget stops a run; repeat and near-repeat refused; foreign ref dropped; Save
  calls `mem.mjs` with the right args on a fake brain; Act mails the Orchestrator; 3 dismissals → one proposal in
  approvals; outcome verdicts; contract test per channel.
- **PR 3 · UI**: Bacheca band and Da approvare, agent page panel and metrics, search empty state, file viewer panel,
  Settings rows, it/en. Fast e2e: demo shows canned cards; Non mi serve removes one; Salva shows the confirmation;
  a type off hides it; "nessun motore" shows built-in cards; an approval decided leaves the count.

### 9. The headline, later (PR 4, after PR 1)

Today it is API-only and outside the agent model. Proposal: its own preset agent **"Battuta"** (humor needs a strong
model, hourly; Battito wants a mid model 3 times a day: one agent has one model per version), registered as a job
(`everyMin: 60`, visibleOnly) on `runOnce`. `get()` still never waits; `headlineModel/Effort` migrate once into the
agent and are removed; its spend moves under the agent in Costi; on engines with unknown cost the cadence drops to
every 3 h by default.

## Consequences

Every engine can run Battito, honestly metered; the scheduler, one-shot path and approvals queue serve the headline
and maintenance jobs too. Price: a synthetic-chat run kind, three main modules, soft caps on CLI engines. **Risks**: CLI prompt overhead makes a run cost more than on the API (measured, shown, budget-gated); noise →
caps, per-type off, auto-throttle; prompt injection through agent-written chat titles → cards are data, refs
validated, no tools, actions only on Brother's click; Codex's read-only sandbox may read outside the empty cwd without
asking (UNVERIFIED that `denyRead` covers it) — nothing leaves the machine but the prompt, and the answer is only shown
locally; ideas.md format drift → only through `mem.mjs`.

## Open questions for Brother

1. Se il motore di Battito non è disponibile, ne usa un altro? **Consigliato: sì, in automatico tra quelli che hai
   acceso** (API → Codex → Claude Code → Cursor), mostrando il motore sulla carta; alternativa: solo il suo motore,
   altrimenti carte dell'app senza modello.
2. Budget giornaliero di partenza? **Consigliato: 0,10 $ al giorno** (circa 3 giri su un modello medio a sforzo
   basso via API; sui motori CLI può bastare per meno giri); alternativa: 0,25 $.
3. La frase della Dashboard (headline): **Consigliato: un suo agente "Battuta"** sullo stesso percorso, in una PR
   successiva (modello e ritmo diversi da Battito); alternativa: un lavoro dello stesso Battito.
4. Carte e approvazioni nello stesso posto? **Consigliato: sì, una Bacheca con due sezioni, "Per te" e "Da
   approvare"**, in cima alla Dashboard, senza popup; alternativa: "Da approvare" come pagina a sé nel menu.

## Sources (read 2026-10-18)

[1] https://yourstory.com/ai-story/openai-chatgpt-pulse-pro-daily-briefings (secondary; OpenAI's page not opened) ·
[2] https://docs.github.com/en/copilot/concepts/agents/copilot-memory · [3] https://docs.cursor.com/context/memories
(via search snippets; the current approval flow: UNVERIFIED)
