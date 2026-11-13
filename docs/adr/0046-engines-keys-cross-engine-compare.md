# ADR 0046 · Generic engines: one registry, API keys in Settings, one cross-engine switch, model A vs model B

Date: 2026-10-14 · Status: partly superseded by ADR 0065 (the cross-engine transport switch); accepted (design; built in four steps) · Amends: ADR 0032
(hard rules, harness names), ADR 0021 (the Regia's engine and the Claude ↔ Cursor rule)

## Context
The owner, 14/10: "Confronto Cursor contro Claude ... Questo dobbiamo generalizzarlo come confronto tra modelli
qualunque modello vs qualunque modello. Considera che questa è un app generica e voglio che sia facilmente utilizzabile
da tutte le cli tipo tra poco proverò la cli di kimi. E voglio anche un punto chiaro nelle configurazioni per impostare
api key normali, e anche le config, claude può aprire cursor ecc ecc è troppo specifica, voglio solo configurare se si
possono aprire chat cross cli/api". And: "codice pulito e mantenibile niente refusi e sicuro".

Today the app knows two engines by name. `Harness = 'claude' | 'cursor'` (`contract.ts`) is branched on in about 40
files; `ChatManager.startSession` picks `ClaudeSession` or `CursorSession` with a ternary; `cli.ts` has
`resolveClaude` / `resolveCursor`; Settings has `engines.claude`, `engines.cursor` ("La Regia può usare …"),
`messaging.crossHarness` ("Messaggi tra Claude e Cursor") and `regiaChats.claudeModel / cursorModel / cursorReasoning
/ cursorFast`. The routing has "app chats never on Cursor" hard-coded (`routing.ts`, `routing.mjs`). The brain's
`harness/models.json` lists `harnesses: {claude, cursor, api}`; `api` can never start. The comparison
(the brain's `harness/compare/`) is Cursor's subagent vs Claude's, with `cursor.*` / `claude.*` files and sides, a judge
only through `cursor-agent`; `ops/improve/routing-judge.mjs` judges routing outcomes with its own copy of the
read-only Claude runner.

ACP (Agent Client Protocol) is now spoken by many CLIs: Cursor (`agent acp`), Kimi CLI (`kimi acp`), Gemini CLI
(`gemini --experimental-acp`), GitHub Copilot CLI; Claude Code and Codex only through third-party adapters. Claude Code
keeps its own stream-json protocol, which the app already speaks in full.

## Decision

### 1. One engine registry
- An **engine** is `{ id, label, kind, … }`; `kind` picks the one adapter that runs it:
  - `claude`: Claude Code stream-json (today's `ClaudeSession`, unchanged).
  - `acp`: any ACP CLI (today's `CursorSession`, renamed `AcpSession`; what is Cursor-only, the hooks file,
    `CURSOR_CONFIG_DIR` snapshot, price fallback, becomes options of the Cursor entry, not branches in the adapter).
  - `api`: an HTTP endpoint, `protocol: 'openai' | 'anthropic'` (OpenAI-compatible chat completions, which covers
    private and Chinese endpoints, or the Anthropic Messages API). A small new adapter with Node's `fetch`, no new
    package. First version (the owner, 14/10: "Sì, solo testo per ora"): text chat with streaming and cost from usage; no tools (an API chat cannot touch files or
    browsers until a later ADR gives it MCP tools).
- **Where an engine is defined:** the app's own entries (`engines/registry.ts`), plus `harness/models.json` in the
  brain, key `engines` (beside `harnesses`, which stays: the brain's scripts read it), with how to start it:
  ```json
  "engines": {
    "qwen":     { "kind": "acp", "label": "Qwen", "command": "qwen", "args": ["--acp"], "keyEnv": "DASHSCOPE_API_KEY" },
    "deepseek": { "kind": "api", "label": "DeepSeek", "protocol": "openai", "baseUrl": "https://api.deepseek.com/v1" }
  }
  ```
  Claude and Cursor are built in: their start is app code and the brain cannot redefine them. Kimi (`kimi acp`, login
  `kimi login`; it reads no key from the environment) is an app preset, off (Gemini CLI was one until 2026-10-15, see
  the end); a brain entry with a preset's id may change it (e.g. the command's full path). An entry is
  validated (`brainEngine`: command a name or an absolute path without shell characters, args from a safe set, `keyEnv`
  only `*_KEY`/`*_TOKEN`, `baseUrl` https or http on this machine, without credentials or query); an invalid one is
  left out and logged once. Settings → "Motori" lists every engine with how it starts ("Avvio: kimi acp", the URL) and
  where it comes from; adding one is writing its entry (no form yet). Models and prices stay `models[]` rows with
  `harness: <engine id>`.
- **Enabled only by the owner.** An engine starts only if it is on in the app's Settings (`engineOn.<id>`, a
  protected key: agents cannot change it, ADR 0009). Turning it on records a fingerprint of its start definition
  (`kind`, `command`, `args`, `modelFlag`, `keyEnv`, `baseUrl`, `protocol`) in `<userData>/engine-trust.json`
  (`engines/trust.ts`): when «X acceso» becomes true by the user's hand, or by "Riaccendi" (`engines:trust`). If the
  brain's entry changes later (an agent edits `models.json`), the engine counts as off (`policy.ts engineOn`) until the
  owner turns it on again, and Settings says why. Until then the app does not even run its `--version` or its login
  (`cli.ts`). So no agent can make the app run a new program or send a key to another host.
- **In the code:** `Harness` becomes the engine id (a string checked against the registry); the data keeps the field
  name `harness` (chats.json, outcomes, routing rows: years of history stay readable). `src/main/engines/` holds the
  registry (load, merge presets, validate, fingerprint) and `sessionFor(engine, opts, sink)`, the one factory the
  manager calls; `chats/cli.ts` keeps one `resolveAcp(engine)` (override env `SB_<ID>_PATH`, a dash as `_`: the
  fakes' way in for tests) and `cli.ts` one status/login for every engine. Per-engine maps (`budget`, `regiaChats`, skills' home dir,
  the renderer's label/icon maps) become records keyed by engine id, filled from the registry; what is truly
  per-kind (Claude's effort, permission mode, worktree, warm start) is asked of the engine's capabilities
  (`caps: { effort, permissionMode, worktree, fork, warm, tools, … }`), never `harness === 'claude'`. The settings
  switches `engineOn.<id>` / `engines.<id>` exist for any engine id (`settings-schema.ts`), so a switch saved for an
  engine the brain defines survives a start where the brain is read after the settings. Not yet per engine: the Regia's
  model and effort defaults (`regiaChats`: its engine is any engine with tools, its models still Claude's and
  Cursor's).

### 2. API keys in Settings (changes AGENTS.md rule 2)
The owner, 14/10, accepted the change ("Sì, cross-OS così") after asking for no Windows-only solution ("in futuro
quest app voglio farla cross OS").
- Settings → "Motori" → an engine's "Chiave API" field. The renderer sends the key once (`secrets:set`), then only
  sees it masked (`sk-…a1b2`, last 4) and can replace or delete it; no IPC returns it, ever.
- Main encrypts it with Electron `safeStorage`, the same code on every OS (DPAPI on Windows, Keychain on macOS, the
  system keyring on Linux) into
  `<userData>/secrets.json` (`{ version: 1, keys: { <engineId>: { cipher, mask, bound } } }`, mode 0600, `engines/secrets.ts`); never in clear on disk, never in the brain, never in
  settings.json, never in the stable↔dev copy. If `safeStorage` is not available, or on Linux its backend is
  `basic_text` (no keyring: a fixed password), the field is disabled and says why: never a weak copy.
- A key is decrypted only when used (`engines/sessions.ts`): for a CLI engine at start into its process env under the
  entry's `keyEnv` (only that engine's own key, never others'); for an API engine before each request into its header
  inside main (`chats/api.ts`), never in a child process. Only an engine with a `keyEnv` or an API engine takes a key.
  The key is bound to the fingerprint above: a changed `baseUrl` or `keyEnv` stops its use, and Settings says so.
- Never in logs (`log.ts addRedaction`: every key saved or read is replaced, raw and JSON-escaped, besides the
  `sk-…`/`Bearer …` shapes), never in chat
  items or transcripts the app writes, never in an MCP tool's answer, never in `send_to_chat` / mail.
- Known limit (said in Settings): a CLI engine's own agent can read its process env with a shell tool, as it can read
  the CLI's own login files today. An API engine has no such way.
- AGENTS.md rule 2 becomes: "credentials never handled by the app, except the API keys the user types in Settings →
  Motori: encrypted with safeStorage, write-only from the UI, given only to their own engine's process env or HTTP
  header (ADR 0046)". ADR 0080 adds one key that is not an engine's: the Cursor Cloud Agents key (id `cursor-cloud`,
  bound to `https://api.cursor.com/v1`, sent only as the Authorization header of the cloud agents' requests).

### 3. One cross-engine switch
- Settings → "Motori", three protected switches read by one module, `src/main/engines/policy.ts`:
  - **"X acceso"** (`engineOn.<id>`, new): off = nothing starts on that engine, the owner's own chats included; the
    chat manager refuses every start (new chat, resume, warm engine) on it. Switching it off also saves "Le Regie
    possono usare X" off (the settings store, `config.ts`), the key an older release reads; on again leaves that closed.
  - **"Le Regie possono usare X"** (`engines.<id>`, the key and meaning of before): off = no agent opens or resumes a
    chat there, whatever the agent's own engine; the owner's "Nuova chat" stays free. A Regia counts as an agent (no
    "Cambia motore" to it), and so do the routing table's rows and the defaults behind "Apri chat": only the engine
    the owner names for a work chat needs just "X acceso". An agent's message (`app_send_to_chat`, mail) never wakes
    a stopped chat there: mail waits unread until the owner resumes the chat, and the sender is told.
  - **"Chat tra motori diversi"** (`messaging.crossHarness`, the old "Messaggi tra Claude e Cursor"): off = an agent
    opens, resumes and writes (`app_send_to_chat`, mail) only to chats on its own engine. It covers writing too (the
    owner, 14/10: "Aprire e scrivere"): a message wakes the other engine and spends its tokens.
- The two old keys keep their saved names and meaning on purpose: an older release (rollback, or the launcher falling
  back to the previous one) reads them as before, so it never opens what the owner closed; no migration. Absent = off,
  so an engine the saved file does not name never starts by itself (built-in engines default on).
- `brain-settings.json` keeps `crossHarnessMessages` (= `messaging.crossHarness`) for `inbox.mjs`. The file lives where
  agents write, so at start it may only close the switch; a file that would open it is put back (review, 14/10).
- `policy.ts` (`engineOn`, `agentsMayOpen`, `crossRefusal`, `openRefusal`) is used by `app_create_chat` and its
  routing `canRun`, `app_send_to_chat`, hand-off (an engine the Regie may not use gets the app's token-free note),
  "Riprendi", the chats' mail and the routed chats; `cursorRule()` and the ad-hoc checks go.
- `regiaChats.*` becomes `regiaChats.engine` + `regiaChats.models: { <engineId>: { model, effort } }` when a third
  engine arrives (piece 3); until then its per-engine fields stay.
- The routing's "app chats never on Cursor" goes: the App row (`* · App` → Opus 5.5 medium, `appChats` in
  `models.json`) already pins them, and the hard rule becomes "a row for the app's chats names only `appChats`'s
  engine, model and effort; exploration of app chats stays on that engine". "A Claude model runs only on claude"
  becomes "a model runs only on its own engine" (`models[].harness`). `routing.mjs` and `routing.ts` change together.

### 4. Model A vs model B, one evaluation system
- An experiment names two **sides** `a` and `b`, each `{ engine, model, effort? }`, plus how a task is sampled
  (today: the Cursor subagents' hook capture; next: any app chat of a kind, re-run on side b). Files per round become
  `a.md / a.json / b.md / b.json` (was `cursor.* / claude.*`); `key.json`, totals and reports say `a` / `b` and the
  engines' labels from the registry. Old rounds are read through a one-time rename.
- **Side b runs inside the app**, as a hidden read-only session on its engine (same adapters, same keys; brain
  scripts never get a key; `src/main/compare/`): only the stable app polls the brain's `harness/compare/app-queue.mjs`
  (`list` / `start` / `record` / `fail`, every 60 s, at most 2 runs, 45 min each, under the brain's 60 min claim);
  `run-claude.mjs` goes. A run starts only on an engine that is on, trusted and that the Regie may use, never on Fable
  or effort `max` (the experiment is a file agents write); otherwise it waits and nothing is written back. Read-only
  per engine: Claude in plan mode with only Read/Grep/Glob, hooks off, no MCP, no saved session; an ACP CLI in its ask
  or plan mode (none → the run stops before the prompt), Cursor with its own per-run config copy without allow rules;
  an HTTP model has no tools. The app answers every permission: reads and searches only, never inside the brain's
  `reviews/compare` or the folders `list` names in `denyRead` (side a's answer), never a network path. What an ACP CLI
  approves by itself from the user's own config never reaches the app: that is the limit of this guarantee.
- **One judge**: `ops/improve/judge.mjs` (from `routing-judge.mjs`) with two modes, `success` (one work: did it
  succeed?) and `pair` (two anonymous answers, per-finding verdicts, today's `judge.mjs`); one read-only runner (the
  deny lists and JSON parsing copied today between `run-claude.mjs` and `routing-judge.mjs` go into one place:
  `ops/improve/claude-readonly.mjs`). The judge's engine and model are the experiment's `judge`, refused when it is
  one of the two sides (same engine and model, or a side's model unknown) or Fable; today Claude or Cursor (run by the
  brain, as before) or `manual`, other engines later (through the app, like side b).
- **One ledger**: every judged pair also writes one outcome per side to `ops/state/improve/outcomes.jsonl` (source
  `compare`, arm `harness|model|effort`, id `compare:<round>:<side>`; a side succeeds when at least half its findings
  were judged correct, weight 2 like the judge), so the routing loop (ADR 0032, Thompson sampling) learns from comparisons
  as from real work, through the same priority (explicit > judge > proxy). The app's "Confronto tra modelli" group
  (`compare.ts`, contract `CompareExperiment`) shows `a` / `b` with engine and model instead of source / contender.

### What changes in the brain
`harness/models.json` (`harnesses` → `engines` with start definitions; the Kimi entry off), `harness/models.md`
(one rule: "chats on another engine only if the cross-engine switch allows it"; Cursor-specific lines go, the App row
stays), `ops/tools/routing.mjs` (same rules as `routing.ts`), `ops/improve/routing-judge.mjs` → `judge.mjs`,
`harness/compare/*` (sides a/b, no `run-claude.mjs`); `brain-settings.json` keeps `crossHarnessMessages`.

## Consequences
- Adding an ACP CLI = one `engines` entry + the owner's "on" in Settings (+ its key if it needs one). An HTTP model =
  one entry with `baseUrl`. A CLI with its own protocol = one adapter implementing `HarnessSession`.
- Rule 4 holds: each engine spends only its own login or key; tests use fakes (`fake-claude.mjs`, `fake-cursor-acp.mjs`
  run as any ACP engine, a fake HTTP server for `api`), never another vendor's CLI.
- Order of work, one commit each, `check:branch` green, nothing visible changes in the first: (1) registry with Claude
  and Cursor inside; (2) the single switch; (3) keys, only after the owner's yes; (4) the comparison.
- Cost: about 40 files touched by (1), mostly mechanical (string id instead of the union, records instead of
  `claude`/`cursor` fields); settings migration for (2) keeps the owner's current values.

## Amendment 2026-10-15: Gemini CLI removed
The owner, 15/10: Gemini no longer supports the Gemini CLI, so the app drops its preset. `REMOVED_ENGINES`
(`engines/registry.ts`) names it: a `gemini` entry in the brain's `harness/models.json` is left out and logged once like an
invalid one (it never starts, whatever it says), and `config.json` saved by an older release loads without
`engineOn.gemini` / `engines.gemini`, with the Regia's engine back on Claude when it was Gemini (`brain/config.ts
fromSaved`). A routing row on `gemini` already falls back to the user's defaults (no such engine); a chat saved on it
stays readable and cannot start. Gemini models run through Cursor stay (they are Cursor's).
