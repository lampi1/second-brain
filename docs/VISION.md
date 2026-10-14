# Vision

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

second-brain is meant to become the one place where a developer who works with several AI agents at once does their
day: every chat, every question an agent asks, every browser it drives, every ticket and pull request it touches, and
the notes that make the agents better each week. The official CLIs do the thinking; the app does the orchestration,
the attention management and the memory.

## Principles

- **One cockpit, many harnesses.** Claude Code and Cursor chats run inside the app through their official CLIs, each
  with the user's own login. The desktop apps can stay closed, or keep working side by side: the app never changes
  their settings and resumes an external session only as a fork.
- **Attention is the scarce resource.** Agents wait on people far more than people wait on agents. Questions and
  permissions surface as panels wherever the user is looking, a Regia (a coordinating chat) decides what comes next,
  and notifications fire only when there is something to do.
- **Chat management is a core strength, not a thin layer.** Layout (Mosaico, Corsie), stop, costs, estimates, model
  routing and the link with the brain get the same care as the brain itself. View state, tile behaviours and key
  bindings are data, so the user and the AI can reshape them live (ADR 0008).
- **The brain is data, the app is product.** The app points to a brain folder: plain Markdown files and small Node
  tools that the agents read and write (open threads, journal, ideas, errors and the rules learned from them). A new
  user starts from an empty template that fills up by use.
- **Measured, not claimed.** Costs, estimates and quality metrics come from real logs with their source and dates on
  screen; an agent says "done" only after it has looked at the result.
- **Safe by default.** Electron's security baseline, a local-only MCP server, no credentials handled by the app, no
  production access wired in.

## Built today

Chats as tiles with streaming, tools and diffs; questions and permissions as panels with their context; one or more
Regie; mail between chats; long chats handed off before the context fills; code blocks run with one click and their
result sent back; internal browser tabs driven by agents over MCP, with sign-in hand-offs to the user; the brain's
pages (today, to-do, ideas, explore, a live 3D map), costs, budgets and estimates; a DevOps page (pull requests, work
items, QA status, alerts); quality metrics; full-text search; per-task model routing; and "Migliora l'app", where the
app's own Regia improves the app on branches and the user promotes a tested build.

## Horizon (designed for, not built yet)

- **Team platform**: live chat between colleagues, handing a to-do to a colleague, a shared team layer (runbooks, QA
  rules, code standards) separate from each person's brain. Every record already has an id and can get an owner, so a
  second user can appear without a rewrite. No server and no cloud until it is needed.
- **More connectors**: each integration is a module behind one interface (browser first, Azure DevOps next).
- **Beyond Windows**: the app is Electron and most of it is portable; Windows is where it is tested today.
