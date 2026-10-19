# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com)
and the project uses [Semantic Versioning](https://semver.org) once it reaches 1.0.

## [Unreleased]

### Changed
- Classifiers: a bilingual (IT/EN) work lexicon for agent matching and the routing kind (a fresh brain no longer
  routes everything as "altro"); per-channel agent thresholds; a threshold calibrated on confirmed runs is proposed
  in "Da approvare" and applies only on the user's click (ADR 0074). The Guida card explains each classifier.
- CLI login readiness selects available engines for new chats and untouched starter agents. Codex is available on
  fresh installs without extra engine switches; explicit disabled settings remain disabled.
- App-area chats support every enabled engine. Codex and Cursor pre-approve the same app-control and mail tools as
  Claude, without extending approval to browser actions or unrelated MCP servers.
- The Grindhouse (home, Ctrl+1) is the one place for the agents: a strip each, in the Orchestrator's order, the
  browser it drives right under it; the Chat page and its Mosaico and Corsie views are retired, old links still work
  (ADR 0068). One Orchestrator column stays open beside every page.
- Top bar: the full-screen popups switch and the connectors (GitHub, Jira) with their status are one click away; the
  "Nuova chat" button is gone (Nuovo agente in the Grindhouse, Ctrl+N or Ctrl+K start one).
- Pages fade in on every change and progress bars move smoothly, both off under reduced motion.

### Added
- Settings → Aggiornamenti: what is new on GitHub, and an "Aggiorna" button that downloads it, rebuilds and restarts
  the app on it at once, without the test suite (ADR 0075).
- "Aggiornati": ask the Orchestrator and it brings a developer's clone to the latest `main` from GitHub
  (fast-forward only, dependencies reinstalled only when the lockfile changed, then a build); `npm run pull` does the
  same from a terminal (ADR 0074).
- `npm run release:draft -- v<version>` makes the verified draft release from the maintainer's Windows PC, with
  GitHub Actions off (ADR 0074). The README lists every version with its installer and source downloads.
- Texts for colleagues (blocks tagged md, mail, teams, comment) show formatted in the chat, and Copia copies them
  formatted: bold, lists and links survive a paste into Outlook, Teams or DevOps (ADR 0043).

## [0.1.0] - 2026-10-13

First public version.

### Known limitations
- Codex cost and budget reporting is unavailable; Cursor agent-run costs and budget coverage remain incomplete.
- Codex receives brain instructions and skills, but the brain's lifecycle hooks are not installed for Codex.

### Added
- Developer experience: `npm run demo` (the whole UI on fictional data with a sample brain),
  `npm run shots` (README screenshots from the frozen demo), README, CONTRIBUTING, issue and pull request templates.
- Claude Code (stream-json) and Cursor (ACP) chats as tiles, with streaming text, tool calls, diffs, cost and context
  size; Mosaico and Corsie views.
- Questions and permissions as panels with their context, in the tile or in a floating layer; one or more Regie
  (coordinating chats) in a widget docked bottom-right; mail between chats.
- Internal browser tabs driven by agents over a local MCP server, with trusted input, environments, persistent logins
  and hand-offs to the user.
- The brain: pages (today, to-do, ideas, explore), a live 3D map, costs, budgets, estimates and the Qualità metrics.
- DevOps page: pull requests, reviews, work items, QA status of each pull request, alerts.
- "Esegui" for shell blocks, long-chat hand-offs, model routing, full-text search (Ctrl+K).
- "Migliora l'app": the app's own Regia works on branches; promotion to a stable release and rollback.
- App-control MCP server for agents (state, screenshots, driving the UI).
