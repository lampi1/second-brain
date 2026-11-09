# Load-sensitive unit tests removed on 2026-11-09

What: every unit test removed by the owner's rule of 2026-11-09 («never write load-sensitive tests; existing ones are
removed», `docs/agents/rules.md` §7), and the coverage that left with them. Why: on the owner's busy PC these tests
turned a branch's gate red without a bug, which stops agents from merging on their own. Who uses it: an agent that
touches one of these areas writes a deterministic test for it (fake timers, in-process fakes, events), never the old one
back.

How they were found: a script over every `it`/`test` (TypeScript AST) flagged a real deadline (`waitFor` with ms,
`vi.waitFor`/`expect.poll` and their 1 s default, the local `until`/`sentAfter`/phone `waitFor` helpers, bounded polling
loops, a per-test or per-describe timeout under the suite's 120 s), or an assertion on elapsed time; a manual pass added
the tests whose sleep waits for work to happen and then asserts it happened. Sleeps before a check that something did
NOT happen stay (load cannot turn them red). The `afterEach` hooks that shut fake engines down get the suite's 120 s
(`hookTimeout`), like the tests: their 10 s default was the red of `admission.test.ts:204` and
`orchestrator-codex.test.ts:18`.

Second pass, same day, by the owner's decision («Sì, toglili tutti»): every unit test that starts a real process
(fake engine CLIs included), git, a port, a socket or the network, with or without a clock of its own. They were found
by running the whole unit suite with a probe that records every `child_process` call, `listen` and `connect` per test,
plus the Windows-only tests (skipped on Linux, so the probe could not see them) and the suites that start a server or a
build in `beforeAll`: 464 tests in 83 files. Their list is under «Second pass» at the end.

## Unique coverage lost

No other unit test covers these any more (checked by area, not line by line):

- **Delegation results** (`agents/delegation.test.ts`, 18): child results batched while siblings work and the 2 s / 5 s
  debounce (ADR 0224), report corrections (`amends`, max 2), the report reminder then the blocked close, a child whose
  engine died, a changed goal, the synthesize policy, and the outbox across a restart or a failed submit.
- **Resume after a restart** (`chats/resume.test.ts`, whole file): a cut turn resumes by itself, only within
  `engineIdleMin` (ADR 0228), queued turns resume, a hand-off turn does not, a failed resume. Stage 5 rewrites this.
- **Run receipts through ChatManager** (`chats/receipts-manager.test.ts`, whole file): a check after the change passes
  the run, a failing one fails it, unknown files without checkpoints (ADR 0130, 0186). `receipts.ts` keeps its pure tests.
- **Phone bridge** (`phone/bridge.test.ts`, 15): pairing, stranger attempts, /stop, /pausa, 409 back-off, token never in
  logs, start/stop races.
- **Cold notes** (`chats/cold.test.ts`, 8) and the Orchestrator's daily compaction (`orchestrator-day.test.ts`, 2).
- **Read-only headless runs** (`compare/headless.test.ts`, 14): plan mode, deny rules, web-only runs, Cursor's ask mode,
  the timed-out run killed with its tree.
- **Impara** (`learn-service`, `impara-tutor`, `impara-quiz-service`, `review`: 26): lesson flow, Spiegazione mode,
  Studio tiles, tutor, review cards.
- **Update and launcher** (`update-source.test.ts` 9, `release-launch.test.ts` 8): «Aggiorna» on dev and stable copies,
  pull, refused promotions, the launcher's fallbacks.
- **Connector onboarding transaction** (`src/modules/onboarding/onboarding.test.ts`, 10): preview, undo, rollback.
- **Routine browser** (`routine-runtime/browser-mcp.test.ts`, 11): real-browser login, password masking, origins,
  screenshots.
- **Brain release utilities** (`brain/rules-tools.test.ts`, 9) and the **push guard on real commits**
  (`brain/guard.test.ts`, 4).
- **Process cleanup** (`jobguard`, `proctree`, `cli`: 7): orphans, job objects, the bounded quit kill.
- **Engine restart on an ignored stop** (`chats/manager.test.ts`, 4), the checkpoint deadline (ADR 0228, 2), cold-start
  queue on restart (`admission.test.ts`, 1), warm engines in the MCP chain (3), mail `send_to_chat` delivery (1),
  `mcp-server` abort on disconnect (1), `delegation-isolation` successor base and staging (2).

- **Second pass: real processes, git, ports, network.** No unit test covers these any more:
  - the engine adapters against their fake CLIs: `ClaudeSession` (35), `CodexSession` (29), `AcpSession` for Cursor and
    OpenCode (63), wire replays of recorded runs (1), warm engines (8), Remote Control (6);
  - `ChatManager` with real fake engines: manager (29), admission (14), archive (8), handoff (8), checkpoints and their
    barrier (9), cold notes (1), close tree (1), engine priority (2), Orchestrator on Codex (2);
  - git work: worktree pool and worktrees (11), delegation isolation and reuse (12), review pack (1), brain sync (18),
    live and fresh brain (8), brain API (4), file diff and the file-diff review (10), pull (4);
  - the guard on real commits and pushes (pre-commit 9, pre-push 10, scanner 7), the correction-catch hook (6),
    publish and improve guards (2), agent-pack guard (3), check lock (3);
  - HTTP and sockets: the MCP server protocol (22), the API engine streams (15), MCP gateway and client (12), phone
    bridge and voice (18);
  - scripts run as children: release writer, launcher, gates and env (12), update restart (2), template first run (4),
    routine CLI build (1), setup-pc (2), doctor (1), ZIP extraction in PowerShell (6), the read worker built with
    esbuild (6), the coordination journal across two workers (1);
  - smaller ones: default brain (4), app connector entry (3), event origin (3), mem-run (2), CLI status (2), search
    gitignore fallback and missing root (4), and single tests in log, log digest, search recall, readme check,
    recurrence producer, voice download, estimates, usage, rules, rules tools, script metadata, engine text and chat
    feed security.

## Every removed test


### `src/modules/onboarding/onboarding.test.ts` (10)

- previews all three exact formats, waits for confirmation, persists a private journal and undoes exact existence/bytes
- does not overwrite an edit made after preview or undo
- rolls the first file back when publication of the second fails
- stops on conflicting names, malformed files, plaintext auth and unsupported syntax
- keeps Azure unsupported compatibility pending, and enforces policy again at apply
- performs no probe before confirmation and never equates saved config with a connection
- does not write any config if secure backup fails
- returns the committed operation and undo even when config verification reads fail
- resumes undo after a later target temporarily fails
- rechecks content after preparing the temporary publication file

### `test/unit/activity/journal.test.ts` (1)

- pushes new events in one batch

### `test/unit/agents/delegation-isolation.test.ts` (2)

- preserves the original delta when a host-authorized successor continues a committed child
- stages committed changes on the parent tip without moving main, running hooks or claiming tests passed

### `test/unit/agents/delegation.test.ts` (18)

- a Strategist launches a Scout and a Sentinel at once: two children under it, each with its contract only, and their results come back
- a child's result waits for its siblings at most childResultsMs, then goes alone
- a child corrects its result with amends: true, marked for the parent; a third correction is refused
- a root chat corrects its result: a marked notice for the Orchestrator, still no turn for a display delivery
- child results while siblings work: a short debounce, one entry per child, the newest wins
- a result that keeps being followed by siblings' still goes within the cap of the debounce
- root reports go to the Orchestrator for its tasks and remain local for user tasks (#93)
- a root chat's clean result goes to the quiet news when they take it; a partial one is also displayed without a model call
- is told once with the full tool name; a second turn without it closes the delegation and wakes the parent
- a child whose engine died with an error closes at once with its last answer
- a goal the user changed: the report says so, the card shows the user's goal and keeps the contract's
- a synthesize task policy waits for final turn end and submits once automatically
- a root correction reported while the first synthesis is submitting gets its own synthesis once that one went
- restored in-flight batch never acknowledges a concurrent child twice
- a restart never sends a result its correction replaced: only the newest of the child goes
- a correction reported while the first batch is inside its submit survives that batch's acknowledgment and a restart
- a batch whose submit fails after its result was corrected is not sent again: only the correction goes
- keeps a child outbox across CPU admission and a failed engine submission, then acknowledges the retry

### `test/unit/agents/judge-sample.test.ts` (1)

- claims the day on disk before the batch starts: a quit during it does not run it again at the next start

### `test/unit/brain/fresh-brain.test.ts` (2)

- boot rules, topic rules, agents, skills and hooks come from the app copy; the brain is not touched
- a brain file the owner writes wins over the app copy

### `test/unit/brain/guard.test.ts` (4)

- a clean commit passes
- a deny-list word blocks with file:line + rule, never the value; a domain's .guardallow and out/ do not hide it
- a domain .guardallow is never overwritten by a file named like its stand-in in another case
- two paths that differ only in case block the push (one would hide the other on this file system)

### `test/unit/brain/input-polling.test.ts` (2)

- does not consume input changes arriving while cost is being read or emit after shutdown
- keeps chat waiting transitions, expires old rows locally and retries incomplete lists

### `test/unit/brain/input-revision.test.ts` (3)

- is inert until queried, reuses unchanged inputs and detects append and atomic replacement
- detects creation of missing roots, then re-arms after root replacement
- ignores unrelated files, but invalidates for matching CSV changes

### `test/unit/brain/learn.test.ts` (1)

- runs the brain's improve.mjs, one click at a time, and reports its errors

### `test/unit/brain/live.test.ts` (3)

- baseline emits nothing, then a new AI idea and an error become events
- polls chats.mjs: the first list is a baseline, then in corso → aspetta te is a chat-waiting event
- a parser that throws once (file read mid-save) keeps the snapshot: old rows never come back as new

### `test/unit/brain/rules-tools.test.ts` (9)

- renders the release utilities per brain outside it, reused until the release or values change
- a copy Windows holds open (rename refused) is updated in place, not lost (issues #275, #278)
- a held file the in-place update cannot replace keeps the old marker, and the next call finishes the update
- without a stored TODAY the copy keeps one date (no re-render at midnight)
- a product text the release no longer ships leaves the copy and the plugin at the next render (no leftovers)
- a rendered tool serves the brain, not its own folder (brain-root.mjs)
- resolves app scripts: product template code → copy; personal scripts and legacy brains → the brain
- keeps the template hooks the product does not replace, pointed at the copy
- delivers product and template hooks with the launch switch off, unless the brain opted out

### `test/unit/brain/sync.test.ts` (1)

- a change made during a cycle is synced by a cycle of its own, not dropped

### `test/unit/brain/usage.test.ts` (1)

- the monitor runs the brain's cost.mjs, emits usage and spend, and ingests rate limits

### `test/unit/brainmodel/evaluation.test.ts` (2)

- keeps datasets and receipts in the selected brain and captures execution scope
- returns complete referenced output and reviewer reports, and rejects unreferenced or other-brain runs

### `test/unit/brainmodel/research-candidate.test.ts` (1)

- rejecting discards the candidate and its findings; a capped research skips the replay

### `test/unit/brainmodel/research.test.ts` (3)

- one click: the cleanup, then the research with the best choice; a second click is refused
- stops the chat when the cost passes the cap and ends on idle after work
- refuses a second start while the first is creating its chat, and replays what the chat did meanwhile

### `test/unit/chats/acp-opencode.test.ts` (3)

- a provider refusal only on stderr (free limit reached) ends the turn as failed with a readable error, never hangs
- OpenCode giving up after its retries ends the turn at once with its last error
- the user's stop during the wait after a stream error is a stop, never the provider's error

### `test/unit/chats/acp.test.ts` (2)

- noRetry: a turn cut by a network error is not retried (a failed hand-off), even when the retry is already planned
- Invia subito" while the retry waits sends the kept message now, without the retry

### `test/unit/chats/admission.test.ts` (1)

- chats cut by a restart resume through the queue, not all at once

### `test/unit/chats/agent-policy-manager.test.ts` (1)

- sets the engine back when it reports a mode above the ceiling on its own

### `test/unit/chats/auto-close-manager.test.ts` (2)

- does not replace a cold session when child activity arrives while its close awaits
- rechecks new pending after close awaits and never drops it or marks the chat archived

### `test/unit/chats/checkpoint-barrier.test.ts` (2)

- Claude: a snapshot given up after the deadline releases the write, and the undo never rewinds that turn wrongly
- Claude: the deadline counts from the send, the wait for a hung previous snapshot included

### `test/unit/chats/claude.test.ts` (1)

- an engine that exited while a leftover holds its pipes closes without a kill; a killed one gets no grace

### `test/unit/chats/cli.test.ts` (2)

- a bounded quit kill whose taskkill is too slow terminates the processes directly, their job children with them
- resolves within its time, the steps after the wait included: the ones it terminated go to after in one call

### `test/unit/chats/close-tree.test.ts` (1)

- a delegation that races the close never leaves a child at work: refused while closing, cancelled if already past its checks

### `test/unit/chats/cold.test.ts` (8)

- writes the note quietly, then a message after the cache expired goes on in a fresh session of the same chat
- a message while the cache is warm stays in the old session, and the Orchestrator and short chats are never asked
- a long chat whose last answer waits for its work is asked no note (2026-10-16); the next turn lifts it
- keeps the engine while its cold note is due and rejects the obsolete renderer auto-close path
- can save a note on partial observations but never releases or replaces that engine automatically
- a fresh session that does not start leaves the note for the next message
- a message queued behind the quiet note turn shows as work and ends as a normal turn
- counts the calls of the main thread from their usage, once per response

### `test/unit/chats/deferred-writes.test.ts` (4)

- writes a burst of changes once, asynchronously, after the delay
- a failed deferred write is tried again on its own, with no later change to trigger it
- AgentRunStore (agent-runs.json): a sync save with a prune during a deferred pruning write is not rolled back by it
- AgentRunStore (app.db): a sync save with a prune during a deferred save is not rolled back by it

### `test/unit/chats/fresh-sessions.test.ts` (2)

- refuses delegation when parent permission mode changes during worktree preparation
- refuses a child when its parent finishes during worktree preparation

### `test/unit/chats/handoff.test.ts` (1)

- a Cursor hand-off cut by a network error is not retried by itself (the app writes its own note)

### `test/unit/chats/jobguard.test.ts` (3)

- kills an orphan that outlived its parent, after listing it with its parent
- release leaves the job alive; the helper ending kills the jobs it still holds
- quit kills the jobs and boosts its process tree without PowerShell on PATH

### `test/unit/chats/linux-procs-list.test.ts` (1)

- does not shift process creation times when getconf finishes after the uptime sample

### `test/unit/chats/mail.test.ts` (2)

- holds before taking mail and retains a delivery reservation until send settles (failure=%s)
- send_to_chat: sender from its endpoint, delivered at once to a live chat; self, unknown and blocked refused

### `test/unit/chats/manager.test.ts` (4)

- restarts an ACP engine that ignores the stop and resumes its session for the next message
- «Invia subito» on an engine that ignores the stop: the queued message runs on the new engine
- a queued message that cannot be resent after the restart is said in the chat, never shown as sent
- a chat the user closes while its engine restarts gets no new engine and no resent message

### `test/unit/chats/orchestrator-cursor.test.ts` (2)

- gets the app tools and delegates role chats on both engines, each on its role's engine
- with cross-engine messaging off, role chats still start on both enabled engines

### `test/unit/chats/orchestrator-day.test.ts` (2)

- the next day a long Orchestrator compacts quietly in the same session; a work chat never
- nothing with the setting off

### `test/unit/chats/proctree.test.ts` (2)

- kills the child an exited process left running (the real list, the real taskkill)
- the host quit cleanup kills a terminated engine and its child (Windows reaper or POSIX process group)

### `test/unit/chats/receipts-manager.test.ts` (4)

- records the command with its exit code and the turn's files, and passes the run when the check ran after the change
- a failing check after the change fails the run
- without checkpoints a command that may write leaves the files unknown: no pass
- without checkpoints the edit rows give the files when only checks ran (ADR 0186)

### `test/unit/chats/resume.test.ts` (7)

- a turn cut by the quit resumes by itself on the next start, marked until the user writes
- a cut turn idle longer than engineIdleMin is not resumed: it sleeps, and the next message resumes its session (ADR 0228)
- a cut turn active within engineIdleMin still resumes by itself
- a queued turn cut by the quit resumes too (the first turn's result does not clear "working")
- a hand-off turn is no work to resume, a message queued behind it is
- a resume that fails drops the mark: the error shows alone
- a chat that had finished, or whose CLI died while the app ran, is not resumed

### `test/unit/chats/task-hint.test.ts` (2)

- a chat the Orchestrator opens with doneWhen gets the criteria as stored; a follow-up gets them again with its version
- the user's own follow-up shows once, without the version suffix; the engine still gets it

### `test/unit/chats/turn-watchdog.test.ts` (1)

- catches a real adapter stalled on a recording that never answers the turn

### `test/unit/compare/headless.test.ts` (14)

- gives back the whole list of accepted ids, not the 600-character cut of the exit error
- Claude: plan mode, read tools only, no MCP, no hooks, no transcript; Read allowed, Bash and questions refused
- Claude, a web run: only the web tools exist, every file tool denied, a read refused; never on another engine
- a warm start (Impara's tutor, ADR 0190): the engine starts first, the prompt goes in when it comes, the answer streams; unused, nothing is sent
- Claude: ExitPlanMode is refused with the request to answer as text
- Cursor: its "ask" mode, no allow rules in its config copy; reading allowed, editing and the shell refused, questions skipped
- a run past its time is killed, with its process tree
- an engine the user did not turn on, or not for agents, and a Fable model never start (a refusal, not a run error)
- an ACP engine without a read-only mode, or refusing it, is stopped before the prompt
- a run in a network folder never starts
- a missing folder, a model that looks like a flag and a crash end as failures
- the denied folders: deny rules for Claude and Cursor, a read there refused, a run inside one never started
- two Cursor runs at once each get their own config folder, with their own deny rules
- after killAll (app quit) no run starts

### `test/unit/e2e-workers.test.ts` (1)

- SB_E2E_WORKERS wins; a bad value is measured instead

### `test/unit/flow-devops-detector.test.ts` (1)

- cancels before auth, during uncooperative auth and during uncooperative requests

### `test/unit/flows/test-db-driver.test.ts` (1)

- aborts hanging queries by closing the rollback-only session

### `test/unit/impara-quiz-service.test.ts` (2)

- judges a true/false check by its option and keeps «Eri sicuro?» afterwards
- the user’s files become the material: one file read whole, listed in the sources

### `test/unit/impara-tutor.test.ts` (4)

- a question goes into the session started ahead; the answer streams, then is saved with a review card from a verified fact
- the prompt: the verified facts, the piece, the conversation; coach asks for a hint first, «Dimmelo e basta» for the answer
- in «Spiegazione» (ADR 0230) the tutor tells at once and leaves no review card
- no card when the answer cites no verified fact; a failed answer says why; a dead warm session is retried cold

### `test/unit/learn-service.test.ts` (18)

- starts a PR lesson: saved at once, the first pieces, then the rest in the background
- a topic: the web run sees only the ask and has only the web; the files run reads brain and guide; questions wait for the answers
- a PR with the web on: its public topics, filtered, searched at once in «Modalità notte» by a web run that sees only the ask and the queries
- the topics wait for the user: ✕ drops one (more time for the rest), «Cerca ora» starts them; none left = no search
- keeps only a teacher it offers; a removed lesson stops waiting for its answers
- a run that fails or writes nonsense leaves a sentence and «Riprova» starts it again; a failed research goes on
- a research that found nothing because its tools were refused is a failure the lesson shows, never a silent ready
- a topics web search that found nothing because its tools were refused is a failed phase too
- a research that read and found nothing, with no tool refused, stays a plain ready
- moves, judges a check at zero tokens (first answer stays), adds an extra after the piece
- grades «Spiegalo tu»; an empty one ends the lesson without a grade
- «Spiegazione» (ADR 0230), the default: no check, no review card, the last piece ends it; one question at most
- «Spiegazione» (ADR 0230): an extra asked on the recap finishes the lesson, one asked in the middle does not
- a lesson removed while it is being written leaves no folder behind
- a tile is one cheap run over the verified facts, saved with the lesson; flashcards go into the review
- the quiz plays as a review session; an answered question becomes a review card
- an explain lesson has the Studio too: its flashcards go into the review (the Studio-tile exception, ADR 0230)
- a tile that fails says why; one cut by a restart is marked failed; no verified fact, no Studio

### `test/unit/mcp-server.test.ts` (1)

- aborts a running tool when the client disconnects

### `test/unit/mcp-servers/chain.test.ts` (3)

- the warm engine spawned ahead is a plain chat while it launches, so it gets the managed servers
- a delegated chat leaves an engine launched as a child under the same chain; the next such child adopts it
- a delegated chat that adopts a waiting engine runs at its ceiling (the parent's mode), not the user's default above it

### `test/unit/phone/bridge.test.ts` (15)

- starts: addRedaction first, deleteWebhook, the start notice, then polling; the token never in logs
- pairing: only /start with the right code links the account; others stay silent
- a stranger guessing the code cannot burn it; the PC sees the attempts (review S6)
- foreign ids are dropped silently and counted
- text goes to the Orchestrator; the reply comes back condensed and filtered
- a decidable is offered with buttons; a press from the paired chat answers, a forged one does nothing
- 409 conflict → the conflict error, then back to running
- messages sent while the app was closed are asked back, not run
- /stop halts the bridge until it is re-enabled on the PC; the offset is kept
- /pausa silences everything but urgent
- start while starting: one client, one poll; stop while Telegram answers: no start notice, no polling
- a failed chat reaches the phone when away, never while at the PC
- repeated 409s back off longer each time and log the conflict once (review C1)
- after /stop the PC switch shows off; turning it on clears the stop (review C2)
- a stop that ends after a new start leaves the new loop running (review C3)

### `test/unit/release-launch.test.ts` (8)

- a superseded launcher cannot mark bad or overwrite a concurrent external activation
- invalid current metadata (%s) falls back to the previous release
- an unavailable current runtime falls back without crashing on spawn error
- starts the current release when its window reports ready
- the app starting reads this start in launch-result.json, never the record of an earlier start
- a release that exits without ready is marked bad and the previous one starts
- the app still quitting (its pid gone soon): waits, starts the same release again, never marks it bad
- the app already open (alive, not quitting): brought to the front at once, nothing marked bad, the previous one not started

### `test/unit/release-writer.test.ts` (1)

- applies the exact selection and permits only the matching conditional rollback

### `test/unit/review.test.ts` (2)

- a finished lesson gets a subject and verified cards; sessions, grades and subjects work; removing it takes them away
- cards and an extra both cut by a close: both freed on the next start, so «Riprova» makes the cards

### `test/unit/routine-runtime/browser-mcp.test.ts` (11)

- a navigate to the bare origin with no session is the login via ?mode=local, never the portal
- a step's first navigation logs in from the loginUrl first, then opens the page
- a landing on the portal login (another origin) logs in again via ?mode=local and returns to the page
- a wrong credential is a login error on the node, never a page left on the portal, with one screenshot of the emptied form
- logs in by itself (stored ?mode=local), lands where the agent asked, masks the password
- re-logs in after the session ended
- types text, refuses password fields, selects options
- stays inside the declared origins; a new tab elsewhere is blocked without ending the server
- saves a screenshot into the evidence folder and events.jsonl
- recognises Air's real login form (<input type=button> login button) in a real browser
- a second user: toggles a hidden checkbox, sets its password with fill_secret, logs in as it, next step is the default again

### `test/unit/routine-runtime/cli-build.test.ts` (1)

- runs a package from a clean folder with `claude` from PATH

### `test/unit/routine-runtime/demo.test.ts` (1)

- runs end to end from a clean folder through `routine run` (no app, no brain, fake DevOps)

### `test/unit/routine-runtime/review-loop.test.ts` (1)

- a run killed inside round 2 resumes in round 2, at the step it was in

### `test/unit/routine-runtime/runtime.test.ts` (2)

- a killed run resumes the same run at the failed step; the old attempt is fenced off
- a run waiting for a person, resumed after the answer came, reads it at once (no poll interval first); the older runtime stops

### `test/unit/routines/service.test.ts` (1)

- watches only an explicitly opened run and stops reads and events when the view closes

### `test/unit/runner.test.ts` (3)

- runs in PowerShell 5.1: output, UTF-8, exit code 0
- a failing native command gives its exit code; a failing cmdlet gives 1
- Ferma stops a long run

### `test/unit/sendable.test.ts` (2)

- while the chat works: no new turn; with a queued message it rides on it, else one line when it is free
- a note due while a message is on its way to main waits for its reply: a late idle never sends it ahead

### `test/unit/skills.test.ts` (1)

- runs a real hook with the Write input on stdin

### `test/unit/store-closed-items.test.ts` (1)

- starts by loading only the open chats' items

### `test/unit/sync.test.ts` (2)

- a new outcome file is published once; old files are not
- a failure already shown is not shown again after a restart; one that ended while the app was closed is

### `test/unit/update-source.test.ts` (9)

- main's tip is the candidate of a stable copy; nothing new when it is in use; a folder that is not this app says so
- pull (ADR 0074, the Orchestrator's app_update_code): runs scripts/pull.mjs --json, one at a time; a folder without it says how
- Aggiorna on a dev build (ADR 0075): the check counts, the pull relaunches, nothing new says so
- Aggiorna on a stable copy: pull, release.mjs promote-now, then the restart; a second click is refused
- Aggiorna on a stable copy refuses to promote a HEAD with commits origin/main does not have, or no origin/main
- a failed promotion changes nothing and never restarts
- Aggiorna without a code folder explains and does nothing
- inRepo: the code folder and its git worktrees, nothing else
- the start notice: read at construction, told once, dismissable; the old improve-seen.json marker is honored and renamed

Files left without tests and deleted: `test/unit/chats/orchestrator-cursor.test.ts`, `test/unit/chats/receipts-manager.test.ts`, `test/unit/chats/resume.test.ts`.

## Second pass: real processes, git, ports, network

### `src/modules/ai-first/default-brain.test.ts` (4)

- uses a physical fixture root when the OS temp directory is an alias
- allocates one fresh, empty memory for concurrent requests: no template file, project hooks or MCP
- retains a prepared memory without overriding a concurrent explicit folder selection
- the app-owned tools serve the empty memory: the brain map reads it without warnings

### `test/unit/agent-pack-guard.test.ts` (3)

- blocks private IP/email and does not expose their values
- allows example mail and refuses missing scanners, deny lists, or domain guards
- checks every domain deny list and never trusts a staged allow file

### `test/unit/agents/delegation-isolation.test.ts` (11)

- a child that cannot write (a Scout, a read-only Sentinel) works in its parent's folder: no worktree, no git run
- gives concurrent writers distinct worktrees at the same baseline and preserves project subfolders
- does not execute repository-configured filters or filesystem monitor commands in the host
- blocks partial/promisor lazy fetching before a missing blob can execute an external transport
- blocks inactive conditional includes before a new branch can activate filter scripts
- blocks dirty, non-Git and foreign sources without a shared writer fallback
- does not trust forged chat metadata, changed assignments or a restarted service
- persists only host-bound ownership across restart and refuses corrupt provenance
- combines parallel siblings in one union stage and keeps both pinned sources
- reports sibling overlaps and refuses custom merge drivers without executing them
- contains conflicts in the new staging worktree and blocks uncommitted child edits

### `test/unit/agents/delegation-reuse.test.ts` (1)

- reassigns an own child in a sibling worktree of the same real repository, never another repo or an unlisted folder

### `test/unit/agents/review-pack.test.ts` (1)

- names the branch, the base, the commits, the files and the diff

### `test/unit/agents/worktree-pool.test.ts` (9)

- reuses a free slot on a fresh guard-safe branch at the new HEAD, keeping its ignored build outputs
- never reuses a slot with changes, a commit of its own, an open chat or a lease
- cleanup removes the app's clean orphans beyond the limit, reports work, never touches the user's worktrees
- the timer only scans until the first manual cleanup, which it remembers
- a cleanup asked during a scan runs after it, and says what it removed (0 too)
- commits a local non-app branch holds are not "unpushed": the worktree goes, the commits stay on that branch
- a slot with a warm engine is taken by the next child but never removed by the cleanup
- a slot taken while a cleanup runs is not removed by it
- DelegateWorktrees takes pool slots; a reused slot blocks reopening its earlier child

### `test/unit/agents/worktrees.test.ts` (2)

- lists the repository's worktrees and lets a child work in one of them, never elsewhere
- ignores forged worktree entries: empty, prunable, missing, or of another repository

### `test/unit/app-connector-entry.test.ts` (3)

- serves no scripts/secrets and refuses cross-origin submission before a valid one-use save
- closes the browser handoff on explicit cancellation without saving
- settles an accepted vault save even when the browser disconnects before its response

### `test/unit/brain-template.test.ts` (1)

- every script parses

### `test/unit/brain/api.test.ts` (4)

- starts the brain's server in a child on a free port and proxies GET JSON
- warm() starts the child before the first request; without a server it does nothing
- a mounted path that answers undefined (e.g. the hybrid search not ready) is served by the brain server
- a broken server reports why, and a later request retries

### `test/unit/brain/brain-estimates.test.ts` (1)

- refresh runs estimates.mjs --update; a burst of turns schedules one run

### `test/unit/brain/cursor-ledger.test.ts` (1)

- appends one line per stop hook turn (uncached input = input − cache), one per -p result, and answers {}

### `test/unit/brain/estimates.test.ts` (1)

- a backfill never overrides app jobs

### `test/unit/brain/fresh-brain.test.ts` (4)

- holds only the profile, brain.json and the credentials .gitignore
- shows no skills, rules, memory or former runbooks on the brain pages
- the setup automatic memory is a fresh brain too, with an empty projects folder
- the automatic memory points REPOS at the owner's projects folder when the setup knows it

### `test/unit/brain/live.test.ts` (4)

- an idea state change is an update; a restart shows what changed while away
- quiet changes while away are not replayed
- ignores .git and worktree copies of the brain
- without the brain parsers it still starts (chats and mail only)

### `test/unit/brain/rules-tools.test.ts` (1)

- plans a reviewable legacy migration: frontmatter, references, code removal, activation; hooks kept by default

### `test/unit/brain/rules.test.ts` (2)

- migrates only reviewed preimages and retains old and new content through rollback
- auto-commit refuses remotes and staged changes instead of including unrelated work

### `test/unit/brain/script-input-metadata.test.ts` (2)

- real chat metadata preserves masked display rows, exact activity time and transient failure retries
- real cost summaries distinguish missing transcripts from an unreadable existing input

### `test/unit/brain/sync.test.ts` (18)

- a change on one PC is committed, guarded and pushed; the other PC pulls it
- a conflict stops that domain until the user chooses; nothing is resolved by itself; "both" writes the two versions
- "keep theirs" takes the other PC's lines and keeps this PC's other changes
- the guard blocks a push with file:line + rule, never the value; once removed the app's commits are squashed and nothing reaches the remote's history
- the user's own commits are never rewritten: the block stays until they fix their history
- no guard on this PC: the push is blocked with a hint (fail closed)
- a domain uses its own deny list: only the product's deny.txt is not enough (fail closed); domain.json `denyList` picks another
- a this-pc domain never syncs, even with a remote in its file; a folder without domain.json neither
- a new empty remote gets its first push
- a second writer on this PC (the lock in .git) makes the cycle wait; nothing pushed meanwhile
- a git operation left in progress is reported, not forced
- an edit made while the sync rebases is never reset, even when the rebase ends in a conflict
- a file changed between the commit and the rebase is committed and the sync retries: never a conflict
- exactly the scanned commit is pushed: a commit made during the scan waits for its own scan
- a merge commit's own changes are scanned too
- a commit message and its author are scanned too
- the allow list never comes from the domain: only the private allow-<domain>.txt beside the scanner
- beforeRead is bounded: a remote that never answers holds a chat back only maxMs

### `test/unit/brain/usage.test.ts` (1)

- a cost.mjs past its time limit is reported as a timeout, once an hour; a refresh while one runs starts nothing (#184)

### `test/unit/chat-feed-security.test.ts` (1)

- redacts %s in persisted and forwarded text

### `test/unit/chats/acp-opencode.test.ts` (23)

- maps only the explicit user choice %j to %s
- keeps restricted or unverified sessions once-only: %j
- does not invent an always option, or ignore a manager gate that removes it
- the upstream-cache fixture suppresses Asked for a forbidden command covered by a prior wildcard grant
- keeps a later force push behind the hard deny after an attempted always grant for normal push
- preserves permission locations when the preceding tool update has no raw input
- never upgrades an opaque tool from its title and never selects a remembered grant
- shows an OpenCode MCP permission by its name and real arguments, still asking once
- %s: the app tool %s is allowed once without a panel
- still asks for %s (%s)
- a read-only run still answers the question surfaces without a panel
- shows an OpenCode outside-folder permission with its folder and asks
- retains both raw input and locations and cancels when only remembered grants are offered
- lists the model option's models and sets the chat's model there, no model flag, then its effort
- a model it does not offer is a visible warning; the default model keeps running
- plan goes through the mode option (build back for the working mode); a resume sets the model again
- without modelOption the same answers give no model list (Cursor never sets a model on the session)
- ask_user: a Sì/No panel with the recommended option marked; the answer goes back as the next message
- ask_user: "Altro…" carries the user's words; a stop takes the panel away without a message
- ask_user on an engine being restarted after an ignored stop is refused, never a panel whose answer goes nowhere
- a stream error the engine recovers from (the turn goes on) is not a failure
- %s: a rate limit worded as quota, or a retry slower than the grace, waits for the engine; the turn goes on
- ask_user without its brief is sent back (with how to ask) at most twice, then shown; never on an engine with its own tool

### `test/unit/chats/acp.test.ts` (40)

- streams thought and text, ends the turn, reports no cost (ACP gives no usage)
- permission: allow once and reject map to the ACP option ids; "always" is never offered nor sent
- no "always" either when Cursor does not offer allow-always
- cursor/ask_question keeps grouped questions out of the panel even after repeated attempts
- cursor/ask_question yes/no without its brief: skipped with how to send one (ADR 0150)
- a chat that never sends a brief: shown on the third ask, then never held again; a stop during the wait cancels it
- cursor/ask_question: labels back to ACP ids, multi-select, skip
- a message streamed right before a question is finished when the question opens (its commands show on the Orchestrator card)
- cursor/create_plan becomes "Approvi il piano?"
- stop: session/cancel, open panels answered "cancelled", queued messages dropped
- sends pasted images as ACP image blocks when the agent takes them
- without image support the images are saved as files and their paths go in the text
- send now: after a cancel mid-turn the chat goes idle and the next message runs once, as a normal turn
- send now keeps the session queue: the cancel ends the turn, the queued message still runs
- runs queued messages one after the other and stays running in between
- a network error at the end of a turn: "continua" goes by itself, with a visible line, and the chat stays running
- two retries at most per message, then a clear warning; a new message gets its own retries
- stop during the wait drops the retry
- a message sent while the retry waits goes after it
- not logged in: "Accedi a Cursor", the process is stopped, authenticate is never called
- resumes with session/load (the replayed past is not shown again), or opens a new session
- model only with --model at spawn (never session/set_model); plan mode via session/set_mode; the chat's MCP endpoint
- the chat's effort wins over the settings' reasoning, and changes live on the thought_level option (issue #97)
- maps an effort onto the values the model offers, and refuses in words on a model with none
- an agent capped at plan takes the read-only mode whatever the chosen mode (A2)
- applies the user's reasoning and fast with session/set_config_option and shows the variant really running
- a value the model does not offer is a visible warning with the variant that runs
- a parameter pinned in the chat's model id wins over the settings
- runs Cursor with the app's own config folder: the user's Cursor config is copied, never written
- tool calls with diffs, plan entries, usage → list-price cost
- cursor/update_todos and cursor/task come as requests: shown and acknowledged (never "method not found")
- runs the subagentStart/subagentStop hooks of hooks.json for a Task (ACP never fires them)
- runs no subagent hook under tests unless a hooks file is given
- shows the replayed past of a restored chat when asked (showReplay)
- survives junk lines and reports a crash
- takes a live and a turn cost from ACP usage_update.cost when Cursor sends it
- runs as harness kimi with `acp` alone (no --model), none of Cursor's options, and its own name in what the user reads
- usage tokens are priced with Cursor's list only with priceFallback
- a network error: the retry lines and the resume prompt name Kimi
- not logged in: "Accedi a Kimi" with its own login command

### `test/unit/chats/admission.test.ts` (14)

- an agent's new chat waits (no engine started) and starts with \"Avvia ora\"
- a queued chat never looks busy: no "ha finito il turno" to the Orchestrator before its first turn ran
- a chat the Orchestrator opens while answering the user's own message never waits; one it opens on its own does
- the user's own chat and message never wait; the user's message takes the queued one with it, in order
- a message between chats to an open chat never waits for the load (app_send_to_chat), after the chat's own queued work
- the load dropping admits the chat by itself; a queued chat closed by hand drops its work
- no warm engine is started while the emergency brake is on
- a warm engine is started under the brake, whatever waits for a slot (proposal 2)
- a cold first turn logs its steps after the spawn: CLI setup, init, first event, MCP at init (proposal 6)
- a cold start holds its slot until its engine's first answer, then the next waiting chat starts
- %s: a resumed chat keeps its cold-start slot through the replayed past
- cursor: an engine that died during session/load does not keep the next engine from freeing its slot
- an app chat's queued work goes after a work chat's that came later
- chat mail reaches an idle chat at once under load, as a new turn: taken once, never put back (ADR 0064)

### `test/unit/chats/api.test.ts` (15)

- streams the answer in chunks, prices the usage and keeps the key in its header only
- reports the cost as unknown without prices
- prices a turn with the model it ran on, also when the model changes during it
- queues a message sent during a turn after it
- resumes from the history file: the request carries the past messages
- interrupt aborts the request: "Interrotto da te", no error, the partial answer kept
- a first byte that never comes ends the turn with a timeout; the chat stays usable
- 401: key rejected by <host>, never the key
- a 4xx body that echoes the key is shown masked
- 429 and 5xx get their own short lines
- does not follow a redirect (the key never goes to another URL)
- a missing key: the Settings hint, nothing sent
- images: the text-only note, the text still goes
- close ends the session cleanly
- streams with x-api-key, anthropic-version and max_tokens; usage → cost

### `test/unit/chats/archive.test.ts` (8)

- reports the last result, archives a finished chat, keeps it across a restart and reopens it
- a message to a closed chat reopens it and resumes the session
- never closes the Orchestrator; the auto archive is refused while the chat works or runs background tasks
- an agent resumed by SendMessage counts from the tool's result alone${mode ? ' (structured result)' : ''} (the QA chat of 2026-10-16)
- a SendMessage to a stopped agent that will not resume counts nothing
- a last answer that waits for its work holds the auto archive and the engine release until a later turn
- a message sent while the archive closes the session waits for it and reopens the chat on a new one
- keeps a token-free hand-off across a user archive; an archived chat is never started for a hand-off

### `test/unit/chats/checkpoint-barrier.test.ts` (4)

- Claude: the message goes before the snapshot, the write waits for it, the undo is exact
- Claude race: a new file written at once is removed by the undo; a turn with no write that ends before its snapshot keeps the order
- Claude: two quiet turns ending while the first snapshot is held each record their end, so the undo leaves a later edit alone
- an engine that cannot hold its tools (Codex, ACP) still gets the message only after the snapshot

### `test/unit/chats/checkpoint-deadline.test.ts` (1)

- a deadline releases writes without letting an unfinished older end record claim them

### `test/unit/chats/checkpoints.test.ts` (4)

- records the files before a turn and puts them back, without touching index, HEAD or branches
- after the turn ended, only its own changes go back: a later edit, a nested repository and odd names
- a folder outside git has none; old refs are pruned
- records the files before a work chat's turn, puts them back on undo, and tells the chat with its next message

### `test/unit/chats/claude.test.ts` (35)

- clears the previous submitted effort when a native running event starts an autonomous turn
- does not reuse the previous submitted effort for a turn queued inside the CLI
- streams assistant text as replace events and ends the turn with a result
- round-trips an AskUserQuestion: panel, answer, tool result
- sends a question that is not yes/no back to the agent, at most twice in a row, then shows it (ADR 0135)
- a yes/no question without its brief goes back with how to send one (ADR 0150)
- a yes/no question with its brief is shown (ADR 0150)
- never offers a suggested mode above an agent ceiling (A2)
- allows a permission for the session only when "always" is chosen
- runs an allowed call with the input fields the app patched (the role gate's qualified skill, issue #101)
- answers the CLI's PreToolUse hook callback in-process: a refusal reaches the model, turns reset it (ADR 0090)
- answers a product brain's hooks in process: no node process per tool call (ADR 0103)
- registers no hook on a read-only run, only the write barrier on a chat with no hook of its own
- holds a writing tool until the turn's checkpoint settles; reads pass at once (ADR 0228)
- denies a permission with the user's message
- MCP confirmations and forms reach the user and return the exact typed answer (#148, #253)
- interrupts a streaming turn
- send now: after an interrupt the chat goes idle and the next message runs once, as a normal turn
- a real failure with no words from the CLI still says why (its subtype); no interrupt = no "interrotto da te"
- the app's own interrupt (a hand-off that timed out) is never told as the user's
- interrupt withdraws an open question
- survives non-JSON and odd lines on stdout
- reports a crash as state error with the stderr reason
- counts the lines of an edit from the CLI structured patch
- sends the control requests and applies their effects
- stays running while queued turns remain (${mode})
- goes back to running when the CLI starts a turn by itself (no session state events)
- sends pasted images as base64 image blocks before the text; images alone are a message too
- sets CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS and follows session_state_changed
- honours suppress_always_allow_rule and lists what "always" grants
- shows a prompt inherited at initialize (pending_permission_requests on the envelope)
- a fork sends no session id before init and renames only its own new session
- forwards rate_limit_event and answers get_usage
- ignores the cost total of an error result below the base
- reports a live cost from the usage of assistant messages, the real one from get_usage, then the result

### `test/unit/chats/close-tree.test.ts` (1)

- a parent and its delegated child at work: both CLI processes end, an unrelated one lives

### `test/unit/chats/codex.test.ts` (29)

- keeps the reported session default separate from the explicitly submitted turn effort
- applies and revokes repository autonomy on later turns without restarting or answering pending approvals
- read-only overrides an autonomy callback and never grants writable roots
- an approval emitted by the server still waits for the user in scoped autonomy
- starts a thread, streams reasoning and answer, reports tokens and context
- second turn: tokens are the delta of the thread totals; model and effort change for the next turn
- command approval: accept runs it, the panel closes
- command approval: always = acceptForSession, deny = decline
- file change: a panel naming the file, the diff on the tool row
- asks the engine to retry a grouped interview without presenting a panel
- question: the answer goes back by question id
- MCP empty form: explicit allow=%s, no automatic or persistent consent
- MCP Stop cancels with null content exactly once
- MCP %s withdraws a turn-scoped panel without a late response
- MCP standalone request survives turn end; only its thread may resolve it
- MCP session close removes the panel and rejects a later click
- MCP unsupported or malformed input yields an RPC error, never user decline: %j
- tool/requestUserInput is not guessed as the item/tool/requestUserInput protocol
- a message while a turn runs steers it
- Stop interrupts the turn; an open panel is answered cancel
- a failed turn shows the error; unauthorized shows the login help
- no account: the login help before any turn, key or not; the app never logs in, the key goes only into the env
- file change with grantRoot: the panel says it is write access to the folder for the whole session, no "sempre"
- Stop before turn/start is answered: turn/interrupt goes out as soon as the turn id arrives
- resume: the same thread, its past replayed; a failed resume opens a new thread
- mcp tool call, plan updates, drift on unknown shapes
- a crash ends the session with the stderr tail
- a read-only run with denied folders never starts; read-only alone gets the read-only sandbox
- close ends the process cleanly

### `test/unit/chats/cold.test.ts` (1)

- every Claude engine reports the configured window (300k), 1M models included

### `test/unit/chats/engine-priority.test.ts` (2)

- a Claude engine starts below normal priority, never above the app itself
- a child of a lowered process inherits its priority (the MCP servers, shells and taskkill an engine starts)

### `test/unit/chats/handoff.test.ts` (8)

- Claude: the chat writes its hand-off in one turn that is not a job turn
- falls back to the app note when the chat answers off format, and when it has no turn yet
- ask false (the automatic closing): a running chat is not asked, no extra turn, the token-free note
- "Riprendi" opens a linked new chat from the hand-off, closes the old session, and survives a restart
- refuses the Orchestrator and a busy chat
- "Riprendi" waits for the turn even with a fresh note, and a double request gives one new chat
- a chat in a separate worktree passes the worktree hint down the chain A → B → C
- Cursor: estimated context from what crossed ACP, a hand-off turn, and no start of a stopped engine when not allowed

### `test/unit/chats/manager.test.ts` (29)

- creates a chat, streams a turn and emits contract events
- routes a question to pending and back
- counts work time while starting or running, never while waiting for the answer
- persists chats, restores them closed with their history and resumes on send
- forks one of the app's own Claude chats (a copy with its own id), nothing else
- applies settings live, persists them and closes a chat
- never starts an engine the user switched off: neither a new chat nor a stopped one resuming
- an agent never wakes a stopped chat on an engine the Orchestrators may not use; the user still can
- stops running chats and recovers from a crash by resuming
- reports the CLI status without blocking (version probed in the background)
- stop interrupts whenever a process exists, even when the chat looks idle
- a message with pasted images: checked, shown with its previews, passed to the engine
- with no mode chosen leaves the mode to settings.json, shows what the CLI reports, and keeps it unchosen
- shows but never persists a permission mode set by the CLI ("always" with a setMode suggestion)
- keeps the cost total across an error result, so the next resume counts one turn
- runs a Cursor chat: panel, answer, turn, cost unknown; restored chats resume with session/load
- restored OpenCode chats resume their ses_ session with session/load after a restart
- a Cursor chat asks a Sì/No question with ask_user; only the user's answer reaches the engine
- changes a Cursor chat's model by reopening its session, never with session/set_model
- calls the brain hooks: waiting, turn end with the first prompt, done, rate limits
- a throwing hook never breaks the chat; a restored chat resumes without a new job
- moves the Orchestrator role to a new chat (persisted, both updated) and gives a Cursor Orchestrator the app MCP server
- raises the cost of a chat while its turn runs (live estimate), then settles it to the real cost
- corrects the live cost with get_usage mid-turn and keeps it as spent when the CLI dies mid-turn
- a CLI that dies mid-turn calls onCrash once with its error (no result, so no onDone); a close does not
- asks get_usage on its own every usageEveryMs while a Claude chat is open (plan windows during long turns)
- an idle chat with an explicitly complete census releases after the delay and resumes; never an Orchestrator
- typing into a chat whose engine was released resumes it ahead of the message (no turn); a live engine is left alone
- an engine started while the user typed and never written to ends again

### `test/unit/chats/orchestrator-codex.test.ts` (2)

- delegates one role chat on Codex with the informative title and complete brief
- keeps an explicit engine refusal visible and does not create a chat

### `test/unit/chats/remote-control.test.ts` (6)

- turns it on with the name, gets the link and bridge, follows bridge_state, and turns it off
- sends the bridge to reattach and gets the same one back
- a refusal rejects with the engine's own words
- a reply without a claude.ai link is drift and an error, never a link shown
- shows a message typed on the phone, marked as the phone's, and never repeats the app's own
- without Remote Control on, an echoed message is never shown

### `test/unit/chats/warm.test.ts` (8)

- the next new chat in the same folder adopts the waiting engine and sends its choices as controls
- a chat in another folder starts cold and gets its own waiting engine; the first folder keeps its one (ADR 0227)
- Orchestrators, worktrees and bypass chats never take it
- an agent with a tool policy never takes it: the waiting engine has no limits
- a role chat leaves an engine launched like it, and the next chat of that role adopts it
- the open Orchestrator's engine starts ahead of the first message after a restart, with no message
- the waiting engine dies with the app; prewarm off starts none
- adopted while it still starts: the choices wait for the start-up instead of timing out

### `test/unit/chats/wire-replay.test.ts` (1)

- builds the same chat as the recorded run, step by step

### `test/unit/check-lock.test.ts` (3)

- queues a simultaneous execution until its owner releases
- recovers a stale file after its actual owner dies
- times out only the waiter without disturbing the owner

### `test/unit/cli-status.test.ts` (2)

- checks %s login with fixed status flags, including stderr
- keeps the actual app login status tri-state for %s

### `test/unit/coordination.test.ts` (1)

- commits exactly once across concurrently released connections and preserves the winning source

### `test/unit/correction-catch-hook.test.ts` (6)

- uses semantic yes and no instead of regex, independently of recall; never classifies agent mail
- a warm semantic no clears only a confusion-only match: an explicit correction on a new topic still flags
- uses regex when semantic detection is unavailable or times out
- never flags the app text: agent and app labels, the role frame; the owner words after the frame still count
- warns with the similar errors, for the owner and for an agent task, next to the correction reminder
- gives no warning when not ready, slow, or without the app; the regex still flags a correction

### `test/unit/doctor.test.ts` (1)

- a default doctor run reports config and paths without starting any candidate

### `test/unit/engines/text.test.ts` (1)

- answers text_complete only on its own token, with the call's JSON

### `test/unit/event-origin.test.ts` (3)

- reads a fresh context for each error, never attributes the reporter model to the responsible episode
- preserves an idea event snapshot and leaves legacy ideas unavailable
- records explicit positive feedback as human even with a model context

### `test/unit/extract.test.ts` (6)

- extracts regular stored/deflated files and dotfiles literally
- rejects %s before writing any entry
- rejects unsafe %s metadata before any writes
- rejects nonempty and linked extraction roots without overwriting anything
- round-trips the real producer script and its native Compress-Archive path/type metadata
- cancels before extraction without writing entries

### `test/unit/file-diff-review/dotdot-name.test.ts` (1)

- a tracked file named `..notes.md` at the repository top is compared with HEAD

### `test/unit/file-diff-review/find-repo-links.test.ts` (2)

- rejects a Windows share link at %s before following it
- a .git/objects that is a link to a network share is refused, not read through its unresolved path

### `test/unit/file-diff-review/no-git.test.ts` (1)

- Compare with HEAD without a usable git does not claim the commit is missing, and retries after installation

### `test/unit/file-diff-review/transport.test.ts` (1)

- a repository config with protocol.ssh.allow=always does not get its core.sshCommand run by Compare (git without GIT_NO_LAZY_FETCH)

### `test/unit/file-diff.test.ts` (5)

- reads the file against HEAD, a commit, a branch, with the short commit id in the label
- says why when there is nothing to compare with
- compares two local files, in or out of a repository
- treats a repository as untrusted: no lazy fetch, no network path through git folders, alternates or includes
- takes a ref only as one revision: never an option, a range or a path

### `test/unit/guard-commit-hook.test.ts` (9)

- a clean commit passes
- a staged bad line blocks: file:line + rule and the fix, never the value
- scans the staged bytes, not the working tree
- a proven false positive passes once its printed .guardallow line is staged
- a deny-list word blocks; a deny list set but missing blocks every commit
- a file or folder name with a deny word blocks, the name masked; staged out/ is scanned too
- a deny list saved as UTF-16 (PowerShell 5.1) still blocks; an empty one blocks every commit
- guard.email set: another author e-mail blocks, without printing it
- setup-hooks turns the hooks on for the repo and only prints the optional config

### `test/unit/guard-push-hook.test.ts` (10)

- a clean push passes
- a bad commit message blocks the push, never printing it
- a bad line in any pushed commit blocks, even when a later commit removed it; only new commits are scanned
- guard.email set: a pushed commit by another e-mail blocks
- a branch name with a deny word blocks even with no new commit, never printing it
- an annotated tag: its message and tagger are scanned, even on a commit the remote has
- a forbidden file under a non-ASCII folder is caught by the push (raw paths)
- the same content under a second, forbidden path is caught by its name
- only the new commits are scanned: an old commit the remote already has does not block
- a deny list set but missing blocks the push

### `test/unit/guard-scanner.test.ts` (7)

- only exempts the exact GitHub system mailbox: %s at %s
- rejects unknown options instead of silently omitting requested checks
- scans private data in allow-file comments before any commit exists
- fails closed when history is requested outside a Git repository
- checks ref metadata even with zero new commits, without allowing or echoing the value
- masks a forbidden pathname and refuses to pin a private file name
- scans a forbidden historical alias even after its removal and a benign alias has the same blob

### `test/unit/improve-guard.test.ts` (1)

- scans original blobs even when refs/replace presents a safe replacement commit

### `test/unit/log-digest.test.ts` (1)

- fills run from the chat, writes op and step, and logs.mjs filters by --run

### `test/unit/log.test.ts` (1)

- writes one JSON line per entry with cause and hint on errors

### `test/unit/mcp-server.test.ts` (22)

- binds a random loopback port and builds URLs from it
- initialize negotiates the protocol version, returns instructions and a session id
- lists tools with schema and annotations
- calls tools: text, image + text, and tool errors as isError results
- logs a tool failure as a warning but an expected refusal only as info (issue #274)
- answers protocol errors: unknown tool, unknown method, parse error, invalid batch
- handles JSON-RPC batches and answers notifications with 202
- refuses foreign Origin and Host headers with 403 (DNS rebinding, web pages)
- allows an explicitly allow-listed origin
- accepts only POST application/json within the body cap
- answers 404 for unknown routes and wrong chat tokens
- isolates chats: each per-chat endpoint runs tools with its own chat id
- a mount's instructions may depend on the route (a chat's endpoint says only what applies to it)
- gives each generic MCP session its own id (the browser uses it as the tab group)
- DELETE with a session id ends the session when the mount frees sessions (204), else 405
- survives a client that disconnects in the middle of a body
- refuses a second mount on the same path
- accepts a tools factory per call
- streams progress notifications then the result when the call has a progressToken
- notifications/cancelled aborts the call it names (same session), even with the connection open
- answers plain JSON when the tool never reports progress
- cannot stream without a progressToken, without text/event-stream or in a batch: progress() says false

### `test/unit/mcp-servers/client.test.ts` (5)

- initializes, keeps the session, sends the token header, reads JSON and SSE answers
- maps 401 to a token error and an unreachable host to a network error
- lists every page of tools, answers server requests and passes the token only as its variable
- a server that exits gives its last stderr line and a fix
- a missing program is a spawn error

### `test/unit/mcp-servers/engines.test.ts` (2)

- Cursor (ACP): session/new lists the managed servers next to the app's own
- Claude: --mcp-config carries the managed servers, --disallowedTools the ones the chat may not use; no file written

### `test/unit/mcp-servers/gateway.test.ts` (7)

- gives every role every server by default, with the token only in the upstream endpoint
- closing a chat ends its connections at once, and only its own
- a role limited on the card sees only the reading tools, and a call of another one is refused
- a role without the server, a policy without mcp, a wrong token and an unknown chat get nothing
- a child never gets more than its parent
- Prova records the tools or a clear error with a fix; a missing token is said before any connection
- runs a stdio server end to end, its token only in its own process environment

### `test/unit/mem-run.test.ts` (2)

- adds the run of the app chat the line names, the newest chat of a reused title
- takes --run over the chat, and refuses a bad id or a run already in the text

### `test/unit/phone/bridge.test.ts` (6)

- a dev build without a test base is dev-disabled and never calls fetch
- a test base off loopback is refused before any call
- a bad token stops with the token error
- a dev build never shows a pairing code (review C5)
- voice temp files left by a crash are removed at start; nothing else (review C6)
- setToken refuses a malformed token and never stores it

### `test/unit/phone/client-voice.test.ts` (12)

- real API by default; a test base only on loopback, root path
- splits long texts at 4096 chars, buttons only on the last part, no parse_mode, silent flag
- 429 waits retry_after and retries
- a network error retries with backoff, then gives up with a TelegramError
- a wrong token: 401, the token never in the error nor in the log
- 409 conflict surfaces at once (no retry)
- downloads: capped by content-length and by streaming, bad paths refused
- transcribes, echoes, sends to the Orchestrator and deletes the temp WAV
- deletes the temp WAV when the transcription throws
- no voice models → the "attiva la voce" message, nothing left on disk
- decode failure writes nothing; empty text asks to retry
- refuses over 5 minutes or 20 MB before downloading

### `test/unit/publish-guard.test.ts` (1)

- the repo files carry no finding

### `test/unit/pull.test.ts` (4)

- executes through a symlinked checkout path, as with macOS temporary directories
- nothing new, then a fast-forward with the commit list, never a reinstall for plain files
- --check counts what GitHub has and changes nothing (ADR 0075)
- local commits or uncommitted changes stop it and leave main where it was

### `test/unit/read-work.test.ts` (6)

- returns identical estimates while the main event loop keeps running, with an immutable input snapshot
- reads the same brain view without rewriting files, and observes the next explicit file change
- rejects pending work on stop and serves a later request with a new worker
- keeps Memoria available with a corrupt optional %s report
- sends the runs once per key: a read with the same key reuses the worker copy, a new key or worker sends them again (#276)
- keeps one copy per kind of read: a brain view and an estimate with different keys do not send the runs again (#293-#297)

### `test/unit/readme-check.test.ts` (1)

- has no README problem beyond the pending ones, and no pending key already fixed

### `test/unit/recurrence-producer.test.ts` (1)

- ships recurrence and quality with conservative 14-day rule verdicts

### `test/unit/release-env.test.ts` (1)

- after init no child the app starts inherits them; the process still knows what it is

### `test/unit/release-gates.test.ts` (1)

- rejects %s even with an isolated root

### `test/unit/release-launch.test.ts` (1)

- the installed VBS shortcut bootstraps a retained runtime when the current runtime is missing

### `test/unit/release-writer.test.ts` (9)

- refuses another native process while a lease is owned, then releases normally
- preserves a native process crash journal and refuses any subsequent writer without TTL stealing
- rejects the wrong consent digest without changing bootstrap or current
- refuses an external selection made after consent instead of overwriting it
- never overwrites the consented bootstrap with a different caller checkout during apply or conditional rollback
- refuses automatic apply on legacy state and reports a distinct state protocol
- uninstall preflight requires the parent owner token and refuses a live readiness PID
- installs from a private verified payload under the common writer lock
- installs physical ASAR runtime assets with the bundled Electron-as-Node

### `test/unit/routine-runtime/cli-build.test.ts` (1)

- prints its usage and refuses --engine cursor

### `test/unit/search-recall.test.ts` (1)

- answers one tools/call (no initialize) on its token URL, and 404 on any other token

### `test/unit/search/gitignore-fallback.test.ts` (3)

- preserves an existing safe index when git becomes unavailable
- sanity: with git working, a gitignored note is left out
- still leaves gitignored notes out when git ls-files fails

### `test/unit/search/missing-root.test.ts` (1)

- keeps the index (and its vectors) instead of treating the folder as empty

### `test/unit/setup-pc.test.ts` (2)

- a config.json that is not a JSON object is reported, never overwritten; none = {}
- --dry-run clones nothing and writes nothing

### `test/unit/template-first-run.test.ts` (4)

- installs a Codex brain without Node on PATH, then runs its public memory/context/prompt tools
- rejects a consent flag used as a field value before creating any folder or global configuration
- renders final paths while writing only a separate staging folder
- creates main even when inherited Git configuration requests master and another worktree

### `test/unit/update-restart.test.ts` (2)

- holds the real live parent without launching, then confirms cancellation (idempotent)
- rejects any extra launcher code before reporting ready

### `test/unit/voice-download.test.ts` (1)

- a .tar.bz2 voice is unpacked without its top folder, the archive removed
