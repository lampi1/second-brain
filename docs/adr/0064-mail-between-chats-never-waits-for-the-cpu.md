# ADR 0064 · Messages between chats never wait for the CPU

Date: 2026-10-16 · Status: accepted · Amends: ADR 0036 (what never waits) · Source: the owner (16/10: "questa è una
funzionalità core non può essere traballante"; chose "Tutte subito")

## Context
Mail to an idle chat (`send_to_chat`, `inbox.mjs`) was never put in the CPU queue (a queue lost at quit would lose
it): with the machine over the thresholds or anyone queued, `ChatManager.send` refused it, `mail.ts` put it back unread
and retried every 2 s. It never held a place, so under a steady load it lost the race to every sample: on 15-16/10 the
stable app's inbox log shows ~24 000 take-and-return cycles for the "Regia dell'app" alone, mail waiting up to 5 hours
(the night's load), and ~56 000 more for the other chats (the other Regia, work chats). Only the user's own message (which never waits) started a turn,
and the waiting mail then joined it: "it arrives only when I write". Meanwhile `send_to_chat` told the sender "entro 30
secondi". `app_send_to_chat` had the opposite problem: queued for real, behind every new chat, for as long as the load
lasted.

## Decision
- A message from another chat (`send` with `from` set, not the app's own resume) to a chat that is not closed goes at
  once, like the user's own: what that chat already had queued runs first (`admitNow`), then this one. The Regia
  rule (ADR 0056: classes, grouping, a Regia waiting for the user) still decides *when* mail is due; the CPU no longer
  does.
- Still through the queue: a new chat's engine (`app_create_chat`), an agent reopening a **closed** chat
  (`app_send_to_chat`: a new engine), the app's own resume after a restart. These are the engine starts the queue
  exists for.
- `MAIL_WAITS` and `AdmissionQueue.wouldWait` are gone; what `send_to_chat` promises is now what happens.

## Consequences
- A mail can start a turn (and the tests or builds that turn runs) on a PC already over the thresholds: the owner chose
  this over a cap or a place in the queue (options shown 16/10).
- Tests: `test/unit/chats/admission.test.ts`: real `ChatMail.tick()` mail reaches an idle chat at once under load
  (taken once, never put back, another chat still queued); `app_send_to_chat` to an open chat goes at once, after
  the chat's own queued work; an archived chat reopened by an agent still queues.
