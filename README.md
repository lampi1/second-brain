<!-- Product overview and source setup for users and contributors. Detailed operating rules live in AGENTS.md. -->
<p align="center"><img src="build/icon.png" width="96" alt="second-brain"></p>
<h1 align="center">second-brain</h1>

<p align="center">
  <b>A cockpit for your AI coding agents: Claude Code, Codex and Cursor on one screen, with a brain that gets better every week.</b>
</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="Windows first, macOS and Linux too" src="https://img.shields.io/badge/Windows%20first-macOS%20%C2%B7%20Linux%20too-0078D6.svg">
  <img alt="Lines of code written by the developer: 0" src="https://img.shields.io/badge/lines%20written%20by%20the%20dev-0-brightgreen.svg">
</p>

![The Grindhouse: a Strategist's work as a tree of thread cards, the Orchestrator's column on the right](docs/screenshots/grindhouse.webp)

> **Full disclosure:** the developer of this app has never written a single line of its code, and has not *read* one
> either. AI agents wrote all of it, the agents reviewed it, and the agents wrote this sentence too. The developer
> mostly types wishes in Italian and drinks coffee. It works surprisingly well, which is either the point of the app or
> a warning.

## Install: don't. Let your agent do it.

Open Claude Code, Codex, Cursor or whatever agent you trust with a terminal, and paste this:

```text
Set up the second-brain desktop app for me, from source, so I can use it and also hack on it.

1. Check my machine first: git, Node.js (the version in package.json "engines", 22 or newer), npm, and the GitHub
   CLI `gh`. If something is missing, tell me what and how you would install it the normal way for my OS
   (Windows: winget; macOS: Homebrew; Linux: my package manager or nvm), and install it only after I say yes.
2. Get the code. If `gh auth status` says I'm not logged in, run `gh auth login` and let me finish it myself.
   If I can't push to lampi1/second-brain (most people can't), ask me before forking it, then clone my fork:
   `gh repo fork lampi1/second-brain --clone`; otherwise `git clone https://github.com/lampi1/second-brain.git`.
   Make sure `upstream` points to lampi1/second-brain.
3. Read AGENTS.md and CONTRIBUTING.md in the clone, and follow them from here on.
4. Install: `npm run setup` (pinned deps with install scripts off, the Electron binary, the git hooks).
   On Linux, if Electron fails to start, tell me which system libraries it asks for (e.g. libnss3, libgtk-3,
   libasound2), install them after I say yes, and try again.
