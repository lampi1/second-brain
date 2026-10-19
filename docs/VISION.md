# Vision

## North star (2026-10-17)

second-brain must become **the new enterprise standard for agentic software development**: **simple and accessible
to non-technical people**, yet **highly performant and customizable for every company role** (developer, QA, product
owner, CTO, and the others). The owner's words: "a me interessa soprattutto la visione agentica di quest'app, deve
essere il nuovo standard enterprise per lo sviluppo agentico, semplice accessibile anche a non tecnici ma molto
performante e customizzabile per ogni ruolo aziendale dev QA po cto ecc ecc".

What this means for every change:

- **Agent-first.** The unit of the product is the agent: who it is (real name and icon, never a generic "Agente" or
  "Titolare"), what it is good for, which model it runs, what it costs and how long it takes. Model choice and
  behaviour live in the agent's profile, not in global switches.
- **Role-first.** A role (dev, QA, PO, CTO, ...) is a ready-made set of agents, pages and defaults that a person can
  adapt by talking to the AI. Adapting the app to its user is the product's real power.
- **Simple by default, deep on demand.** A non-technical person sees only essential controls. Settings are a few groups
  (accounts and tools, workspace, appearance and language, notifications); technical detail appears in context, only
  when it is needed. Minimal, professional, well-proportioned UI; smooth, short animations.
- **Enterprise-grade.** Safe by default, permissions never widened silently, every number with its source
  (real, estimate or quota), no gamification: only useful, truthful statistics. Errors, ideas and feedback show the
  agent and the **model that produced them**; history without that data shows "not available", never a guess.
- **Changeable by anyone.** The code is modular enough that a cheap model, guided by a non-developer, can change it
  safely; instructions for agents are short and fast to verify.
- **Self-improving, reversibly.** The app learns from feedback and outcomes, but never rewrites its own rules or
  permissions without the user.

## North star (2026-10-13)

An **agent orchestrator for building software by modern agent-engineering standards**, and a **harness for employees
and freelancers** that is simple, fluid and **cheap in tokens**: many small optimizations that never cost quality, and
no LLM call wherever a script, a tool or the app's own data can do the job. The owner's words: "è importante che questa app
sia un orchestratore di agenti per sviluppare secondo gli standard moderni di agent engineering e un harness per
dipendenti e lavoratori autonomi semplice, fluida ed economica in quanto token, con tante piccole ottimizzazioni che non
fanno perdere qualità ma non usano LLM quando possibile".

How to apply it: before adding a step an agent does by hand (read files, list chats/PRs/builds, format a status, compute
a date or a cost, grep logs, check a state), make it a script with `--json` or an app MCP tool, and measure the saving
(`ops/tools/cost.mjs`, transcripts). First round: `docs/zero-token-audit.md`.

## What it is

second-brain is meant to become the one place where people who work with several AI agents at once do their day:
every chat, every question an agent asks, every browser it drives, every ticket and pull request it touches, and the
notes that make the agents better each week. The official CLIs do the thinking; the app does the orchestration, the
attention management and the memory.

## Principles

- **One cockpit, many harnesses.** Claude Code, Codex and Cursor chats run inside the app through their official CLIs,
  each with the user's own login. The desktop apps can stay closed, or keep working side by side: the app never changes
  their settings and resumes an external session only as a fork.
- **Attention is the scarce resource.** Agents wait on people far more than people wait on agents. Questions and
  permissions surface as panels wherever the user is looking, a Regia (a coordinating chat, always at the top, full
  width) decides what comes next, and notifications fire only when there is something to do.
- **Chat management is a core strength, not a thin layer.** Chats are compact strips, collapsed by default, with
  reliable estimates, expanding on one click, every time. Stop, costs, estimates, the choice of agent and the link with the brain get the
  same care as the brain itself. View state, tile behaviours and key bindings are data, so the user and the AI can
  reshape them live (ADR 0008). Visual templates change without rebuilding features.
- **The brain is data, the app is product.** The app points to a brain folder: plain Markdown files and small Node
  tools that the agents read and write (open threads, journal, ideas, errors and the rules learned from them), organized
  by industry standards for agent memory. A new user starts from an empty template that fills up by use.
- **Measured, not claimed.** Costs, estimates and quality metrics come from real logs with their source and dates on
  screen; an agent says "done" only after it has looked at the result.
- **Safe by default.** Electron's security baseline, a local-only MCP server, no credentials handled by the app, no
  production access wired in.

## The agent's UX: the beating heart (2026-10-15)

Besides an orchestrator, the app is **the user interface of the agent itself**, and this is its most innovative part.
The owner's words: "quest'app oltre ad essere di orchestrazione è anche una perfetta UX di agente, è questo anche il
suo cuore pulsante e innovativo".

The principle: the app sees the agent's flow live (Claude's stream-json, Codex, Cursor's ACP): its reasoning, its tool
calls, its questions, its permission requests. So the user should act **with direct gestures on that live flow**, not
only type into a text-only chat. The goal is ways of working with an agent that the vendors' own apps do not offer yet.

First steps, already built: an agent's questions open as a panel in front of everything, with their options;
permission requests are panels with their context, answered where the user is looking.

Open ideas (not decided):

- **Correct the reasoning**: select a sentence of the agent's thinking and fix it in place.
- **Point with the finger**: show the agent an element in the internal browser instead of describing it.
- **Rewind**: go back to a point of the chat and continue from there in a copy, the original untouched.
- **A draggable plan**: reorder, drop or add the agent's steps by dragging them.
- **Permissions by gesture**: allow or deny with a gesture instead of a dialog.
- **Agents created with the AI**: the user describes a need, the AI proposes a few genuinely useful agents with the
  reason for each (never a hundred characters), and the context window is chosen at creation.

## Built today

Chats as tiles with streaming, tools and diffs; questions and permissions as panels with their context; one or more
Regie; mail between chats; finished workers that close by themselves once they reported (and say what they wait for
when they cannot); long chats handed off before the context fills; code blocks run with one click and their
result sent back; internal browser tabs driven by agents over MCP, with sign-in hand-offs to the user; the brain's
pages (to-do, ideas, explore, a live map), costs, budgets and estimates; a DevOps page (pull requests, work items, QA
status, alerts); quality metrics; full-text search; agent-first delegation (the Orchestrator or the local classifier picks a catalog
agent, whose profile sets engine, model, effort and maximum context; workers start catalog sub-agents; the routing
table only fills a model a profile leaves open, ADR 0078); and "Migliora l'app", where the app's own
Regia improves the app on branches and the user promotes a tested build.

## Horizon (designed for, not built yet)

- **Role profiles**: dev, QA, PO, CTO and more, each a starting set of agents, pages and defaults.
- **Team platform**: live chat between colleagues, handing a to-do to a colleague, a shared team layer (runbooks, QA
  rules, code standards) separate from each person's brain. Every record already has an id and can get an owner, so a
  second user can appear without a rewrite. No server and no cloud until it is needed.
- **More connectors**: each integration is a module behind one interface (browser first, Azure DevOps next).
- **Beyond Windows**: the app is Electron and most of it is portable; Windows is where it is tested today.
