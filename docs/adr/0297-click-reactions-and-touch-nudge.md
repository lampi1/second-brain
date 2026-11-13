# ADR 0297 · A click on a little person: a pat or a crack of the whip, and a nudge on the run

Date: 2026-11-13 · Status: accepted (owner, 2026-11-13, after approving the little people of ADR 0295: «vorrei anche
che avessero reazioni al click, che il click gli desse tipo una frustata o tipo un buffetto, click destro e sinistro
con una bella animazione e con una bella reazione»; «vorrei anche che valesse come feedback positivo o negativo in
maniera minima però io sono uno che clicca compulsivamente»; «davvero minima») · Builds on: ADR 0295 (the people),
ADR 0131 (the performance estimate)

## Context

The roles are little people on the strips, on the Orchestrator's working line and on the front of the role cards.
The owner wants them to react when clicked, with two different reactions for the two mouse buttons, and wants the
click to count as a positive or negative feedback on the agent: a really small one, because he clicks a lot.

## Decision

1. A left click on a little person is a pat: a gloved hand pats its head twice, the head sinks and springs back,
   a happy wiggle, a small hop, hearts. A right click is a crack of the whip: the whip winds up over the head and
   lands at its side, a star where it lands, the person jumps away with its arms up, lands squashed, trembles and
   comes back. Each is one more scene of the rig (`lib/agent-sprites.ts` REACT, `reactionScene`), the same acting
   for every role in its own looks, played once (1.3 s and 1.4 s); then the person goes back to its state. A new
   click starts the reaction again from the top.
2. The click stays on the person: it does not open or fold the strip, turn the card or open a menu.
3. On a strip or a delegated row whose chat is an agent run, the click is also a nudge on that run: `AgentRun.touch`
   keeps the sign (+1 the pat, -1 the whip) and the time. One per run: the last one stands, the same sign again
   writes nothing (the renderer does not even send it), so a hundred clicks weigh as one. A new request to the same
   chat opens a new run, which can take a mark of its own; the ended one keeps its.
4. The nudge weighs `TOUCH_TRUST` = 0.05 in the performance estimate: a twentieth of a verdict the user writes, with
   the same ageing (half weight every 30 days). All the nudges of one role together weigh at most `TOUCH_CAP` = 0.5,
   half a written verdict: past ten clicked runs they are scaled down and keep only their balance, so a user who
   clicks on every run moves the number as little as one who clicks on ten. It is not a verdict: it moves the
   role's mean only. It is not counted among the verdicts the performance needs before it shows, it does not narrow the ± (so clicks alone
   never take a role out of «in rodaggio»), it does not reach the per-model rows, it earns no XP and no level, it
   does not end the run and it is not chat activity (a stalled child stays stalled). The card's «?»
   on the performance says how many pats and whips the role has.
5. `run:touch` is renderer IPC only, never an agent tool: a chat id and +1 or -1, nothing else.
6. Where there is no run the person only reacts: the Orchestrator's working line (its chat is permanent, it is rated
   by the runs it opens), the front of a role card, a chat without a role.

## Consequences

- The estimate moves a little with something the user does without thinking: this is what he asked for, and the
  weight and the one-per-run rule keep it small. A written verdict on the same run weighs twenty times more.
- A nudge on a run that is later pruned into the rollups is lost with it.
- The reactions are not reachable from the keyboard: they are a toy on top of the state the row already says in
  words; the tooltip says what a click does and, on a strip, what the run keeps.
- Tried in the demo only, not on a real PC.
