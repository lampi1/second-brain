# 0221 — Plain turn ends and starts are quiet news for the Orchestrator

Accepted (2026-11-07, cloudroom comms proposal 1). Supersedes the hidden 👍 of `WAKE_RULE` kept in ADR 0209.

A work chat's plain "finished" (`done`) or "started" is quiet news (`orchestrator-delivery.ts` `newsClass`): it never opens an Orchestrator turn by itself, it rides along with the Orchestrator's next turn (a loud news, the user's message) and stays in `app_digest`. Still loud: a failure (at once), a request that ends a failed turn, and a root chat's report the Orchestrator must route (an active work thread or away mode). A `synthesize` result and mail request/urgent keep their own wake paths (`manager-delegation.ts`, `mail.ts`). A closed chat's buffered news is dropped at once. `WAKE_RULE` no longer asks the Orchestrator to reply 👍.

Why: on 07/11, 50 of the 56 Orchestrator turns opened by an app news ended with a bare 👍: tokens and noise for nothing. Replay of that day's log (`node scripts/orchestrator-wake-replay.mjs <app-2026-11-07.jsonl>`): 54 deliveries opened a turn before, 1 (the failure) now.

Trade-off: a finished worker no longer gets the Orchestrator's eyes until something else happens; the agents view and the digest still show it, and routed results stay loud.
