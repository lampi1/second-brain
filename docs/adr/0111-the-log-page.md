# ADR 0111 · One Log page for everything the app does; trees close as one

Date: 2026-10-21 · Status: accepted (owner, 2026-10-21: «chiama pure la sezione Log e non diagnostica», «togli pure la
changelog», «in una chat ad albero dopo 2 minuti che hanno finito tutti») · Builds on: ADR 0076 (brain changelog),
ADR 0084 (finished workers close by themselves), ADR 0109 (evidence) · Amends: ADR 0076 (the Changelog page is gone)

## Context
The owner could not see why a task went the way it did: which role the Orchestrator chose and why, what each agent
spent and which tools failed, whether the result was checked. The pieces existed in many places (technical log files,
the brain feed, run records, the changelog page) and none read like a story. He asked for one readable page, live, that
shows every automatic step too (classifiers, estimates, errors and memory written to the brain, Battito), that costs no
tokens to read and that cleans itself.

## Decision
- **One journal** (`main/activity/journal.ts`): readable events (`shared/activity-log.ts` `LogEvent`), one JSON line
  each in `userData/activity/log-YYYY-MM-DD.jsonl`, the last 3000 in memory, pushed to the window in 250 ms batches
  (`log:events`) and read with `log:list`. It cleans itself at start and every hour: 7 days, 20 MB in all (oldest days
  first, today stays), 2000 characters per field. Secrets are redacted like the technical log.
- **No module rewrites.** `Emitter.tap` lets `activity/wiring.ts` see the events already sent to the window: the chats
  (`chat-watch.ts`: opened with who chose the role and why plus the routing pick and the skills; each turn's cost, time,
  tools, tool errors, input and answer; requests and who closed them; result, review, verdict, close), the brain feed
  (errors, notes, role changes) and the technical log's warnings and errors (`log.onWrite`, one line a minute at most).
  Memory facts come from `memory/records.json`, read when its time changes (the CLI writes it outside the app). Three
  places record directly: the estimate under a request and `task_estimate` (the keyword classifier's kind and the
  figures), `send_to_chat` to an Orchestrator (the mail classifier's class) and Battito's runs.
- **The page** (`components/LogPage.tsx`, under App, G N): each task as a chain on the left, the live stream on the
  right, filters by kind, search, a side panel with input, result, errors and tools. Automatic flags are plain rules
  (`lib/log-view.ts`): the same reply twice, a permission closed without the user's answer («approvazione nascosta»),
  a review that ended without a verdict. A task with a result and no verdict ends with «Verifica: non effettuata».
  The only AI action, «Fai analizzare all'AI», puts a draft in the Orchestrator's input; nothing is sent by the app.
- **The Changelog page is gone.** `changelog.md` stays the brain's record (ADR 0076); its lines show in the Log as
  «Brain» events, and «Storico e ripristino» leads to the page that restores that kind of change. Old links
  (`changelog`, `diagnostica`) open the Log.
- **A delegation tree closes as one.** `ChatManager.autoCloseCandidates` holds a finished chat while another open chat
  of its tree is not ready, and gives every chat of the tree the tree's last activity, which never goes back when a
  member closes first. The delay and the 2-minute notice are ADR 0084's.
- **Close from the sidebar**: the ✕ on a tree row closes the chat like its strip's ✕ (6 s Annulla).

## Consequences
- The journal sees what the app sees: work a CLI does outside the app is not in it.
- «Approvazione nascosta» flags only a permission closed while its chat went on without the user's answer: one that ended
  with the user's Stop, close or archive, or with its chat, reads «chiuso insieme alla chat» and is not flagged.
- A finished chat waits only for the members of its tree still at work: one that ended with an error, a Stop or no
  result does not hold the others. One day's file stops at 10 MB (one marker line, then memory only).
- A child that finished long ago now stays open while its parent works; it closes with the tree.
