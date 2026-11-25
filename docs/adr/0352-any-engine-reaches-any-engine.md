# ADR 0352 · Any engine reaches any engine; a changed role card never stops the work

Date: 2026-11-25 · Status: accepted (owner, project thread «Dare piena libertà sui motori», 2026-11-25: «Orchestrator e
Strategist aprono, riaprono, riassegnano e scrivono a una chat su qualunque motore acceso, qualunque sia il loro. Poi si
tolgono le altre regole rimaste da scelte superate»; «Se la scheda del ruolo cambia, il lavoro continua … Mai un errore
da risolvere a mano») · Supersedes: the «another engine» parts of ADR 0014, ADR 0046 and ADR 0309, the role-revision
rule of ADR 0186 for reused chats, the «fresh chat» line of ADR 0337 · Builds on: ADR 0065 (messages across engines
always on), ADR 0275 (the Orchestrator's words count as the user's), ADR 0347 (no versions, every permission granted),
ADR 0348 (a chat out of credits moves by itself)

## Context

Until now an Orchestrator or a Strategist could write to, assign or reuse a chat on another engine than its own only
while that chat was running: a stopped one, or one the auto-close had archived, gave «A stopped engine of another kind
requires the user» (review of 2026-10-11: «an agent never starts a stopped engine of another kind, it would spend that
engine's credits»). That rule came from the time each engine had its own switch for messages across engines (ADR
0046); ADR 0065 made those messages always available, ADR 0275 made the Orchestrator's words the user's, and the
owner wants no manual step. The leftovers (`crossRefusal` always null, the refusals, a review chat on another engine
never reused) only stopped work.

A second refusal stopped work for nothing: a chat started on an older version or revision of its role's card
(«Role configuration changed: create a fresh chat»), a level whose first model is now on another engine («delegate a
fresh chat»), and a parent in a narrower mode («Child permissions exceed your current policy or mode»). ADR 0347
removed versions and permissions from the cards; changing the order of a level's models turned every running child
into one that could not take its next task.

## Decision

1. **The only engine rule is `openRefusal`** (`src/main/engines/policy.ts`): the target engine is on, trusted,
   available and allowed to the Orchestrators. The asking chat's engine plays no part anywhere: `app_assign_task`,
   `app_send_to_chat`, `app_reopen_chat`, `app_handoff_chat`, `app_continue_chat`, `agent_assign_task`, the mail
   tools and the one-review lookup. `crossRefusal` is deleted with its callers, `engineRefusal(to)` takes one engine.
2. **A chat that closed by itself resumes with its history and its engine**, on a message or an assignment, like an
   active or stopped one. `app_reopen_chat` answers `reopened: true` (an open chat whose engine is not running shows
   `state: "stopped"`), or refuses with the reason: its engine off or not for the Orchestrators, its worktree gone.
3. **A chat the user closed with ✕** takes no agent's message or assignment; `app_reopen_chat` reopens it only from
   the authenticated Orchestrator within 10 minutes of the user's own message (phone included, ADR 0275).
4. **A changed card never stops the work.** On every new assignment `ChatManager.assignTask` calls `adoptCard`: the
   chat takes its role card's tools and permissions as they are now, below its parent's (and the contract's tool
   classes) for a delegated chat, below the Orchestrator's for one from the unauthenticated mount (persisted flag
   `agentBound`), never wider than a fork's source. Engine, model, folder and instructions stay the chat's. The
   engine relaunches on the same history only when tools or permissions changed. A card that cannot be read leaves the
   chat as it was.
5. **The chat stays on its engine while that engine can run.** A level that now starts on another engine is a
   preference for new chats: a reused child keeps its engine and model (the answer says so in `warnings`).
6. **When the chat's engine cannot run**, the app moves the work by itself: `continueChat` opens a new chat of the
   same role on the card's (for a child: the level's) engine and model, from the app's own hand-off note, under the
   same parent and in the same folder, carrying the new task (`assignment`: goal and criteria, no result), linked both
   ways. The tool answers with the new `chatId` and `continuedFrom`. Refused, with both reasons, only when the card's
   engine cannot run either.
7. **What stays**: the three waits for the user's click (database writes, production releases, Azure writes); the
   parent's permissions as a ceiling; the owner's engine switches; untrusted engines never started; chats the user
   closed; the «never relax» rules of `docs/agents/rules.md` §2; no message between agents counts as consent.

## Removed now, because a later decision already superseded them

