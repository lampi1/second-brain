# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com)
and the project uses [Semantic Versioning](https://semver.org) once it reaches 1.0.

## [Unreleased]

## [0.1.0] - 2026-10-13

First public version.

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
