<p align="center">
  <img src="build/icon.png" width="96" alt="second-brain icon">
</p>

<h1 align="center">second-brain</h1>

<p align="center">
  <b>A cockpit for your AI coding agents: Claude Code, Codex and Cursor on one screen, with a brain that gets better every week.</b>
</p>

<p align="center">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg">
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
   CLI `gh`. If something is missing, tell me and install it the normal way for my OS (Windows: winget;
   macOS: Homebrew; Linux: my package manager or nvm). Ask me before installing anything system-wide.
2. Get the code. If `gh auth status` says I'm not logged in, run `gh auth login` and let me finish it myself.
   If I can't push to lampi1/second-brain (most people can't), fork it and clone my fork:
   `gh repo fork lampi1/second-brain --clone`; otherwise `git clone https://github.com/lampi1/second-brain.git`.
   Make sure `upstream` points to lampi1/second-brain.
3. Read AGENTS.md and CONTRIBUTING.md in the clone, and follow them from here on.
4. Install: `npm run setup` (pinned deps with install scripts off, the Electron binary, the git hooks).
   On Linux, if Electron fails to start, install the system libraries it asks for (e.g. libnss3, libgtk-3,
   libasound2) and try again.
5. Build and start: `npm run build`, then `npm start`. The first start opens a short setup window: I'll go
   through it myself. Then run `npm run doctor` and tell me in plain words what is still missing
   (for example: logging in to at least one of `claude`, `codex` or Cursor's `agent`, which I do myself).
6. Leave the clone ready for issues and pull requests: `gh repo view` works, `main` tracks upstream, and tell me
   the loop: a branch per change, `npm run check:branch` before committing, Conventional Commits in English,
   never `--no-verify`, the PR template in .github/. Don't push or open anything without asking me.

Finish with a three-line summary: where the code lives, how I start the app, and how I update it.
```

That's it. Updating later is one click: **Impostazioni → Aggiornamenti → Aggiorna** pulls `main`, rebuilds and
restarts (or `npm run pull` in a terminal).

## What it does

- **A crew, not a pile of tabs.** You tell the Orchestrator what you want; it hands the work to five roles
  (Strategist, Scout, Artisan, Sentinel, Herald) that split it into child chats and report back.
- **Answer with one key.** Questions and permissions show up as panels, with an estimate before ("~4 min · ~0,12 $")
  and a verdict after.
- **Browsers they drive.** Real tabs inside the app over MCP: the agents click, type and take screenshots; passwords
  stay yours.
- **A brain that learns.** Notes, rules, skills and scripts in a plain Markdown folder, shown live on a 3D map; roles
  level up only on verified successes.
- **Your own logins.** It drives the official CLIs with your account and never touches their settings. The UI speaks
  Italian and English.

<p align="center"><img src="docs/screenshots/crew.webp" alt="The six roles: Orchestrator, Strategist, Scout, Artisan, Sentinel, Herald" width="544"></p>

<table>
<tr>
<td width="50%"><img src="docs/screenshots/browser.webp" alt="A QA chat in focus mode with the browser tab it drives"><br><b>Browsers they drive.</b> A QA chat asks you something while its tab waits.</td>
<td width="50%"><img src="docs/screenshots/brain-map.webp" alt="Brain → Mappa, the 3D map of notes, agents and tools"><br><b>The brain map.</b> Notes, agents and tools, glowing where the work happens.</td>
</tr>
</table>

## The rest

Everything else lives where agents (and the occasional human) can find it: [AGENTS.md](AGENTS.md) for the rules and
commands, [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow, [docs/architecture.md](docs/architecture.md) and
[docs/adr/](docs/adr/) for the why, [CHANGELOG.md](CHANGELOG.md) for the what. Just the brain, without the app:
`node brain-template/install.mjs`.

Use it at your own risk: agents run commands on your machine with the permissions you give them, so read what they
propose before you approve it. Check the Anthropic, OpenAI and Cursor terms before you use it with a subscription.

## License

[MIT](LICENSE)
