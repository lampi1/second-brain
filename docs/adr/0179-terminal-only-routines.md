<!-- The sole routine executor is the terminal CLI; the app observes explicitly opened runs. -->
# ADR 0179: terminal-only routines, demand-driven app observation

Date: 2026-10-28. Status: accepted. Supersedes the app-execution portions of ADRs 0155, 0156, 0158–0162, 0164–0170 and 0175–0177 (not 0157, voice, or 0163, renderer budgets).

The app's retired flows host still advanced and settled historical runs, including cancelled runs whose DevOps writes
had unknown outcomes. Its five-second loop and repeated full-state copies also contributed unnecessary main-process
work. The owner requires the app to do no routine work on its own.

`packages/routine-runtime` is the only executor. Its `run`, `watch`, `resume`, packages, triggers, test databases,
DevOps writes and escalation retain their existing behavior. The app does not launch the CLI, run a trigger, retry,
cancel, settle, reconcile or clean up a run. There is no replacement scheduler or migration daemon.

Delete the old flows host, automation service, workers, execution adapters, app-flow tools, approval/recovery panels,
component/workbench execution system and routine browser authority. Keep package authoring, preflight, explicit
import/export/credential entry and explicit conversion of legacy definitions. These prepare files for the terminal;
they never run them. Orchestrator and role prompts state this boundary, and generic recaps never inspect routines.

Construction performs no routine I/O. Opening Routine reads its catalog/history; an explicit `app_routine_status`
reads the requested catalog, run or legacy archive once. Only an open run view owns a nonrecursive `fs.watch` of its
root journals (`run.json`, `events.jsonl`, `report.md`). Closing/changing the page, renderer navigation/crash or window
closure closes the watcher and aborts pending reader work. No routine timers, polling or startup scans exist.

The observer reads files asynchronously, incrementally consumes events (including incomplete UTF-8 writes), and
keeps all semantic events/screenshots plus the latest 200 actions; the original full journal remains accessible.
Screenshots load when visible, enlarge in the file viewer, and named before/after files form pairs. Evidence,
reports and history use the same read-only view. Run paths and screenshot/evidence symlinks stay inside the run.

Legacy `flows/<brain-key>/state.json` and automation files remain byte-for-byte intact. An explicitly opened archive
shows their recorded statuses, receipts and errors; pending reconciliation and cleanup fields are historical evidence,
not executable requests. No disposition or external outcome is fabricated. Archived routine chats cannot restart.
