# ADR 0261 · What the user did not type reaches a Claude engine in an `<agent-message>` envelope

Date: 2026-11-10 · Status: accepted (owner, 2026-11-10: the app must run the AI-DLC flow fully, like Cursor; the app's
relayed messages must never count as the owner's turns or approvals) · Related: ADR 0083 (its AI-DLC amendment)

## Context

AI-DLC projects record every prompt with a `UserPromptSubmit` hook (`record-human-turn`): a prompt is the host's when
its transcript row says so, or when the whole trimmed prompt matches one of its host templates; otherwise it is the
person's (`Origin: person, Source: typed`). The app drives Claude Code over stream-json, so every message, typed or
not, has `promptSource: "sdk"`, and at hook time the row is not written yet. Agent mail, delegated contracts, the app's
resume, wake-ups and notices were therefore recorded as the owner's typed turns, and could be read as his approvals.

## Decision

1. `ChatManager.send` marks a message as relayed when it is a resume, has a sender (`from`), or its source is not the
   owner (`ownerSource`: the PC or the paired phone). A chat's first prompt is relayed when an agent or the app
   created the chat, and when it is a «Continua» note (`continueChat`), written by the app even on the user's click.
2. `deliverNow` sends a relayed message to a Claude engine wholly inside
   `<agent-message from="second-brain">\n…\n</agent-message>` (`chats/agent-message.ts`): the role text, app notes and
   hints included, because the hook matches the prompt end to end. The app's own quiet turns (hand-off notes) get it
   too. A slash command never does (the Orchestrator's `/compact`): Claude Code runs it only at the prompt's start.
3. The owner's typed text goes as before, untouched; other engines get no envelope.
4. The history read back from a Claude transcript shows the message without the envelope.

## Consequences

- AI-DLC logs app and agent messages as `Origin: host` (template «claude agent message»); the owner's turns stay his.
- A Claude engine sees a clear boundary between the owner's words and the app's; the text inside is unchanged.
- Images still go beside the text; an image-only relayed message is an empty envelope.
