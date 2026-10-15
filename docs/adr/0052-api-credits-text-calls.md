# ADR 0052 · The Max plan's API credits: the judge and text-only calls through the app

Date: 2026-10-14 · Status: accepted · Builds on: ADR 0046 (generic engines, API keys in Settings), ADR 0032 (routing table)

## Context
Since 2026-10-07 the Claude Max plan includes monthly API credits (100 $ with Max 5x, 200 $ with Max 20x), redeemed
in the Anthropic Console; they do not carry over and do not pay for Claude Code. The user wants them spent on work
that needs no tools: the work judge (`ops/improve/routing-judge.mjs`, Opus 5.5, effort medium, 5 $/day) and the other
text-only calls of the brain, and optionally on writing chats. The key is already saved by the app (ADR 0046:
safeStorage, write-only from the UI, given only to its own engine's HTTP header) and must stay that way: no file, no
log, no visible argument, no child's environment.

## Decision
- **One text-only model in main** (`engines/text.ts`): `complete({purpose, model, effort, system, prompt, maxTokens})`
  calls the Messages API with the Anthropic API engine's key in `x-api-key` only (`redirect: 'error'`, errors redacted),
  only when that engine is on, trusted (fingerprint, ADR 0046) and has a key; otherwise it answers
  `{unavailable: true}` and sends nothing. Limits: prompt ≤ `TEXT_MAX_PROMPT`, answer ≤ `TEXT_MAX_TOKENS`.
- **The brain reaches it through a local MCP mount, not through the key** (`engines/text-mcp.ts`): `/mcp/text/<token>`
  with one tool, `text_complete`. The token is random per app run, lives only in memory and is compared in constant
  time; a wrong one answers 404 like a missing route. The URL goes in `SB_APP_TEXT`, only in the environment of the
  brain processes the app itself starts (`brain/index.ts`: `estimates.mjs` and what it starts, e.g. the detached
  judge). `ops/tools/app-text.mjs` is the brain's client (a child node process, so the scripts stay synchronous; it
  accepts only a `http://127.0.0.1/mcp/text/…` URL). Rejected:
  - the key in a file, an argument or the child's environment: readable by any process of the user, by `ps`, by a
    crash dump, and copied into every grandchild (an agent's shell included);
  - a long-lived token in a file: it would outlive the app run and reach scripts the app did not start.
  A script run by hand, or by an agent's shell, has no token and keeps its own road (headless Claude Code). The
  compare harness strips `SB_APP_TEXT` from the sessions it starts (`harness/compare/lib.mjs`), so an agent under test
  never gets it.
- **The judge on the API is text-only.** Claude Code's judge reads the transcript and the branch by itself; on the API
  the script packs them into the prompt: the chat's text with tool calls and results cut to 300 chars, no thinking,
  long text kept as head and tail (300k chars), and `git log --stat` of the work's branch against main (branch name
  checked by a regex, never `..`). Unavailable → the old Claude Code judge, no error; an API error is recorded as the
  verdict's error, with no second, paid try on the CLI. The verdict records `engine: 'anthropic'` and its usd; usd the
  app cannot price counts 0 against the 5 $/day cap.
- **The compare report's writer is ready** (`harness/compare/writer.mjs` tries the API first) but the app does not
  start the compare harness today, so it still runs on Claude Code. It starts using the credits the day the app starts it.
- **Writing chats may run on the credits** (`RoutingRow.onApi`, «sui crediti API» in Instradamento modelli): allowed
  only on a `writing` row with an Anthropic model (`checkTable`, mirrored in the brain's `ops/tools/routing.mjs`); off
  on every row, and only the user turns it on. A row with it on routes to the Anthropic API engine when that engine is
  on with a key and passes the same gates as any row of the table (ADR 0046: «Le Regie possono usare Anthropic API»,
  and «Chat tra motori diversi» for a chat a Regia opens), else to Claude as before; the row's help says so. Agents cannot turn it on: `agentLimits` refuses it on a save, and since the brain's
  table files can be written by hand, the app keeps the rows the user saved «sui crediti API» in
  `<userData>/routing-api.json` and honours `onApi` only on those rows.
- **The spend is computed by the app** (`engines/spend.ts`, `<userData>/api-spend.json`: usd, calls and unpriced calls
  per month and engine, 12 months, no prompts or keys) at the brain's list prices, because the Anthropic API exposes
  spend only to an Admin key, which the app never asks for. Settings → Motori shows this month's line under each API
  engine, and under Anthropic API where the Max credits come from. Read-only channel `engines:spend`.
- **A call that gets no answer is counted.** Node's fetch gives up on headers after 300 s, before the 15 min timeout:
  the judge counts a timeout or a dropped line as the CLI's timeout (2 $ against its cap) and stops the run.
- **No extra cap in the app.** The judge keeps its own daily cap; the credits themselves stop at the plan's amount.

## Consequences
- The key still never leaves main; what a brain script holds is a per-run token valid only on 127.0.0.1.
- When the user turns the engine off, removes the key or quits the app, every caller falls back to Claude Code with no
  error.
- The app's spend can differ from the Console's (prices change, unpriced models count 0); the page says "calcolata
  dall'app ai prezzi di listino".
