# ADR 0239 · Single entry: the user talks only with the Orchestrator, and a command is asked once

Date: 2026-11-09 · Status: partly superseded by ADR 0275 (the «reserved» answers, and every agent chat keeps its own input again) and ADR 0299 (the same command is asked once in any folder); accepted (owner, project thread on total agent autonomy, 2026-11-09: «idealmente un utente
la userà principalmente da telegram o remote control quindi tutto deve essere fatto parlando solo con
l'orchestrator») · Builds on: ADR 0017 (command requests, run results), ADR 0219 (Telegram bridge), ADR 0229 (Remote
Control), ADR 0083 (requests hosted by the nearest open chat) · Pattern source: davidondrej/cloudroom (a child's
blocker is told to its parent, which resolves it from context or asks the user; it never approves for the user) · Amended by: ADR 0272

## Context
On the PC every work chat's request already shows in the Orchestrator (renderer `child-requests.ts requestHost`),
and worker questions, permissions and commands already wake it as grouped news. Two gaps were left:
- **Remote Control** shows only the Orchestrator's own engine on claude.ai. A panel the app builds for a work chat
  never reaches it, so a worker question waited for the PC (`app_resolve_question` refused, by design, any answer
  written by an agent).
- **The same command could be asked several times**: two chats, or a chat and the Orchestrator, leaving the same
  block got one «Comando da eseguire» each, and a command that had just worked could be proposed again.

## Decision
- **Questions through the Orchestrator's conversation** (`chats/relay.ts`, tool `relay_question`, shown to the
  Orchestrator only and pre-approved like the other app chat tools). The Orchestrator names a work chat; the app takes
  that chat's oldest open request and, if it is a single Sì/No question of the engine's own question tool that touches
  nothing reserved (`phoneQuestionReserved`: production, deploys, pushes, secrets, messages to people), returns its
  exact text to write. The user's **next own message** in the Orchestrator chat that is only «sì» or «no» (from the
  PC, the paired phone or Remote Control) answers it, through `ChatManager.answer` as the user's answer (`phone` when
  it came from a phone or Remote Control). An agent's mail or the app's news never count; any other message ends the
  relay, so a later bare «no» meant for something else never answers it (one that follows such a message is told
  to the Orchestrator, as the question may have crossed it). One relayed question per Orchestrator at a
  time; it lasts 30 minutes and drops when the question is answered elsewhere. The reserved check runs again when the
  answer comes (a brief can change). A «sì»/«no» that cannot land (expired, question changed, turned reserved,
  delivery failed) is told to the Orchestrator as an app line, never lost in silence. Permissions and commands are
  never relayed: they stay the user's click on the PC (the three «Esegui» categories).
- **A command is asked once** (`run/asks.ts`). A block with the same code (line ends and trailing spaces aside) in the
  same folder as another chat's open request is not asked again: that chat follows it. A run of any chat's block
  answers every open request of the same code and folder, and its result reaches each of those chats
  (`run/results.ts`, with a line saying the user ran it once for all). When an open request leaves without a run
  («Non serve», its chat went on), its first follower is asked instead. A block that ran with success in the same
  folder in the last hour is not asked: the chat gets that run's result, once per chat and code; proposed again, it is
  asked as usual (and always when run results are off). A run that could not start answers only its own block.
- **The Esegui result goes to the chat that needed it**, already true for the proposing chat (ADR 0017), now also for
  every chat that asked the same block.
- **Rules**: the Orchestrator's `WAKE_RULE` says to use `relay_question` when the user is away and that the rest waits
  for the PC; `app_resolve_question` and the Remote Control guide point to it.

## Consequences
- From Remote Control or Telegram the owner answers a work chat's Sì/No question by answering the Orchestrator.
- Telegram's own buttons for worker questions stay as they are (ADR 0219); a relayed question answered there first
  closes the relay.
- Not covered: worker permissions and multi-option questions away from the PC (they wait for the PC by design).
- Tests: `test/unit/chats/relay.test.ts`, `test/unit/command-ask.test.ts`, `test/unit/run-results.test.ts`; fake
  deps and fake timers only.
