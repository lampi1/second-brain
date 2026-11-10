# ADR 0260 · The recap is a short list per agent (app_agents_recap)

Date: 2026-11-10 · Status: accepted (owner, 2026-11-10: «quando chiedo un resoconto all'Orchestrator voglio che mi dia
un elenco puntato breve per ogni agente gli ultimi punti che ha fatto … anche da telefono so bene tutti gli agenti
dell'app cosa stanno facendo e a che punto sono») · Amends: the Orchestrator's «Fai il punto» rule (ADR 0135), which
said «never output a text recap or one line per job»

## Context

On «fai il punto», «resoconto», «a che punto siamo» the Orchestrator was told to answer with proposals only and at most
one status sentence. The owner wants the opposite: from the phone too, a short, clear picture of every agent.

## Decision

1. A new read-only tool on the Orchestrator's own endpoint, `app_agents_recap` (`src/main/appctl/agents-recap.ts`),
   builds the recap from what the app holds, zero tokens: one plain-text block per open agent.
   - Head: a status mark (🙋 aspetta te, 🔴 errore, 🟢 al lavoro, ⏳ in coda, ✅ ha finito, 💤 ferma), role and title.
   - Up to 3 steps done (`- ✓ …`, 90 characters each): from the chat's latest todo or plan list (Claude TodoWrite,
     Cursor/ACP todos and plan), else the first sentence of each message since the user's last one.
   - One line on where it stands: the request waiting for the user, the error, the queue position, the current step,
     the last report or the next step.
   - Delegated chats sit under their parent with their state only (ADR 0083; their messages stay the parent's).
   - The ones waiting for the user first; a last line names the chats closed in the last 6 hours.
2. The Orchestrator's rule: on a recap it reads `app_agents_recap` (with app_work_list, app_digest and
   agent_lessons_waiting as before) and replies with its text as it is: no intro, no closing, no table. Decisions
   still go only through the existing panels and app_unblock.
3. Plain text, no bold: Telegram gets no parse_mode. On the phone a reply that is the recap (`isAgentsRecap`) gets up to
   2,400 characters instead of 600 (`phone/condense.ts condenseReply`); it still passes the one outgoing filter.

## Consequences

- One tool call, the same format every time, readable on the PC and on the phone.
- A chat without a todo list and with long messages shows only their first sentences; good enough for «a che punto è»,
  the full result stays in the chat.
- Chat titles reach the phone inside the recap, as they already could inside any Orchestrator reply (the filter's known
  limit, phone design §9).
