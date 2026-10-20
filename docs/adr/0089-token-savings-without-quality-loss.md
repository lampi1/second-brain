# ADR 0089 · Token savings that keep the same content

Date: 2026-10-20 · Status: accepted (owner, 2026-10-20: proposals 1, 2, 4, 5 of the token plan, «ottimizza
l'ottimizzabile senza perdere qualità», no new permission prompts) · Builds on: ADR 0031, 0083, 0087

## Context
A read of the flow found tokens spent on text the model already had or did not need: the role text sent again at every
resumed session, a delegation result with its summary twice and indented JSON, a plugin folder name (part of every
chat's system prompt) that changed when files were rewritten with the same bytes, and page reads of up to 40 000
characters by default that stay in every later turn's context.

## Decision
- **Role text once per context** (`chats/manager.ts`, persisted `rolePrimed` in `chats/store.ts`): a resumed session
  whose history already holds the role text does not get it again. It goes again in a new session, a fork of an external
  one, after a compaction (the summary may have dropped it), or when its text changed (checked once per engine start,
  never mid-session).
- **Compact delegation result** (`shared/delegation.ts` `resultMessage`): JSON without indentation; a one-line summary
  is on the result line only. A summary with line breaks stays in the JSON exactly.
- **Stable plugin name** (`brain/adapters/claude-plugin.ts` `signature`): from the files' content instead of their
  times, so a same-bytes rewrite keeps the folder name and the chats' prompt cache.
- **Page reads in pieces** (`browser/tools.ts` `PAGE_CHARS`): `read_page` and `get_page_text` return up to 20 000
  characters unless `max_chars` asks more; a cut ends with a note that says how to get the rest. Nothing is written to
  files the agent would need a new permission to read.
- **Emoji reactions** (`shared/reaction.ts`, owner 2026-10-20: also for Cursor and Codex): every role frame tells the
  chat to answer a message that needs no answer (thanks, ok) with one emoji only; the chat view shows a reply of one or
  two emoji as a small reaction under the user's message. It is plain reply text, so every engine does it the same way.

## Consequences
- Same information reaches the model; the cost is one extra call when a page is larger than 20 000 characters.
- Not done here, owned by the issue sweep: the independent reviewer's model (#99), the Orchestrator's own tools (#98),
  the qualified skill name (#101).

## Revision (owner, 2026-10-20, after #114)
An emoji-only reply is drawn only as a reaction on the user's own message. Anywhere else it means "noted, nothing for
you" and the chat list (`lib/chat-view.ts`) draws nothing: the app news or mail it answered, that turn's folded work
(unless it opened or wrote to a chat) and its "Turno finito" line go too. Written replies carry no emoji.

## Revision (owner, 2026-10-20: «le chat dicono una cosa e poi mandano lo stesso messaggio all'Orchestrator»)
- An agent_report's output is the chat's answer: the chat view shows it under the report row (ChatItems ToolItem,
  `reportOutput`), the item keeps it whole (`trimInput`), and the role rules say to write the deliverable only there.
- The Orchestrator's copy of a root chat's result carries an output over 800 characters as where to read it
  (`resultMessage` outputMax); a parent chat still gets it whole. Its rules say never to restate a chat's result.
- No second wake for the same news: a turn that gave its agent_report adds no "finished", and a delegated chat's
  "finished" (no text, its result goes to its parent) rides along instead of waking the Orchestrator.
- A delegated child's first message carries the contract only: reporting and asking rules are in its role frame,
  sent with it; the role's default output is not written twice.
- app_digest with since names waiting or failed chats already told (their text only when new) and says "PR invariate"
  when Task was not read again.