5. Build and start: `npm run build`, then `npm start`. The first start opens a short setup window: I'll go
   through it myself. Then run `npm run doctor` and tell me in plain words what is still missing
   (for example: logging in to at least one of `claude`, `codex` or Cursor's `agent`, which I do myself).
6. Leave the clone ready for issues and pull requests: `gh repo view` works, `main` tracks upstream, and tell me
   the loop: a branch per change, `npm run check:branch` before committing, Conventional Commits in English,
   never `--no-verify`, the PR template in .github/. Don't push or open anything without asking me.

Finish with a three-line summary: where the code lives, how I start the app, and how I update it.
```

That's it. Updating later is one click: **Settings → Updates → Update** pulls `main`, rebuilds and restarts (or
`npm run pull` in a terminal).

## Take the tour

Meet the crew: you talk to the Orchestrator, and it hands the work to five roles (Strategist, Scout, Artisan, Sentinel,
Herald) that split it into child chats you can watch and report back.

<p align="center"><img src="docs/screenshots/crew.webp" alt="The six roles: Orchestrator, Strategist, Scout, Artisan, Sentinel, Herald" width="544"></p>

### The Orchestrator and Flash

The **Orchestrator** is where work starts: it plans, hands each job to the right role, answers their mail and tells you
what is waiting. **Flash**, the tab next to it, is the "btw": a quick read-only agent on its own model that sees the
Orchestrator's conversation and answers side questions in seconds, without touching it. Use it to plan, research or
ask for advice; when the talk turns into real work, "Make it a job" has Flash write a proper brief from the whole
conversation (goal, context, what to do, constraints, done when) and drops it in the Orchestrator's input, unsent.

<p align="center"><img src="docs/screenshots/orchestrator-flash.webp" alt="The Orchestrator's column with its subagents and a decision, and Flash beside it" width="760"></p>

It also knows the app inside out. "Where is the spending limit?", "turn notifications off", "give the Scout the GitHub
connector", "add this MCP server": it reads the app's live map and changes the setting for you, with an Undo. Secrets
stay yours, and a server it adds stays off until you read its command and click **Activate**.

### Plan mode

Tick **Plan** and a Strategist takes the job: it reads the code, asks you at least three real questions (goal, scope,
constraints, what "done" means; say "enough questions" to stop it), then proposes a short plan, each step
with the role that will do it. You approve it in the questions window, and only then does it start the other agents,
as the tree of thread cards at the top of this page, its steps ticking off on its strip.

<p align="center"><img src="docs/screenshots/plan.webp" alt="The questions window: a Strategist's four-step plan to approve, each step with its role" width="560"></p>

### Memory you swipe

Everything the agents learn lands as a card: a fact, a skill, a rule, a setting. Swipe right to keep it, left to drop
it (or ✓ / ✕, or the arrow keys, with Z to undo), and every card says who proposed it, in which chat and when. Behind
the deck, one hub with tabs (Approved, Skills, Rules, Scripts & Queries, Ideas, Files, Statistics) under a
header whose counters move while the agents work.

<p align="center"><img src="docs/screenshots/memory.webp" alt="Memory: the live header with its counters, the tabs, and a proposal card swiped toward APPROVE" width="560"></p>

### Quality you can measure, a brain that tidies itself

**Quality**, a tab of **Trends**, counts the AI's mistakes instead of its compliments: errors you had to catch yourself per 100 turns, rules
that actually stopped their error (or didn't, within 14 days), PRs held by a failed build or QA, bugs that came back.
Every number says where it comes from and how many cases it covers, and "Discuss" hands it to the Orchestrator.

Then press **Maintenance** and walk away. The free part merges duplicate skills, files lessons from your corrections and
moves scripts and ideas where they belong; then an invisible agent (capped at $5) looks for improvements and app
bugs. When it found something you get a little party, and every change has a reason and an Undo.

<p align="center">
  <img src="docs/screenshots/quality.webp" alt="The Quality page: errors you had to catch per 100 turns and the rules whose error came back, each with its source" width="420">
  <img src="docs/screenshots/maintenance.webp" alt="The Memory page with the «Maintenance done» notice: one proposal and three issues to open" width="420">
</p>

### Agents that level up

Every role earns its level from verified outcomes only, never from vibes: a delegated job counts when its parent's
work checks out, and the Sentinel, the one who judges, is judged by what happens next. Each card shows the level and a
performance %. Reviews are cheap: free signals first, then a sample of finished runs reviewed together in one quiet
session on the first idle moment of the night (or after you turn the PC back on), never shown on the Grindhouse.

<p align="center"><img src="docs/screenshots/agent-levels.webp" alt="Agent cards for the Orchestrator, the Artisan and the Sentinel, each with its level, verified successes and performance percentage" width="720"></p>

### Emoji instead of essays

Say "thanks" and you get a 🙏, a 🎉 or a 🫡 on your message (whatever fits), not a paragraph of pleasantries. Any agent
with nothing to add reacts instead of replying, on every engine, so those tokens go to work instead.

<p align="center"><img src="docs/screenshots/reactions.webp" alt="A thanks to the Orchestrator answered with a 🙏 reaction under the message" width="520"></p>

### Talk to it

Two ways to use your voice:

- **Dictation.** Hit **Ctrl+M** (or the mic in the field) and speak into the Orchestrator or Flash: it types, you send.
- **Voice conversation.** Switch it on in Settings → Voice, or **Ctrl+Shift+Space**, and just talk: what you say goes
  to the Orchestrator, and its answer is read out loud sentence by sentence while it is still writing. Talk over it and
  it shuts up and listens (we wish people did that). Question cards are read to you, and a spoken "yes" or "no" counts
  as the click.

Whisper hears you and Piper speaks (a choice of Italian voices), both on your PC: no audio leaves it, and it costs
nothing. The app never starts talking on its own.

<p align="center">
  <img src="docs/screenshots/voice-talk.webp" alt="The Orchestrator in a voice conversation: the spoken question, its answer, the red Listening bar" width="400">
  <img src="docs/screenshots/voice.webp" alt="Settings, Voice: voice conversation, Fast or Accurate transcription, the Italian voice and the microphone" width="440">
</p>

### Automated tests in a real browser

Ask for a QA run and the agent opens your test environment in a browser tab inside the app, next to its chat: it
navigates, clicks, fills forms and takes screenshots on its own, and every step shows on its strip. The tab says which
chat is driving it, and the evidence (screenshots, the failing value) lands in the report. Here the QA agent re-ran test
case 7 and caught a refund that ignores the original discount.

<p align="center"><img src="docs/screenshots/browser.webp" alt="Automated test: the QA chat on the left, the test environment's refund page it drives on the right, with the wrong refund total in red" width="760"></p>

### Calls, written down

**Record call** grabs your mic and the PC's audio (Teams, Meet, whatever), and Whisper writes the transcript locally,
"You" and "Others", at zero tokens. Later you just tell the Orchestrator "open a bug from this morning's call".

<p align="center"><img src="docs/screenshots/recordings.webp" alt="The Recordings page: a call transcribed with You and Others lines, search, Ask the Orchestrator" width="640"></p>

### The brain map

Notes, chats, agents and tools as a 3D map you can spin, glowing along the links where the work is happening right now.

<p align="center"><img src="docs/screenshots/brain-map.webp" alt="The 3D brain map: notes, chats, agents and tools linked, the live ones glowing" width="640"></p>

### Trends: the numbers in one place

**Trends** puts the statistics on one page with tabs: **Costs** (where the money went, which chat's context is getting
heavy), **Quality** (with the classifiers), **Learning** and **Usage**. Usage counts which pages and actions you really
open, on your PC only, so deciding what to keep rests on numbers, not guesses.

<p align="center"><img src="docs/screenshots/trends.webp" alt="Trends, the Usage tab: the pages and actions opened in the last 14 days, most used first" width="640"></p>

### Classifiers: small decisions, zero tokens

Not everything needs a model. Small sorters on your PC decide the kind of work, how long and how much a job will
probably take, and which mail the Orchestrator reads now or later; the model itself is simply the one on the agent's
card. The Classifiers section of Quality shows each sorter as a card: how many decisions, how often it got them right,
how many of those chats succeeded (only verified ones count), the last 8 weeks, and what you could change.

<p align="center"><img src="docs/screenshots/classifiers.webp" alt="The Classifiers section: decisions made, verified outcomes, and the Kind of work card with its 8-week trend" width="640"></p>

### Learn what your agents built

The agents wrote the code; now you want to understand it. **Learn** has one field: paste a PR link, a concept or a long
text, drop in files or folders, and it explains it piece by piece on a blackboard: flowcharts, sequence and state
diagrams, timelines, mind maps, highlighted code, formulas and charts that grow as you go, out loud if you like. Your
files can drive a web search for the public standards and libraries they use (only filtered public terms leave your PC,
shown as chips). "Explain it better", "Give me an example" or "Show me the code" when you're lost; quizzes of several
kinds (choice, true or false, complete the code, put in order) to see if it stuck; a score that tells you honestly what
you still remember; at the end you explain it back. A quality check rewrites weak pieces before you see them, and every
lesson is saved and reopens where you left it.

<p align="center"><img src="docs/screenshots/learn.webp" alt="A Learn lesson about a PR: the blackboard diagram, piece 2 of 3, and the buttons Got it, Explain it better, Give me an example, Show me the code" width="640"></p>

### Nothing happens off the record

The **Log** shows everything the app did, live: who chose whom, what it cost, which answer was a duplicate. **Costs**
in Trends tells you where the money went and which chat's context is getting heavy. Both read local data and spend
zero tokens.

<p align="center">
  <img src="docs/screenshots/log.webp" alt="The Log page: today's events, tasks, flags and the chain of a delegated task" width="420">
  <img src="docs/screenshots/costs.webp" alt="The Costs page: spending per chat today and the context each chat is using" width="420">
</p>

### Routines, run from the terminal

Prepare a routine package with the Orchestrator, export it, and run it anywhere with `routine run`, `watch` or
`resume`. The app never runs routines by itself: it just shows a run's steps, screenshots and evidence when you open it.
How-to: [packages/routine-runtime](packages/routine-runtime/README.md).

### Lost? There's a guide

Every concept of the app as a card: how it works, an everyday analogy, the source files. **Discuss** sends the card to
the Orchestrator to explain it your way.

## Also on board

- **Answer with one key.** Questions and permissions show up as cards in one window, with an estimate before and a
  verdict after.
- **A browser of your own.** The Browser page is your everyday browser, with bookmarks, sessions and passwords the
  agents never see; lend them one tab when you want.
- **Settings that find themselves.** One page with a section list, search that highlights the matching row, instant
  save with Undo.
- **Connectors in one paste.** Paste a README's JSON, a command line or a URL and the MCP server is ready; switch it on
  per role. The Orchestrator can set one up for you too.
- **Tasks.** The Task page lists your Azure DevOps work items and PRs, with builds, votes and QA results.
- **Copy any file.** The copy icon in the file viewer puts the file on the clipboard: its text, the image, or the file
  itself.
- **A brain in plain Markdown.** Notes, rules, skills and scripts live in a folder you own, readable without the app.
- **Your own logins.** It drives the official CLIs with your account and never touches their settings. The UI speaks
  Italian, English and German.

## The rest

Everything else lives where agents (and the occasional human) can find it: [AGENTS.md](AGENTS.md) for the rules and
commands, [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow, [docs/architecture.md](docs/architecture.md) and
[docs/adr/](docs/adr/) for the why, [CHANGELOG.md](CHANGELOG.md) for the what. Just the brain, without the app:
`node brain-template/install.mjs`.

Use it at your own risk: agents run commands on your machine with the permissions you give them, so read what they
propose before you approve it. Check the Anthropic, OpenAI and Cursor terms before you use it with a subscription.

## License

[MIT](LICENSE)
