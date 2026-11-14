# ADR 0305 · The little people show the work at hand, speak while they work, and get new lines every day

Date: 2026-11-14 · Status: accepted (owner, 2026-11-14: «il testo a volte nasconde il bastone della bastonata quindi
vorrei che si risolvesse questa cosa, e che ci fossero più frasi che compaiono con più varietà secondo me ogni giorno
dovrebbero cambiare, un modello minuscolo per farlo, tipo la frase del giorno ma deve essere tutto molto vario»; and a
minute later: «che le frasi si vedano finché lavorano, frasi e animazioni molto più varie che rispecchino un po'
quello che stanno facendo») · Builds on: ADR 0295 (the little people), ADR 0297 (their reactions to a click) ·
Amends: ADR 0303 (the little people speak: when, how many voices, where the lines come from)

## Context

After a day with the speaking people the owner asked for four things: the bubble must not cover the stick of the
whack; the lines must be seen as long as the agent works, not once a minute or two; lines and animations must be many
more and show what the agent is doing; and the lines should change every day, written by a very small model.

## Decision

1. The bubble and the stick. A click's line starts when the hand or the stick has left the head (`lib/quips.ts`
   QUIP_REACTION_AT: 250 ms after a pat, 1000 ms after a whack; the bubble's animation is delayed, so it is not
   drawn before) and during the reaction the bubble stands further right (`agent-sprite.css`).
2. Six scenes of work for every role (`lib/agent-sprites.ts` ACT, `SpriteActivity`), beside the role's own trade:
   `read` (an open book, a page turning), `run` (a finger slams the enter key, a terminal prints lines), `test` (a
   test tube and a checklist that gets its ticks), `search` (a lens over the pages), `web` (the world on a fingertip,
   a pointer clicking), `delegate` (a paper plane thrown). Drawn with the role's own look, on the same rig and rules
   as the other scenes (ADR 0295). An edit and work the app cannot name stay the role's trade.
3. The scene follows the chat (`StripFace.tsx`): the kind of the chat's last tool, read with the same `quipOfTool`
   as the lines, zero tokens. A scene stays at least 4 s (ACTIVITY_MS), so quick tools do not make the person
   flicker; `data-sprite-activity` says which one is drawn.
4. While its chat works or thinks a person speaks nearly all the time: a line stays 6 s (QUIP_WORK_MS), the next
   comes 2.5 to 6 s after it. The line is about the kind of work the person is drawn doing, with the last real thing
   of that kind (`quipMoment(state, items, shown)`); one in three stays the role's plain nonsense. A person that
   waits, rests or has ended speaks as before (ADR 0303: 2.6 s, every one or two minutes). Up to three people speak
   by themselves at once (QUIP_VOICES), and two never say the same line at the same time.
5. Lines of the day (`src/main/quips/daily.ts`, `shared/agent-quips.ts`). Once a day, for the language the app is
   shown in, the lightest model of an engine the user turned on writes new lines for every role and moment: three
   small one-shot calls (`agents/oneshot.ts`, light: no role text, no tools, no file; purpose `phrases`, not counted
   in any role's performance), each with the characters, the moments, a theme of the day the model picks, and a
   sample of the lines said lately to stay away from. Eight lines for `work`, three for every other moment.
6. What a model wrote is text for a bubble and nothing else. `parseDailyQuips` reads rows `role.moment: a | b | c`
   and keeps a line only if `cleanQuip` accepts it: a known role and moment, at most 24 characters and five words,
   letters, digits and plain punctuation only (no markup, link or code), at most one `{x}` and only in a moment that
   names a thing, not a fixed line, not twice. The file the lines are kept in (`userData/quips-daily.json`) goes
   through the same reader every time it is read.
7. The lines are kept seven days and all of them are said, today's first, beside the fixed ones (`quips()`; the chess
   opponents get them too through `pickQuip`): the choice grows for a week and then turns over. The fixed lines are
   always there: no engine, no network, a day the model wrote nothing usable.
8. Limits: at most two tries a day per language, 30 minutes apart, the try counted before the model is asked; a part
   that came whole is not asked again. The renderer asks 20 s after the app's start and then every hour
   (`lib/daily-quips.ts`, IPC `agents:quips`). Setting `quipsDaily` (default on, changed through the Orchestrator)
   turns the calls and the lines off. None in the demo.

## Consequences

- Cost. A trial of the request with a small model gave 200 lines for four roles in about 5200 characters, 199 kept
  by the reader; the whole day is about 350 lines per language. That is an estimate from one trial, not a
  measurement on the user's engines; the run appears in the agents' runs as `phrases` with its cost.
- A working strip now has a bubble over the start of its text most of the time: the owner asked for it.
- A model's line can be flat or odd: it is short, plain text, said for a few seconds and gone in a week. Nothing it
  writes is shown anywhere but the bubble.
- More scenes to keep in step with the rig: a new kind of work is a new scene and a new moment of lines.
- Tried in the demo and with one trial of the request; not on a real PC with the user's engines.
