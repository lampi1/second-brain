# ADR 0256 · Live model lists: every engine lists its own models; models.json only overrides

Date: 2026-11-10 · Status: accepted (owner, 2026-11-10: «make model lists dynamic … so a new model appears without an
app update or a manual edit») · Builds on: ADR 0046 (engines, API keys), ADR 0211 (the card's back offers only listed
models) · Changes: the allow-list check of ADR 0032's `resolve()` · Amended by: ADR 0267 (models.json rows are
added to a live list, not only a fallback; the installed Claude Code runs by default)

## Context
The Claude model list came only from the brain's `harness/models.json` (through `withApiModels`), and `resolve()`
refused a Claude model that file did not name. Codex and ACP engines listed their models only when one of their chats
opened. Fable 5.2 (`claude-fable-5-2`) came out on 2026-11-09 and did not show up anywhere until someone edited the
file. The demo registry (`brain/routing-demo.ts`) and the template repeated model ids in code.

## Decision
- **One live source per engine kind** (`engines/model-lists.ts`), none of which spends a token:
  Claude Code's own `initialize` reply (`models`: each alias under the id it resolves to, with its effort levels; a
  chat's initialize reports it too, `chats/claude.ts`), Codex's `model/list`, an HTTP engine's `GET <baseUrl>/models`
  with its own key (Anthropic Models API, OpenAI compatible). Claude Code and Codex are started only to ask
  (`engines/model-probe.ts`): no prompt, no MCP server, no claude.ai connector, no hook, no saved session or thread;
  closed when the app quits. Rule 4 now names this token-free listing. ACP CLIs (Cursor, OpenCode, catalog engines)
  are never started only to ask: rule 4 keeps `agent` to Cursor chats, and an ACP `session/new` would leave an empty
  session in the user's own history; their list is the one their last chat's `session/new` gave (cached), else
  models.json.
- **Refresh** (Claude, Codex, HTTP engines): soon after the start, every 6 h, and on demand («Aggiorna elenco» in the model picker,
  `models:refresh`). Only engines turned on are asked; a refresh already running is joined.
- **Cache and fallback**: the list goes to the ModelsSeenStore (userData `cursor-models.json`). A failed source is
  logged (`model list not refreshed`, with what the picker shows instead) and the last list stays; an engine that never
  listed any reads its rows in `harness/models.json` (source «dal registro»).
- **Claude also gets the Models API's new models**: when the user's Anthropic API engine has a key and is on, its list's
  `claude-*` ids the bundled Claude Code does not name are added to the Claude list, so a model out today shows up
  before an app update. The key still goes only to its own engine's request (rule 2); only the ids are shared.
- **`models.json` only overrides** prices, tier, label (new optional `label`), aliases, efforts and context window. It
  is never an allow-list: `resolve()` takes any model id (the CLI refuses an id it cannot run). A model with no row has
  its price unknown: the picker says «prezzo sconosciuto» and still offers it.
- **No model ids in code where avoidable**: the demo reads the release template's `models.json`; the unit tests' fixed
  registry moved to `test/fixtures/model-registry.ts`; the template drops its unused `appChats` block. The template's
  rows stay as the price overrides (no provider source gives Claude prices). `live-cost.ts` keeps one fallback price row
  for a machine with neither a brain nor a template.

## Consequences
- A new model returned by any engine's source appears in every picker and routing accepts it, with no file edit.
- The live cost of a model with no price row is still estimated at the table's `defaultModel` price (as `prices.mjs`
  does, flagged unpriced in the brain's cost report); the picker shows that its price is unknown.
- Cursor and OpenCode refresh only when one of their chats opens; «Aggiorna elenco» does not ask them (no failure shown).
- Not verified on real CLIs from this container: the Codex answer is the shape its chats already parse; the Claude
  Code shape was read from the bundled CLI (2026-11-10).
