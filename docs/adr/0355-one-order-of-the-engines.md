# ADR 0355 · One order of the engines, a threshold each, the reason on every chat, and changes that are never lost

Date: 2026-11-25 · Status: accepted (owner, 2026-11-25: «Claude va usato per ultimo», asked several times, and an Artisan
still started on Claude; «un ordine dei motori unico, modificabile in un punto solo, valido per tutti i ruoli») · Amends:
ADR 0347 (the pick in a level), ADR 0348 (what moves a waiting chat), ADR 0149 and ADR 0350 (the proof of a configuration
change), ADR 0346 (a waiting chat may wait on an engine that did not start)

## Context

- The order of the engines lived in each role's three lists: eighteen lists to change for one wish.
- On 2026-11-24 the Orchestrator asked with a Sì/No panel, the owner said yes twice, and `app_config` refused both times.
  Found in the log: the news of the other chats waits while a question is open and is delivered 0,1 s after the answer.
  It lands as a 'user' item newer than the yes, so `userAsked` (no item after the proof) was false. It happened every time
  news was waiting. The refused change was then lost.
- What the app did when the first engine could not work: spent = the next one (ADR 0347, 0348); not connected = skipped, but
  said as «spento»; in error at its start = the chat failed and the next start tried the same engine again; every plan spent
  = the first one started anyway and stopped on its limit.

## Decision

1. **One order** (`Settings.engineOrder`, `shared/engine-order.ts`): engine ids, first tried first, for every work role. A
   level's list still says which model and effort each engine runs; the order only sorts the list. No order = the list's own.
   A role may have its own order (`AgentProfile.engineOrder`), shown on its page and in Impostazioni. The Orchestrator stays
   on its chat's engine.
2. **A threshold per engine** (`Settings.engineThresholds`, 10-97%): a plan past it is passed over while another engine has
   room; when all are past it the first starts, and the reason says so. With an order, a plan «on pace» to end is no reason
   to skip it any more: the threshold is the user's own line.
3. **The first available engine starts**: connected (installed and logged in), on, allowed to agents, with room, not in error
   in the last ten minutes (`agents/engine-health.ts`), with the tools the role needs. An engine in error or without the tools is
   passed over only while another may start. A chat whose engine did not start waits and moves to the next one as a chat out
   of credits does (8 s to cancel).
4. **Every plan spent: nothing starts** (`NoEngine`), a feed notice says which and why.
5. **The reason is one line on the chat**: «OpenAI Sol: primo disponibile», «Claude Opus: OpenAI al limite, Antigravity non
   collegato». First line of the transcript, the model's tip on the strip, the run's `presetChoice.route`, the tool's answer.
6. **Chats under way never change engine by themselves.** A start, a reuse and «Riprendi» read the order as it is then
   (`agents/engine-now.ts`); another engine goes on in a linked chat. A model the user asked for that work is kept. A job's
   Strategist with children at work stays where they report.
7. **A yes that names the change is enough** (`user-words.ts answeredText`, `config.ts names`): the question card's words,
   brief included, must hold the role and the values, or the engines in that order in one sentence. What reaches the chat
   after the yes does not matter then, because the change is compared with what the user read. Any other change still needs
   the old proof.
8. **A change not applied is never lost** (`appctl/pending-config.ts`): with no proof, or refused by its own check, it stays
   «da applicare» on a Sì/No panel the app writes with the exact change and the reason, over restarts. The user's Sì applies it
   in main, with no agent in between. Night mode, the Orchestrator and the phone never answer it.
9. The order raises no effort and no permission: it picks among the models the lists already hold.

## Consequences

- Room is as good as the reading: an engine with no usage reading never passes its threshold (it is «limite non letto»).
- A reuse after a role's card changed is still refused («Role configuration changed»): a fresh chat uses the order.
- The price ceiling of a delegation (ADR 0336) still applies and shows as a reason.
