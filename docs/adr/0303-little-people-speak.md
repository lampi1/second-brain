# ADR 0303 · The little people speak: two words of nonsense, a character per role

Date: 2026-11-13 · Status: accepted (owner, 2026-11-13: «vorrei che mentre gioco gli agenti avessero animazione tipo
sto pensando e mi dicessero frasi divertenti e stupide esilaranti quasi nosense, ogni agente un carattere diversi
queste frasi mi piacerebbe vederle anche nella grindhouse un fumettino a scomparsa che duri poco, 2 parole nosense
umorismo informatico, macabro, nosense, esilarante, cringe ogni agente un carattere»; and a few minutes later: «i
testi vorrei che fossero il più collegati possibile a quello che stanno realmente facendo idem per gli scacchi, però
a zero consumo di token se possibile») · Builds on: ADR 0295 (the
little people), ADR 0297 (their reactions to a click)

## Context

The roles are little people on the Grindhouse strips. The owner wants them to say short, silly, almost senseless
lines, each role with a character of its own, in a small bubble that goes away quickly; the chess section built at
the same time (its own ADR) is to use the same characters and lines for the opponent.

## Decision

1. One set of lines for the whole app, in `src/shared/agent-quips.ts`: fixed text in code, never model or user
   content. Seven speakers (the six roles and `plain`, the person of an agent without a role), each with a character
   in one line (`QUIP_CHARACTER`): the Orchestrator a pompous conductor, the Strategist an over-planning chess nerd,
   the Scout an over-keen explorer who is always lost, the Artisan a gruff craftsman with a hammer, the Sentinel a
   paranoid guard with a macabre streak, the Herald a melodramatic town crier, the plain one a burned-out office
   worker. Lines are one to five words and at most 24 characters as written (a few more once a name is in), in
   Italian, English and German.
2. Lines are grouped by moment (`QuipKind`), so a line is about what the agent is really doing, with no model call:
   the states `think`, `wait` (for the user), `err`, `done`, `idle`; what its tool does, `read`, `edit`, `run`,
   `test`, `search`, `web`, `delegate` (`quipOfTool` reads the tool's name and input as every engine names them);
   `work` (14 per role) for anything else; `pat` and `whack` (3 each) at the click of ADR 0297. Each moment has two
   lines per role; one may carry `{x}`, replaced by the real name: the file read or edited, the program of a
   command, the words of a search, the host of a page (cut to 12 characters). Only a plain program name is said:
   what stands in quotes or is computed in place is taken out of the command first, so a variable's value or a
   quoted path is not; a command is a `test` when one of its steps is a test runner or a tool asked to test (`npm
   test`, `dotnet test`, `python -m pytest`), not when the word is in a message or a file name. The list of runners
   and tools is short and fixed: an unknown one is a plain `run`. `pickQuip` does not repeat the line said last when it has another, and gives a `{x}` line only when
   there is a name. A new moment is a new kind in the same file.
3. The bubble is part of the person (`AgentSprite.tsx`, `lib/quips.ts`): a small inverted pill at the head that pops
   in, stays 2.6 s and fades. Every person says a line when clicked (strips, role cards, the Orchestrator's line).
   On a Grindhouse strip the person also speaks by itself: the first time after 15 to 60 s, then every 60 to 150 s,
   one voice at a time on the page. What it says is read at that moment from the chat's state and the last tool of
   its transcript (`lib/quips.ts` quipMoment); one line in three is the role's plain `work` nonsense, for
   variety. About an end it speaks once, until the chat works again, and always as an end.
4. It never speaks by itself while the window is hidden, on the frozen demo clock (the screenshots stay equal) or
   under prefers-reduced-motion. The bubble is decoration: hidden from screen readers, it takes no click.
5. No setting to turn it off for now.

Amended by ADR 0305 (2026-11-14): while its chat works a person speaks nearly all the time and each line stays 6 s,
up to three people speak at once (point 3); a click's line starts once the hand or the stick has left; the fixed
lines are joined by lines of the day written by the lightest model (point 1), with a setting to turn those off.

Amended by ADR 0306 (2026-11-14): the characters are adults (an old wizard, a cold strategist, a weathered tracker,
a gruff blacksmith, a merciless guard, a pompous town crier, a burned-out senior developer) and every fixed line is
rewritten in them, in the three languages.

## Consequences

- One pending timeout per strip with a person, nothing per frame, no token: the transcript is already in the app.
- For its 2.6 s the bubble covers the start of the row's text beside the head.
- The humour is fixed text: adding or changing a line is a code change, in three languages. It follows the kind of
  work and names its object, not its meaning: a line about what a file contains would need a model.
- Tried in the demo only, not on a real PC.
