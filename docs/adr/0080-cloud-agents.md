# ADR 0080 · Cloud agents in the Grindhouse (Cursor, Codex, Claude Code)

Date: 2026-10-19 · Status: accepted with the defaults below (the owner may change any of them) · Issue: #79 ·
Builds on: ADR 0046 (engines, API keys), ADR 0055 (CLI contracts), ADR 0068/0071 (every worker in the Grindhouse) ·
Amends: AGENTS.md rules 2 and 4 (wording), ADR 0046 §2 (the key list)

## Context
Long tasks should keep running when the PC sleeps or is busy, and cost no local CPU/RAM (ADR 0036 load gate). Three
vendors run agents in their own cloud: Cursor (Cloud Agents, a public REST API v1), OpenAI Codex (cloud tasks, through
the Codex CLI) and Claude Code (cloud sessions, through the Claude Code CLI). What each documents (checked 2026-10-19,
sources in issue #79): Cursor offers start, list, a live SSE stream of the current run, follow-up, stop and usage;
Codex's CLI starts (`codex cloud exec --env`), lists (`codex cloud list --json`) and applies a diff (`codex apply`),
follow-up and stop only on its web page; Claude's CLI starts (`claude --cloud`) and queues a follow-up
(`claude -p … --cloud <id> --output-format json`), with no list, no transcript and no stop outside claude.ai.

## Decision
1. **Contract** (`src/shared/cloud.ts`, re-exported by `contract.ts`): `CloudAgent` (id, engine, title, status
   queued | running | waiting | done | failed | stopped | unknown, url, repo, branch, updatedAt, summary, costUsd,
   runId, by, messages), `CloudCaps` per engine as `EngineCaps.cloud` (`start, list, stream, followUp, stop, apply`:
   Cursor all; Codex no stream / follow-up / stop; Claude start + follow-up + apply-by-branch), IPC `cloud:list`,
   `cloud:start`, `cloud:followUp`, `cloud:stop`, `cloud:apply`, `cloud:watch`, `cloud:readiness`, `cloud:dismiss`,
   event `cloud:changed`. A capability that is false is "Apri": the vendor's page in an internal browser tab (only a
   URL on the vendor's own host is kept).
2. **Main: `src/main/cloud/`**, one provider per vendor behind one interface (`provider.ts`): `cursor.ts` (REST v1,
   tolerant parsers, SSE with `Last-Event-ID`), `codex.ts` and `claude.ts` (the CLIs, resolved like the chats', a Windows
   npm shim run through its .js so a prompt never crosses cmd.exe), `repo.ts` (GitHub remote, pushed branch, worktrees),
   `store.ts` (`<userData>/cloud-agents.json`: agents, Codex environment per repo, dismissed ids, last spend per Cursor
   agent and today's Cursor cloud spend; no prompt, key or transcript), `service.ts` (readiness, budget, polling,
   watch), `demo.ts` (the demo's fake agents: real service, fake providers and git). Unknown statuses and shapes are CLI
   drift (`npm run logs -- --scope drift`). Every failure is an Error the user reads, logged with cause + hint.
3. **Grindhouse**: cloud agents are strips under the local ones (`CloudStrips.tsx`), grouped by area (= the repo's
   name, heading "<area> · cloud"), with a "cloud" badge and the engine, the status, the last summary or streamed
   message, a follow-up box where `followUp`, Stop where `stop`, Apri always, "Porta in locale" (Codex: `codex apply`;
   Cursor/Claude: `git fetch` of the agent's branch) **always into a new worktree** `<repo>-wt/cloud-<branch>`, never
   into the checkout (a dirty tree stays as it is). One strip open at a time; it streams (Cursor) while open.
4. **Start**: "Nuovo agente" (Ctrl+N) gets "Dove: Locale / Cloud"; each engine is offered only when `cloud:readiness`
   passes for the folder: engine on, Cursor key saved / `codex login status` with ChatGPT / `claude auth status` with
   claude.ai, a GitHub `origin`, a branch already on the remote. The Orchestrator gets `app_create_chat` with
   `where: 'cloud'` (harness cursor | codex | claude, default cursor; same open policy as chats; the prompt labelled as
   an agent's) and sees cloud agents in `app_chats` (`cloud`).
5. **Cost**: Cursor's `GET /v1/agents/{id}/usage` is real API spend: its increase is added once to `engines/spend.ts`
   (id `cursor-cloud`) and to today's Cursor cloud spend. Codex and Claude draw from the plan: the strip says "dal piano".
6. **Tests**: providers on recorded fixtures (`test/fixtures/cloud`), the service on fake providers, appctl, one e2e spec
   on the demo with screenshots (`test/e2e/cloud-agents.spec.ts`). The app's tests never reach a vendor: under SB_TEST /
   VITEST the HTTP client refuses and only a .mjs fake CLI may start.

## Defaults for the open questions (owner, change at will)
1. **Pushing**: a cloud agent pushes only its own vendor branch (`cursor/…`, `codex/…`, `claude/…`), never main; the
   app itself never pushes (AGENTS.md rule 8): a branch that is not on the remote yet is refused ("fai tu il push").
   Cursor starts with `autoCreatePr: false`.
2. **Repos**: v1 is for GitHub repos only. Azure DevOps (and any other host) is refused with a clear message: sending
   work code to a vendor's cloud is the owner's policy call.
3. **Cursor cost**: counts in the app's existing budget (Settings, Cursor daily limit, `budget.cursor.dailyUsd`): a
   Cursor cloud start is refused when the local Cursor spend of today plus today's cloud spend reached it (budget on and
   Cursor's mode not off). Codex and Claude are never blocked by it (plan, not API).
4. **Claude**: start + follow-up + link only; never scrape claude.ai nor call undocumented endpoints.
5. **Codex follow-up / stop**: open the web page (`codex app-server` cloud methods are not documented).
6. **Keys**: the Cursor Cloud Agents key joins ADR 0046's list: typed in Settings → Motori → Cursor ("Chiave Cursor
   Cloud Agents"), encrypted with safeStorage under id `cursor-cloud`, bound to `https://api.cursor.com/v1`
   (`engines/service.ts CLOUD_KEYS`), write-only from the UI, sent only as the Authorization header of `cloud/cursor.ts`
   requests to api.cursor.com, redacted from logs. Rule 4 extends: the app starts `claude --cloud` / `codex cloud` only
   for that engine's own cloud agents, with the user's own login; the Cursor chats keep the `agent` CLI's login.
7. **Polling**: only while the window is visible (not minimized or hidden), at most every 30 s while an agent runs,
   doubling up to 10 min when none does; a manual refresh never more often than every 30 s. Cursor is polled only with
   a key, Codex only once the app knows one of its tasks; Claude is never polled (nothing to poll). The SSE stream runs
   only for the strip the user opened.

## Consequences
- Long tasks can leave the PC; the Grindhouse still shows every worker (ADR 0071), local or cloud.
- Out of scope for v1: routines / schedules, auto-fix PRs, Slack / GitHub triggers, self-hosted environments, webhooks.
- Cursor's v1 field names were taken from the docs as summarized in issue #79 (no live call was made while building):
  the parsers are tolerant and report drift; the first real run should be checked with
  `npm run logs -- --scope drift` and the fixtures updated if a name differs.
- Claude cloud strips show "stato su claude.ai" until Anthropic documents a list/read API.
