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

Not removed yet: the tests that start real processes, git, ports or a browser but have no clock of their own (about 830
tests in 96 files). They wait only on the suite's 120 s; the owner decides whether they go too.

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
