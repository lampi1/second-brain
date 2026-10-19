# ADR 0047 · Model routing is voted and priced per work, with a sample judge

> Routing parts superseded by [ADR 0078](0078-agent-first-routing.md): an agent's profile decides engine, model and
> effort; the table only fills a model the profile leaves open, and the override rule applies only to agentless chats.

Date: 2026-10-14 · Status: accepted

## Context
The model loop (ADR 0032) learns from `ops/state/improve/outcomes.jsonl`. On 2026-10-14 the ledger held 819 routed
jobs and only 4 had a known outcome, all "proxy" (closed without an error line), all successes: 808 were sub-agents whose
errors could not be tied to them, and the 45 lines of `ai-errors.md` of 13-14/10 named chats, not models. A chat was also
judged alone, while one piece of work often spans a chat, its hand-offs, its sub-agents and a second chat on the same
branch or work item. The user approved two additions in a panel (through the Regia dell'app): "il voto va al lavoro
intero" and a sample judge; then "deve unire anche i costi, non solo i voti".

## Decision
All of it lives in the brain (zero app code): `ops/improve/work-keys.mjs`, `routing-outcomes.mjs`, `judge.mjs`
(success mode; its pair mode judges the A/B comparisons, ADR 0046), `routing-loop.mjs`, `ops/tools/mem.mjs`.
- **The work key** ties the chats, hand-offs and sub-agents that worked on one thing: a DevOps work item named in the
  chat's title or first prompt or carried by its branch name (`wi:<id>`), else the first branch the chat created or its
  folder's branch when the folder is a linked worktree (`branch:<repo>/<name>`; a main checkout's branch is whoever
  switched it last, never a key), else the chat and its hand-offs (`chat:<ledgerId>`). A hand-off chain is one work:
  every chat of it takes the first key found along it. A sub-agent takes its mother chat's key (by Claude session, else
  by title). A Regia (the work one, the app's, an archived one) is never a member. Read from the app's `chats.json` and
  the Claude transcripts, cached once found (`work-keys.json`; a key from the folder is looked at again while the
  transcript grows). An error line tagged with a key no work has any more (the chat found its branch later) counts by
  its chat title.
- **The vote goes to the whole work.** A work is settled once every chat of it is archived or quiet for 24 h and every
  sub-agent quiet 24 h. It fails, on every member with its own model and effort, on: a line of `ai-errors.md` for that
  work (`mem.mjs error` adds `· lavoro: <key>` by itself from the chat's title, `--work` names it; old lines count for the
  chats they name), a bug of the work item the user resolved and that came back (`bug-reopen.mjs`, twice a day), or the
  judge's failure. An explicit failure beats the judge; the judge beats the proxy. Not yet a signal: a QA run that
  failed (the PR ↔ work link is not in the ledger) and a redo (a later chat on the same key is often the next step,
  not a failure).
- **The cost is the work's.** `work.usd` = the measured $ of its app chats plus only the sub-agents whose mother is not
  an app Claude chat of the work. Checked on 2026-10-14 over 20 app chats that launched sub-agents: the CLI's
  `total_cost_usd` (what the app records as the chat's cost, `stream-json` `result`) is about the main thread's cost plus
  its sub-agents' (e.g. 27.01 = 14.62 + 9.01, the rest is the CLI's own small calls), so a Claude chat's cost already
  holds its sub-agents and the `sub:` lines are never added to it again. A sub-agent of a mother outside the app (Claude
  desktop) is added and the work is marked `partial`: that mother's own $ is not in the ledger, and the loop leaves a
  partial cost out. The loop compares models on $ per work, one sample per work and arm.
- **The sample judge.** Claude Opus 5.5, effort medium (never Fable, never another engine), rereads a closed work that
  only the proxy called a success and that has an app chat (the loop reads only those): its transcripts and git
  history, read-only (headless Claude Code through `ops/improve/claude-readonly.mjs`, `dontAsk`, only Read/Grep/Glob
  and the git verbs that cannot read outside the repo or write: log, show, rev-parse, merge-base, ls-files, status,
  cat-file, ls-tree, verb first, in the start folder; never branch, fetch, diff or blame, never `-c`, `-C`,
  `--no-index`, `--output` or their abbreviations; the user's deny list, hooks off, no session saved, so it never
  enters the ledger it judges). A judgment cut by its 20 min
  timeout counts an estimated $ 2 against the cap and ends the run. It answers success or failure with a reason (`source: 'judge'`, weight 2 in the loop's Beta). About 1 work in
  10 per model or effort, newest first, so a rare arm is judged as often as the common one. Its $ goes to `judge.jsonl`
  and `work.judgeUsd`, never into the work's cost. At most $ 5 a day (Europe/Rome; about 6-15 judgments at today's Opus
  price, a guess before any run is measured), at most 3 a run, one run at a time; started in the background by
  `estimates.mjs --update` (`judge.mjs success --auto`); off until the user turns it on (`judge-config.json`; on since
  2026-10-14 at $ 5, the user's answer in a panel).
- **Comparisons vote too.** Each judged A/B round (ADR 0046 §4) writes one outcome per side to the same ledger
  (`source: 'compare'`, id `compare:<round>:<side>`, weight 2 like the judge): a side succeeds when at least half of
  its findings were judged correct.

## Consequences
- On the ledger of 2026-10-14 (a dry run on a copy) the settlement went from 4 known outcomes to 427, 117 works.
- The judge spends the user's Claude subscription: capped, and off by default.
- A wrong key merges two works or splits one: the key's source is cached with it (`from`), to be checked when a vote
  looks off.
- No app change, no new dependency.
