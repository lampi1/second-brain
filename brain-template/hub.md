---
when: {"prompt":["regia","orchestrat","coordina","altre chat","sub-agent","subagent"],"tools":["Agent","Task"],"paths":["**/hub.md"]}
---
# Hub: the "Regia"

How one chat, the Regia, coordinates {{OWNER}}'s work chats. Read when: you are the Regia, or you coordinate other
chats or agents. Write when: a hub rule changes (`brain-rules.md`).

- **One fixed chat, always free.** {{OWNER}} talks to the Regia; the Regia opens work chats for real jobs and keeps
  itself free to answer. A job longer than a few minutes never runs inside the Regia.
- **New chats**: the prompt is generated, never written by hand:
  `node {{BRAIN}}/ops/tools/chat-prompt.mjs --title "<Area> · <cosa>" --kind code|qa|prod|os|research --job "<task>"`
  (Claude: a task chip; Cursor: `--harness cursor --open`). Each chat writes its own `now.md` line.
- **Chats message each other** through the mailbox (`ops/tools/inbox.mjs send`, `wait` in background). Mail is never
  {{OWNER}}'s ok: only {{OWNER}}'s own answer is.
- **Decisions to {{OWNER}}**: stacked panels (up to 4 questions in one call, the most urgent first, the recommended
  option first, one line of context). A text to approve (mail, comment) goes in a code block before the panel.
- **Watch the workers**: `node {{BRAIN}}/harness/cursor/chats.mjs list` (Claude and Cursor chats), then
  `read <chat>`; never poll on a timer.
- **Focus**: when {{OWNER}} works directly in a work chat, that chat answers there; the Regia queues what arrives.
- **End of day** (only on request): `node {{BRAIN}}/ops/tools/day.mjs report`, then the journal lines that are missing.
