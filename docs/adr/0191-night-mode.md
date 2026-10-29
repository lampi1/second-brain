# 0191 — Modalità notte: the user is away, the agents go on with the recommended choices

Status: accepted. Builds on ADR 0035, ADR 0083, ADR 0108, ADR 0135, ADR 0149 and ADR 0150.

2026-10-29.

## Context

The owner, 2026-10-29: «una modalità in cui non faccia domande e prosegua tutta la notte finché non ci sono e non si
ferma, che ogni agente sappia che io sono afk e deve andare avanti con i consigliati e non interrompersi finché non ha
finito». Today every genuine decision is a yes/no question to the user (ADR 0135, 0150), a Strategist waits for «Approva
e parti» (ADR 0108), a workflow's mockup and plan wait for a proposal approved by the user, and a permission the app does not
grant by itself waits on a card. At night each of these stops the work until the morning, and Windows may put the PC to
sleep. «Rispondi dopo» (ADR 0035) only holds the popups: the asking chat stays blocked.

The owner's standing limits stay: production actions, secrets, settings/hooks/permissions and messages to people or
external services are never approved by the app.

## Decision

**One setting.** `awayMode` («Modalità notte», not protected): the moon on the Orchestrator's head, a row in Impostazioni →
Ruoli e deleghe, or the Orchestrator itself with `app_config` when the user says they are going away (its rules have
one line for it). While it is on, a line under the Orchestrator's head says so, with «Sono qui» to turn it off.

**Every agent knows.** Each chat gets `AWAY_RULE` (shared/away.ts) with its first turn in a new context while the mode
is on: ask nothing, decide with the option you would recommend, keep working until the whole job is done, and leave
production, secrets, permissions and messages to people ready for the user's return. After the mode goes off, the
next turn of a chat that was told gets one `AWAY_BACK` line.

**Nobody waits.** In the chats (ChatManager.awayAnswered, after the role gate and auto-permit):
- a question gets its recommended option: the one marked «(consigliato)», else «Sì», else the first. The chat shows
  «Modalità notte: l'app ha scelto …»;
- a permission request is **refused**, never granted, with a message to go on without it and list it in the report.
  It is parked for the recap. A command left for the user's «Esegui» is unchanged: it never blocked the chat;
- a Strategist's `plan_propose` starts the plan at once (phase running) and needs no clarifying question first;
- a workflow proposal (`app_work_report propose`) for mockup or plan is approved by the app. The thread's event says
  it was the app in Modalità notte, not the user. A **deploy** proposal always waits for the user.
When the mode goes on, what already waits is settled the same way (`settleForAway`).

**The Orchestrator carries the work on.** While the user is away, a root chat's clean report wakes the Orchestrator,
the same as during an active workflow (otherwise it is quiet news until the user's next message), so it can start the review, the
next step or the next chat.

**The PC stays awake.** `powerSaveBlocker` `prevent-app-suspension` while the mode is on (the screen may still turn
off).

**The recap.** Every choice and every parked request goes to `userData/away-log.json` (chats/away-log.ts, bounded,
survives a restart). When the mode goes off, the Orchestrator's chat gets one app notice: how long the night lasted, the
choices the app made, and what waits for the user (parked permissions and anything still open). It is not a turn and costs
no tokens.

## Consequences

- An unattended night produces work the user did not approve step by step. Every such choice is visible in the
  chat where it happened, in the thread's events and in the recap.
- A permission the app refuses at night may leave a part undone until the user grants it in the morning. This is
  deliberate: permissions were never the app's to grant (ADR 0085, 0103).
- The Orchestrator may turn the mode on only on the user's own recent words, like every `app_config` change (ADR 0149).
