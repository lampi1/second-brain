# ADR 0361 · One order of the engines, a threshold each, the reason on every chat, and changes that are never lost

Date: 2026-11-25 · Status: accepted (owner, 2026-11-25: «Claude va usato per ultimo», asked several times, and an Artisan
still started on Claude; «un ordine dei motori unico, modificabile in un punto solo, valido per tutti i ruoli») · Amends:
ADR 0347 (the pick in a level), ADR 0348 (what moves a waiting chat), ADR 0149 and ADR 0350 (the proof of a configuration
change), ADR 0346 (a waiting chat may wait on an engine that did not start), ADR 0352 point 5 (with an order a reuse
follows it; without one the chat stays on its engine), ADR 0354 (the pick reads the order and the thresholds)

## Context

- The order of the engines lived in each role's three lists: eighteen lists to change for one wish.
- On 2026-11-24 the Orchestrator asked with a Sì/No panel, the owner said yes twice, and `app_config` refused both times.
  Found in the log: the news of the other chats waits while a question is open and is delivered 0,1 s after the answer.
  It lands as a 'user' item newer than the yes, so `userAsked` (no item after the proof) was false. It happened every time
  news was waiting. The refused change was then lost.
- What the app did when the first engine could not work: spent = the next one (ADR 0347, 0348); not connected = skipped, but
  said as «spento»; in error at its start = the chat failed and the next start tried the same engine again. Since ADR
  0354 the limits are the real ones and a stopped chat moves within its level.

## Decision

1. **One order** (`Settings.engineOrder`, `shared/engine-order.ts`): engine ids, first tried first, for every work role. A
   level's list still says which model and effort each engine runs; the order only sorts the list. No order = the list's own.
   A role may have its own order (`AgentProfile.engineOrder`), shown on its page and in Impostazioni. The Orchestrator stays
   on its chat's engine.
2. **A threshold per engine** (`Settings.engineThresholds`, 10-97%, `pastThreshold` on the reading of ADR 0354): a plan past
   it is passed over while another engine has room; when all are past it the first starts, and the reason says so. With an
   order, a plan «on pace» to end is no reason to skip it any more: the threshold is the user's own line.
3. **The first available engine starts**: connected (installed and logged in), on, allowed to agents, with room, not in error
   in the last ten minutes (`agents/engine-health.ts`), with the tools the role needs. An engine in error or without the tools is
   passed over only while another may start. A chat whose engine did not start (it wrote nothing and used no tool) waits and
   moves to the next one as a chat out of credits does (8 s to cancel), with its whole first message.
4. **Every plan spent is never silent.** As ADR 0354 decides, the chat starts on the order's first and waits for the renewal;
   a warning in the chat, the tool's answer and a feed notice say that every engine is at its limit and when the first is
   back. No engine of the level connected and on: nothing starts (`NoEngine`), and the refusal names each one.
5. **The reason is one line on the chat**: «OpenAI Sol: primo disponibile», «Claude Opus: OpenAI al limite, Antigravity non
   collegato». First line of the transcript, the model's tip on the strip, the run's `presetChoice.route`, the tool's answer.
6. **Chats under way never change engine by themselves.** A start, a reuse and «Riprendi» read the order as it is then
   (`agents/engine-now.ts`) when there is one; another engine goes on in a linked chat. With no order a reuse stays on its
   engine while that one can run (ADR 0352). A model the user asked for that work is kept; a level with no room anywhere
   moves nothing. A job's Strategist with children at work stays where they report.
7. **A yes that names the change is enough** (`user-words.ts yesAbout`, `config.ts names`): the question, its «Sì» option and
   the «Se Sì» of its own brief must hold the change's canonical sentence word for word or, for an order, one sentence that
   names those engines in that order and no other, for every role (or for that one role). One yes, one change. What reaches
   the chat after the yes does not matter then, because the change is compared with what the user read. New instructions
   are never named by a short card. Any other change still needs the old proof.
8. **A change not applied is never lost** (`appctl/pending-config.ts`): with no proof, or refused by its own check, it stays
   «da applicare» on a Sì/No panel the app writes with the exact change (a long text whole) and the reason, over restarts. No
   agent's brief dresses it. The user's Sì applies it in main; his own words go to the Orchestrator and the panel stays.
   Night mode, the Orchestrator and the phone never answer it. The folders of Codex's autonomy are never held.
9. The order raises no effort and no permission: it picks among the models the lists already hold.

## Consequences

- Room is as good as the reading: an engine with no usage reading never passes its threshold (it is «limite non letto»).
- The price ceiling of a delegation (ADR 0336) still applies and shows as a reason.
