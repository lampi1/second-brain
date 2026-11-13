# 0223 — Plain turn ends and starts are quiet news for the Orchestrator

Status: accepted (2026-11-07, cloudroom comms proposal 1). Supersedes the hidden 👍 of `WAKE_RULE` kept in ADR 0209.

## Sole-conversation amendment (2026-11-08)

Plain starts and turn endings remain quiet. Original worker requests now use the bounded grouped delivery path,
with separate request identities so concurrent questions cannot replace one another. The desktop decision window
belongs to the Orchestrator; inspecting a worker never creates another input or approval surface. Remote Control
cannot resolve a worker request with a host-bound receipt: it receives an explicit pending notice, never an inferred
approval or a request to open the worker. Telegram retains its narrower, authenticated button capability.
Final canonical outcomes are shown automatically in the Orchestrator, expanded by default. Root tasks default to
automatic synthesis for the model-backed channel. The former manual synthesis and recap buttons are removed;
conversational recap still uses the current work list and digest.

A work chat's plain "finished" (`done`) or "started" is quiet news (`orchestrator-delivery.ts` `newsClass`): it never opens an Orchestrator turn by itself, it rides along with the Orchestrator's next turn (a loud news, the user's message) and stays in `app_digest`. Still loud: a failure (at once), a request that ends a failed turn, and a root chat's report the Orchestrator must route (an active work thread or away mode). A `synthesize` result and mail request/urgent keep their own wake paths (`manager-delegation.ts`, `mail.ts`). The quiet "finished" of a chat the app closes itself after its turn (`autoCloseMin`) is kept until that next turn, within the app run that saw the close (after a restart a legacy closed chat reads as auto-closed, so its saved news goes); a chat the user closes still drops its news. `WAKE_RULE` no longer asks the Orchestrator to reply 👍.

Why: on 07/11, 50 of the 56 Orchestrator turns opened by an app news ended with a bare 👍: tokens and noise for nothing. Replay of that day's log (`node scripts/orchestrator-wake-replay.mjs <app-2026-11-07.jsonl>`): 54 deliveries opened a turn before, 1 (the failure) now.

Trade-off: a finished worker no longer gets the Orchestrator's eyes until something else happens; the agents view and the digest still show it, and routed results stay loud. In away mode a root chat that ends without `agent_report` is quiet too: only its report is a result to route.
