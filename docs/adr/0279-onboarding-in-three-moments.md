# ADR 0279 · Onboarding in three moments: language and name, your AI, the first real request

Date: 2026-11-13 · Status: accepted (owner, 2026-11-13, report «Verso la 1.0», section «Onboarding»: «Approvo tutte
le tue modifiche del report») · Supersedes: ADR 0119's six steps (its tool catalog, token vault and Settings →
Avanzate form stay) · Builds on: ADR 0072 (clean install = point zero), ADR 0275 (the Orchestrator is the app's master)

## Context
The first-run setup asked six things in a row: language, AI, tools, about you, folders, ready. A person who arrives
from an advert saw four forms before seeing the product do anything, and the product itself (the Orchestrator and its
team) appeared only after the window closed, in a separate «guide» chat. The owner wants the 1.0 to show its core
first: an agentic orchestration over the person's own AI tools, with a brain that starts empty.

## Decision
- **Three moments in the same modal** (`SETUP_STEPS`: `welcome`, `ai`, `first`). Nothing in it closes the modal: a
  sign-in opens in its own window and the setup waits in place.
- **Welcome**: the language (three buttons, the system one preselected, switching at once) and the name on one screen.
  Role, kind of work and reply style are no longer asked (Settings → Il mio profilo keeps them).
- **Your AI**: the app looks by itself for Claude Code, Codex, Cursor and OpenCode (`cli:status`, no tokens) and lists
  what it found, one row each. An engine already signed in is put in use with no click (`autoEngines`), the proposed
  one first; a row's radio makes it the Orchestrator's. «Accedi» opens the official sign-in and the row turns
  «già connesso» by itself. The engines not found share one line. Without any AI, «Continua senza AI» ends the setup.
- **The workspace is prepared with no questions** when the second moment is left: a new empty brain in the default
  place when none is connected, the projects folder saved when the app finds it by itself, the chosen engines turned
  on (the first is `orchestratorChats.harness`, issue #96), name and chat language written into me.md. The setup is
  saved `completed` at that point, so closing the app during the third moment loses nothing.
- **The first request happens inside the setup.** The right half of the modal shows a fixed, labelled preview of the
  team at work during the first two moments; in the third it is the real Orchestrator chat (`orchestrator:ensure`,
  the store's items, `send`). A role of the team lights up while a chat delegated to it works. Three example requests
  fill the input; none is sent by itself, so the setup never spends tokens without the person's Enter. A question or
  permission raised by the first request is answered in the app («Rispondi nell'app»), not in the modal.
- **Tools, folders, goals and team are not asked.** The Orchestrator proposes them the first time they are needed,
  with the tools it already has (`app_config` for connectors and settings, `app_ui`). The «guide» chat and its brief
  are no longer started; `guidePrompt` stays only to hide the brief in guide chats that already exist.
- The tool catalog leaves the setup and stays in Settings → Connettori; the folders step is removed (Settings → Il mio
  spazio changes the brain and the projects folder).

## Consequences
- A draft saved by the six-step wizard resumes on «your AI» at the latest (`LAST_RESUMABLE`), never inside the first
  request: the workspace is always prepared by an explicit click.
- A setup repeated from Settings never turns an engine off and never changes the engine of an Orchestrator that
  already runs; only a first run states every engine.
- OpenCode joins the setup's engines (`setup:save` accepts it; a brain created with it gets no harness notes). Its sign-in check may answer «cannot tell»: the row then says so and can still
  be chosen.
- e2e `setup-onboarding.spec.ts` covers the three moments on a fresh profile with the fake Claude CLI; the specs
  `setup-simple`, `setup-modal` and `setup-wizard` (six steps) are removed, and the connectors spec no longer opens
  the tiles from the setup.
- Not tried on a real model: how well the Orchestrator proposes a connector or a folder on a first request that needs
  one. That is prompt behaviour of the engine, not of this window.
