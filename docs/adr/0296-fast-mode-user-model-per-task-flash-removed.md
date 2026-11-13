# ADR 0296 · «Fast» beside «Plan», one task on the model the user names, Flash removed

Date: 2026-11-13 · Status: accepted (owner, 2026-11-13: «Vorrei anche che l'app e l'orchestrator possano avviare un
singolo agente con il modello che chiede l'utente senza dover per forza cambiare il modello all'agente […] non voglio
più l'agente flash, levalo è inutile voglio una modalità fast affianco a plan nell'orchestrator che non deleghi e
risponda il più velocemente possibile il meglio possibile super sintetico ma senza perdite di qualità o inventandosi
cosa […] pulisci dai refusi che non rimangano ricordi lontani») · Supersedes: ADR 0105, ADR 0106, ADR 0107 · Amends:
ADR 0131 (Flash's XP), ADR 0152 (voice in Flash), ADR 0170 (Flash's counter), ADR 0196 (the Guide's engine), ADR 0207
(Flash's MCP role), ADR 0209 (Flash's brief)

## Context

The owner often asks the Orchestrator to start one task with a given model. `app_create_chat` refused `model`
(«the role decides it»), so the Orchestrator changed the role's card, and every later chat of that role ran on it.

Flash, the read-only tab beside the Orchestrator, was not used: the owner calls it useless. What he wants instead is a
way to get a quick answer from the Orchestrator itself, without it opening chats.

## Decision

1. **One task, the user's model.** `app_create_chat` takes `userModel` {engine?, model, effort?}, only when the user
   named the model for this task. The engine, when omitted, is the one whose model list has that id or name (the
   role's engine first); a model no engine lists is refused, so a typo never starts a chat on a model nobody asked for
   (`agents/discovery.ts userModelOf`). `catalog.resolve` uses it before Balanced mode and the card, and does not hold
   it to the role's tierMax (the user asked for it). The engine must be on and trusted and able to pick a model. The
   role's tools, ceiling and skills stay; the card is not changed. `agent_catalog` with `models: true` lists each
   engine's models. `userModel` cannot be combined with `balanced` or `tier`, and only the authenticated Orchestrator passes it (the plain
   /mcp/app mount and the renderer's `chat:create` never do). Without an effort it runs at the model's default
   effort, not the card's, as Balanced mode does.
2. **Fast mode.** A «Fast» toggle beside «Plan» in the Orchestrator's input sends the line `[fast] …`
   (`shared/newchat.ts MODE_LINES`): answer yourself, now, in a few lines, answer first; only what you know or read now
   with at most one quick read; no guessing: if you do not know or it needs real work, say so in one line. The app
   enforces the "no delegation" part: in a turn whose latest user message is a `[fast]` one, `app_create_chat` and
   `app_assign_task` are refused with a line that tells the Orchestrator to answer itself (`appctl/tools.ts
   fastTurn`). Plan and Fast are exclusive, like the old single toggle. The rule reads the latest user message, so a
   later message (an agent's mail) ends it; app_send_to_chat, workflows and schedules are not refused.
3. **Flash is removed**, with everything that was only its: the tab and `LampoTile`, the `quick` chats, its catalog
   card and character, its XP and outcome log (`flash-outcomes.ts`), its MCP role, its brief («Fanne un lavoro»), its
   voice target, its texts in three languages and the guide card. The Orchestrator's column shows its title instead
   of the two tabs. The Guide's one-shot answers run on the Scout's engine at the light tier.
4. **Old data is read past, not kept.** A saved Flash chat is dropped when chats load; a `flash` entry in roles.json
   is an unknown id and left out; an MCP access entry for `flash` is dropped on load and can no longer be set; the
   run store's old `flash` meta row (that key only) is deleted at its next save, and an old agent-runs.json's `flash` block is not
   imported.

## Consequences

- The owner names a model in plain words and one chat runs on it; the Agenti page keeps showing the role's own model.
- Fast is a promise the model keeps (short, no invention) plus one rule the app keeps (no delegation in that turn).
- Older ADRs and the changelog still mention Flash as history; their statuses name this record.
