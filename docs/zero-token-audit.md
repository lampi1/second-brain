<!--
  Zero-token audit (2026-10-13): where the owner's agents spend tokens on steps a script or an app tool can do,
  measured on a real week, ranked, and what was moved out of the LLM. Read by whoever picks the next optimisation
  (docs/VISION.md "North star" points here).
-->

# Zero-token audit (2026-10-13)

## Method

- Week 07-13/10, Claude only: the brain's `ops/tools/cost.mjs` (per chat, per turn) plus a one-off scan of every
  transcript tool call (name, context size when called, result size, and how many later responses carried the result
  in their cache). Tokens/week = context re-read by the turn that runs the step + its result carried by later turns.
- Prices: Opus 5.5 cache read $0.2/M, write $5-8/M, input $4/M, output $20/M.
- Total Claude spend that week: ~$2987; the Regia ~18% ($529). "stato" turns cost ~$0.98 each (11 tool calls on
  average), against ~$0.44 for a normal Regia turn.
- Cursor is out of scope (its usage is only in the owner's CSV).

## Ranked: done in this branch (tokens/week, before → after)

| # | Step | Uses/week | Before | After | Piece (zero LLM) |
|---|------|-----------|--------|-------|------------------|
| 1 | Regia reading app chats one by one (`app_chat_items`, `app_chats`, `app_pending`, `app_command_runs`) | ~240 | ~114M | ~48M | appctl `app_digest` (since "last"): the whole picture in one call |
| 2 | Reading one DevOps item/PR through the MCP's JSON (get + comments + PR) | ~170 | ~117M | ~55M | `devops-me.mjs --item/--pr` (~5x smaller text) |
| 3 | "stato" in the Regia (~11 calls: chats list/read, devops-me ×2, env-lease, now.md, hygiene) | ~26 | ~61M ($25) | ~27M | `stato.mjs`: one call, marks what is new since the last run |
| 4 | `inbox.mjs wait` in chats run by the app (re-armed every mail, wakes a turn for nothing) | ~115 | ~34.5M ($27) | ~10M | `wait` exits at once in an app chat; `chat-prompt.mjs --app` drops the line |
| 5 | Regia woken only for a question/permission/command (the app already shows them) | ~78 | ~37M ($14) | 0 | `RegiaWake` quiet news: they ride with the next "finished" news |
| 6 | Reading all of `now.md` to check one line | ~285 | ~19M+ | ~2M | `mem.mjs now show --label/--match` |

Total ≈ 380M → 140M tokens/week, roughly $90-110/week less, with the same information on screen.

## Checked, already token-free

- Auto-close hand-off (`ask: false`), estimates (script), the warm engine (no model call).

## Round 2 (2026-10-13 evening): measured per turn, then built

Method: every Claude transcript of 07-13/10, per turn (between two user messages), the calls of one kind; the saving
of one tool replacing them = the 2nd..nth calls × the context each re-read (cache read $0.2/M) + their output.

| Step | Measured | Done | Expected saving |
|------|----------|------|-----------------|
| git "where does this branch stand" (status, log, branch, rev-list, worktree) | 1120 calls in 561 turns, 559 of them extra; 98M tokens of context re-read (~$20) | `repo-state.mjs`: branch, vs base and upstream, every changed file, own commits, merge/rebase in progress, `--contains`, `--worktrees`; read-only (`--no-optional-locks`), a failed git read is an error, never "clean" | ~50M/week if half the chains move (estimate; code.md + the code chats' rules point to it) |
| az pipelines/repos reads (release list → show → definition → build show; pr show --query) | 160 reads in 90 turns, 70 extra, 20.6M context (~$4) | `devops-me.mjs --releases [--def]`, `--build <id>`; `--pr` adds branch, merge commit and whether the build is on it | ~15M/week (estimate) |
| Journal reads | 167 real reads (65 targeted greps ~800 tokens, 33 cats, 29 ls), ~0.2M tokens of results | nothing: the round 1 figure (57M) counted commands that only mentioned the folder; a tool would save < 5M | — |

The `diff`/`show`/`grep` git calls (≈4200 a week, mostly reviewers) read code: they are the work, not a chain.

## Round 3 (2026-10-14): mail that wakes an idle Regia

Measured (Regia transcripts of 07-13/10, a turn = one started while the Regia was idle): 86 turns started by a chat's
mail, $25.35, median $0.18. Read one by one, only 2-4 were pure progress: 81 asked the Regia for something (a sha or a
branch ready, merge, a failure, a request to pass on). So a "progress never wakes" rule alone saves almost nothing; the
waste is in timing: 41 of the 86 started less than 2 minutes after the Regia's previous turn ended.

Done (`src/main/chats/mail.ts`, `regiaWait`): mail to an idle Regia waits up to 60 s, so the news arriving together
(more mail, the sender's "ha finito" wake, the user's message) costs one turn; "urgente" goes at once; only a note that
reads as pure progress (a progress word and no request, sha, branch, push, "fatto", failure or question) rides along
with the Regia's next turn, at the latest after 30 minutes (a Cursor Regia, which takes no mail mid-turn, gets it right
after that turn). A Regia that works gets mail at once as before. Nothing is dropped: held mail stays unread in its box
and goes in full with the first message due. Replayed on the same week: 86 → 72 turns, $25.35 → $22.53 (≈ $2.8/week);
the longest added wait for a request is 60 s.

## Next candidates (not done)

| Step | Measured | Idea |
|------|----------|------|
| Sidebar `list_sessions`/`move_sessions` | ~35M | Claude desktop only; not scriptable from here |
