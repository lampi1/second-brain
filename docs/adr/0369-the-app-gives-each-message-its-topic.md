# ADR 0369 · The app gives each Orchestrator message its topic, and a fresh context starts from that topic

Date: 2026-11-27 · Status: accepted (owner's proposal 3, «Orchestrator veloce») · Amends: the Orchestrator's role rules
(`src/main/agents/orchestrator-role.ts`: the `[Topic]` prefix line is gone), ADR 0031 (a rollover is one more kind of
invisible continuation, with the same divider)

## Context

- Topics in the Orchestrator existed only when the model wrote a `[Topic]` prefix; the pills over its transcript only
  filtered the view. The app knew nothing about which messages belong together.
- Every Orchestrator call re-read the whole mixed history: about 100k tokens on Claude, and on Antigravity p50 502k
  input tokens per turn (owner's PC, 2026-11-27), because ACP engines get no compaction (Claude's is inside its CLI,
  `chats/claude.ts` `compactSettings`). Turn after his message: p50 38 s, p90 170 s.

## Decision

1. **The app assigns the topic of each of the user's messages** (`src/main/agents/orchestrator-topics.ts`), cheap and
   deterministic first, in this order: his own `[Topic]` or `#topic` tag; the message he answered with «Rispondi» (the
   composer's `> quote`; a quote that names one topic only, like a line of a recap, goes to that one); a chat title, plan,
   project folder or topic label his words name; failing a whole name, the one topic his telling words (stems, no
   generic words) share most with; the open question of another chat that a short answer answers (a delegated child's
   question counts for its root); a short follow-up of his last message within 15 minutes. A message that matches
   nothing opens a new topic named from its own first telling words. Only when the rules are not sure (two topics named,
   questions on two topics, a new subject while other topics are open) does the lightest available model choose among
   the open topics (`OneShotService` light run, purpose `topic`, 40 output tokens, never in tests). It never holds the
   turn: the message goes at once with the rules' choice and the model's later answer moves it; a move by the user is
   never undone by the model.
2. **The topic is stored on the message**: `ChatItem.topic` / `topicBy` (contract first,
   `src/shared/contract/chats.ts`), the list in `<userData>/orchestrator-topics.json`
   (`agents/orchestrator-topic-store.ts`: labels, chats per topic, a 120-character gist per topic, and a fingerprint of
   each message's first 160 characters with its time, so a message read back from a transcript under another id finds
   its topic again; never message text, never secrets; an unreadable file is never overwritten). Typed IPC:
   `orchestrator:topics`, `orchestrator:setTopic`, event `orchestrator:topicsChanged`.
3. **The chats' news and results take the topic of the chat they belong to**: a chat the Orchestrator starts or assigns
   during a turn joins that turn's topic; a child is its root's; the chat's mail (`from`), its result notice (`resultReady`
   with `params.chatId`) and an app wake that names a single topic's chats carry it; the Orchestrator's replies carry
   their turn's.
4. **A fresh Orchestrator context starts from its topic, on every engine**: when the Orchestrator's role text goes again
   (a new session, a context compacted away, a rollover) and the conversation has something to carry, its first message
   carries the per-topic brief (`agents/orchestrator-brief.ts`): the current topic's last 8 exchanges (500 characters
   each, the app's envelope stripped), one line for each other open topic, the chats at work or waiting, the essentials of
   me.md and now.md (1800 characters at most). Zero tokens to build: the app writes it from what it holds.
5. **An ACP Orchestrator rolls over** (`chats/orchestrator-rollover.ts`, `chats/manager-topics.ts`): right before his
   message, when the engine is idle (no turn, question, app turn, switch, background command or queue), past 60k context
   tokens, or past 30k on a switch to another topic, the session ends and a new one starts (`session/new`, never a load
   of the old one), seeded with the role text, a one-line note and the brief. The brief is kept as the divider's note,
   as for a cold continuation. Claude keeps its own compaction and day compaction (it gets the brief whenever its context
   starts again); Codex and the API engines are not rolled; never under Remote Control. If the new engine does not
   start, the chat goes back to its old session.
6. **The lean prompt stays lean**: the role loses its `[Topic]` line; nothing is added to it. The brief rides only on a
   fresh context's first message.
7. **UI: data and a small hook only** (`renderer/lib/orchestrator-topics.ts`): the existing pills keep their `string[]`
   API (`useOrchestratorTopics(...).labels`, the stored open topics plus the old `[Topic]` prefixes), the existing
   `.msg-topic` chip becomes a native list to move a message (and its replies) to another open topic in one click
   (`TopicChip.tsx`), and the search over the Orchestrator's messages by text and topic is one shared function
   (`shared/orchestrator-topics.ts` `searchMessages`, `matchesSearch`), used by the view's filter and the hook.

## Measurement

On a fixed fixture of one Orchestrator day on an ACP engine (`test/fixtures/orchestrator-topics/antigravity-day.json`:
35 turns, 5 subjects interleaved, invented words, sizes shaped on the measured day; no live call), with the real rules,
rollover rule and brief (`test/unit/chats/orchestrator-tokens.test.ts`):

| | before | after |
|---|---|---|
| input tokens, whole day | 10.9M | 4.56M (−58%) |
| per turn p50 | 263k | 133k (−49%) |
| per turn p90 | 550k | 189k (−66%) |
| per turn max | 831k | 233k |
| context at the end | 121k | 34k |

11 rollovers in 35 turns; the rules alone (no model) found the 6 topics of the day (the four subjects, the
Orchestrator's own speed, and the recap) and brought every follow-up, «Rispondi» and chat result back to its topic.

## Consequences

- A rollover costs one engine start (seconds on Antigravity) about once per topic switch or 60k tokens; every later call
  of that context reads about half. The thresholds are one table (`ROLLOVER_POLICY`).
- An ACP Orchestrator restored after an app restart shows only its current session's past (as before for any new
  session); the older items stay in the divider's note.
- The light model spends a few hundred tokens only on unsure messages, on the Artisan's engine's lightest model.
- Untried on a real Antigravity day; the fixture numbers are a model of the engine (each call re-reads the context so
  far), not a live measurement.
