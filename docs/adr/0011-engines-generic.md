# ADR 0011 · Any engine: one adapter interface, Claude and Cursor are only the first two

Date: 2026-10-11 · Status: accepted

## Context
The user: "rendi l'app veramente versatile per ogni cli anche codex e anche api personali facili da mettere e far usare,
tipo JEV e tutte le classificazioni in futuro vorrei portarlo facilmente". The app is a cockpit for any AI engine, not
"an app for Claude and Cursor".

## Decision
- **Conversational engines** implement `HarnessSession` + `SessionSink` (`src/main/chats/session.ts`): start, send,
  answer (question / permission), interrupt, close; they report items, pending requests, state, cost (`costKnown`), and
  exit. Claude Code (stream-json control protocol) and Cursor CLI (ACP) are the first two adapters. Adding one = an
  adapter file in `src/main/chats/` + an entry in the engines settings (on/off, path, default model, budget). Any
  ACP-speaking CLI can reuse the ACP adapter with a different command.
- **Classifier engines** (a second kind, e.g. small classification-only models such as Jev): one method
  `classify(input, labels) → { label, confidence, costUsd, ms }`, used for small repeated jobs at near-zero cost (which
  chat a message belongs to, kind and urgency of a notification, category of an error or idea, DevOps triage). Always
  with a fallback to a conversational engine and an accuracy measure on the user's own data before it decides anything.
- **API engines** (OpenAI- and Anthropic-compatible HTTP): URL + key + model; the key stored only through Electron
  safeStorage (DPAPI on Windows), never in plain files or logs.
- Each engine spends only its own credits; crossing engines only where the user switched it on (messages between chats,
  the model comparison).

## Consequences
- README and UI speak of "motori" (engines), with Claude and Cursor as built-in examples.
- Backlog (top): Codex CLI adapter; generic API adapter with an "Aggiungi motore" screen in 3 fields; classifier engines;
  then Gemini CLI, OpenCode and other CLIs.
