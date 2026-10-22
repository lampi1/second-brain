# ADR 0124 · Saved queries next to scripts, and the ideas scattered in the notes move to ideas.md

Date: 2026-10-22 · Status: accepted (owner: Memoria becomes the hub, «Script & Query» one of its tabs; ideas "sue e
dell'IA" in one place) · Builds on: ADR 0076 (scripts), ADR 0077 (ChangeLog and Annulla), ADR 0116 (the generic upgrade)

## Context
Queries someone reruns (SQL, KQL / Kusto, GraphQL, PromQL, Splunk SPL…) had no place: an SQL block in a note went to
scripts/ by the ADR 0116 upgrade, the others stayed in the notes. Ideas were written anywhere ("Idea: …", "💡", an
"## Idee" section) and the Idee page only reads ideas.md.

## Decision
- **A `queries` layout entry** (`queries/`, page `memoria`, the hub's Script & Query tab): it receives fenced code blocks
  of the query languages (`QUERY_LANGUAGES`, at least 2 lines). `sql` leaves the scripts entry: its `holds` says queries
  live in queries/. Scripts already moved to scripts/*.sql by an earlier pass stay there (the Script page lists them).
- **A query is one Markdown note** (`main/brain/queries.ts queryNote`): `# title`, one sentence, `- **Runs on:**`,
  `- **Tags:**`, `- **From:**`, then the query in one fenced block, byte for byte (a fence longer than any inside it).
  Markdown, not native files with a comment header, because SPL and GraphQL have no line comment, one format reads well
  in the file viewer and copies cleanly; native .sql/.kql/.graphql/… files dropped there by hand show too (`@title`,
  `@description`, `@source`, `@tags` comments). Reads mask credentials, a save holding one is refused.
- **A second `receives` kind, `marked-items`** (markers and heading names, written with `append-items`), handled by the
  same generic job: the local scan (code blocks, HTML comments, ops/, the brain's guides and every layout place are not
  read; an item that may hold a credential is skipped), one agent answer per batch (keep, title, area, author `user` or
  `ai`), entries appended on top of the place's file and a pointer `→ \`ideas.md\` (title)` where each was, one ChangeLog
  entry, Annulla, never twice. The `ideas` entry uses it. A moved idea keeps the brain's format: the owner's has
  `Fonte: nota \`x.md\` (heading), spostata il <day>` and an Event origin of kind human (source `brain-upgrade`); the
  AI's has `Fonte: IA · nota x.md · …` (the Idee page shows it as the AI's) and no origin (never invented). Its day is
  one written in the item or its heading, else the note's last change. An idea with a title already in ideas.md is not
  added twice.
- **A candidate whose note changed while the agent was reading** now keeps its entry pending (before, the hash was
  recorded and the candidate never came back).
- **Service and UI**: `BrainQueries` (list, get, add, delete) with typed IPC `queries:list|get|delete`; a delete is a
  ChangeLog entry (job `user`), undone with `brainmodel:rollback` from the toast. The renderer's `QueriesTab` has the
  Script page's look. Agents: `brain_queries` (read) and `brain_query_add` (add only) on every chat's endpoint, beside
  the script tools, no approval card (the app's own endpoint asks no permission); Flash does not get the add tool; the
  Orchestrator's rules say queries live in queries/.

## Consequences
Every existing brain gets both migrations from the layout alone (two entries' hashes change or appear). A future kind of
scattered content is a layout entry with markers, not code.