| Where (before this change) | What it stopped | From | Superseded by |
|---|---|---|---|
| `src/main/appctl/tools.ts` app_assign_task, `crossRefusal` + «A stopped engine of another kind requires the user» | assigning a stopped or auto-closed chat on another engine | review 2026-10-11, ADR 0046 | ADR 0065, 0275, this ADR |
| `src/main/appctl/tools.ts` app_send_to_chat, «la chat X non è attiva: un agente non la avvia» | writing to such a chat | the same | the same |
| `src/main/appctl/tools.ts` `crossRule` (app_handoff_chat, app_continue_chat) | asking a stopped chat on another engine for its note | the same | the same |
| `src/main/agents/delegation.ts` agent_assign_task, the same refusal | a Strategist reusing such a child | the same | the same |
| `src/main/engines/policy.ts` `crossRefusal` (always null), `src/main/chats/mail.ts` its `refusal` and the «blocked» log | nothing (dead) | ADR 0046 | ADR 0065 |
| `src/main/agents/one-review.ts` `reusable`: engine, version and revision tests | reusing a review chat on another engine or an older card | ADR 0309 point 5 | this ADR, ADR 0347 |
| «Role configuration changed: create / delegate a fresh chat» (tools.ts, delegation.ts) | any reuse after a card edit | ADR 0186 (revision) | ADR 0347 («non mi interessano le versioni») |
| delegation.ts «level … now starts on X … delegate a fresh chat», `roleEngines` | reuse after reordering a level | ADR 0347 | this ADR |
| delegation.ts «Child permissions exceed your current policy or mode» | reuse under a parent switched to plan | ADR 0290 | narrowed by `adoptCard` instead |
| `src/shared/concept-guide.ts` «Scrivi all'Orchestrator … senza un altro campo di conversazione» | (text) said agent chats have no input | ADR 0239 | ADR 0275 (every chat keeps its input) |
| `src/main/appctl/guide.ts` model choice: a chat out of credits «goes on when the user changes the card … tell the user which card to change» | (text) | ADR 0346 | ADR 0348 (it moves by itself) |
| `src/shared/roles.ts`, `src/main/agents/orchestrator-role.ts`: reuse only with «the same … configuration / permission policy» | (text) | ADR 0186 | this ADR |
| ADR 0218 «proposed» | (status) | — | ADR 0337, 0347 (Balanced mode removed) |
| dead fields: `DelegationChats.chosenMode`, `ReviewWorld.profile`, `sendMail`'s `toHarness` | nothing | — | — |

Tests removed or rewritten because they pinned the removed rules: `policy.test.ts` «across engines: legacy false never
blocks writing»; `mail.test.ts` «blocks mail across engines when the rule refuses it»; `messaging-always.test.ts`
«accepts both directions even when an old caller still supplies false»; in `appctl.test.ts` «a Cursor chat receives
messages … inactive chats stay guarded» and «a Cursor Orchestrator writes across engines … inactive targets stay
guarded» (now one test: a stopped chat is woken unless its engine cannot run); the «Role configuration changed» and
«permissions exceed» cases of `delegation-reuse.test.ts`, `delegation-presets.test.ts` and `appctl.test.ts`; the
changed-card and stopped-other-engine cases of `one-review.test.ts`.

## Left to the owner (Sì / No)

1. **Remove the retired setting `messaging.crossHarness`** and its migrations (`src/shared/contract/settings.ts:39`,
   `src/main/brain/settings-schema.ts:245`, `src/main/brain/config.ts:195-200`, `src/main/brain/index.ts:199-201`,
   `src/main/brain/brain-settings.ts:45-52`, `brain-template/ops/tools/inbox.mjs:50`). Kept «for compatibility» since
   ADR 0065 (2026-10-16); nothing reads it. Proposal: **Sì**.
2. **Drop the refusals of removed `app_create_chat` fields** `where` (ADR 0201), `tier` (ADR 0336), `balanced` (ADR
   0347) in `src/main/appctl/tools.ts` (around lines 598-605). They only tell an old prompt what replaced the field and
   cost no tokens. Proposal: **No** (keep).
3. **`WORKER_LINE` and the delegator line in `src/shared/roles.ts:193,198`**: «If yours is closed, tell the user to
   request continuation». Since ADR 0275 the Orchestrator speaks for the user. Proposal: **Sì**, ask the parent with
   `agent_ask_parent` instead of the user.
4. **`launchGap` in `src/main/agents/delegation.ts`** («Child role needs permissions your current policy does not
   allow»): with ADR 0347 it fires only when the user narrowed the parent. Proposal: **No** (keep: it tells the parent
   the part cannot be done under its limits).
5. **`src/main/agents/role-gate.ts:176`**: an agent may not edit the brain's list of read-only tools («the list is the
   user's»). It widens what is allowed without asking. Proposal: **No** (keep, it is a permission file, ADR 0294).
6. **ADR 0067** «App-owned GitHub and Jira project connectors», «proposed» since 2026-10-16 and never built (the MCP
   connectors of ADR 0086 do it). Proposal: **Sì**, mark it withdrawn.

7. **Two records numbered 0314** (`0314-ci-green-on-three-systems.md`, `0314-every-helper-at-the-bench-workers-first.md`)
   make `node scripts/adr-index.mjs --check` fail on main, and `docs/adr/README.md` on main is not what the script
   writes (hand edits). Proposal: **Sì**, renumber the second one and regenerate the index.

## Consequences

- Fewer refusals, no manual step: a chat on any engine goes on, or moves by itself when its engine cannot run.
- A reused chat may relaunch its engine once (same history) when its card's tools changed: one cold start.
- A review chat moved to another engine loses its `reviewOf` link: the next review of that work opens a fresh one.
- Pinned by `test/unit/engines/engine-freedom.test.ts` (every pair of claude, cursor, codex and opencode; active,
  stopped and closed by itself; the refusals that stay) and `test/unit/chats/adopt-card.test.ts`.
