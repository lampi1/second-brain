# ADR 0004 · The brain is a folder the app points to; the product never contains personal data

Date: 2026-10-11 · Status: accepted

## Context
The user's brain (the brain folder) holds personal and work data (now.md, journal, errors, runbooks, customers). Colleagues
will get the app with "il mio cervello personale ma vuoto" that fills with use.

## Decision
- `config.json` (app userData) holds `brainRoot`; nothing personal is hard-coded in the product (no paths, names,
  customers).
- Brain reading goes through adapters in `src/main/brain/` (parsers of the brain's files and its read-only tools such
  as `harness/cursor/chats.mjs`); today they reuse the brain folder's scripts, run with Electron as Node
  (`ELECTRON_RUN_AS_NODE` for that child only). Phase 5 moves the generic tools into the product and ships an empty
  brain template.
- A release check (phase 5) scans the package for personal data and secrets before every build.

## Consequences
- The app works with no brain (first-run setup asks for one) and with any brain that has the same structure.
