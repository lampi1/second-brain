<p align="center">
  <img src="build/icon.png" width="96" alt="second-brain icon">
</p>

<h1 align="center">second-brain</h1>

<p align="center">
  <b>One desktop cockpit for all your AI coding agents.</b><br>
  Run Claude Code, Codex and Cursor agents side by side, answer every question they ask from one place,<br>
  watch the browsers they drive, and keep a second brain that makes them better every week.
</p>

<p align="center">
  <a href="#download"><b>Download</b></a> ·
  <a href="#try-it-in-2-minutes"><b>Try the demo</b></a> ·
  <a href="#build-it-yourself"><b>Build from source</b></a> ·
  <a href="#update"><b>Update</b></a> ·
  <a href="CONTRIBUTING.md"><b>Contribute</b></a>
</p>

<p align="center">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg">
  <img alt="Platform: Windows 10/11" src="https://img.shields.io/badge/platform-Windows%2010%2F11-0078D6.svg">
  <img alt="Linux and macOS: built for, not yet tried" src="https://img.shields.io/badge/Linux%20%C2%B7%20macOS-not%20yet%20tried-lightgrey.svg">
  <img alt="Node 22+" src="https://img.shields.io/badge/node-%E2%89%A522-339933.svg">
  <img alt="Electron 44" src="https://img.shields.io/badge/electron-44-47848F.svg">
</p>

![The Grindhouse: every agent as a strip, its questions as panels, the browser it drives right under it](docs/screenshots/mosaic.webp)

When you work with five agents at once, the bottleneck is no longer the model: it is you. Which agent is waiting on
you? Which one is burning tokens in a loop? What did the QA agent see in its browser? second-brain puts every agent,
question, browser and ticket on one screen, so you spend your attention where it is needed and nowhere else.

It does not replace the agents: it starts the **official** CLIs (`claude`, `codex`, Cursor's `agent`) with **your own**
login, and it never touches their settings. Keep Claude desktop and Cursor open next to it, or close them.

> The interface is in Italian today (it started as one developer's daily tool). Code, comments, docs and commits are in
> English, and an English interface is on the roadmap.

## Download

| Version | Date | Windows installer | Source code |
| --- | --- | --- | --- |
| **0.1.0** (latest) | 2026-10-13 | coming with the published release | [zip](https://github.com/lampi1/second-brain/archive/refs/tags/v0.1.0.zip) · [tar.gz](https://github.com/lampi1/second-brain/archive/refs/tags/v0.1.0.tar.gz) |

Every version, with its notes and checksums: **[all releases](https://github.com/lampi1/second-brain/releases)** ·
what changed: [CHANGELOG.md](CHANGELOG.md).

- **Windows installer**: one offline, per-user `second-brain-<version>-windows-x64-setup.exe`. No Node.js, Git or
  admin rights needed; it includes Electron and the app. Check the file against the `.sha256` next to it in the release.
  Not code-signed yet, so Windows SmartScreen may ask you to confirm the first time ("More info" → "Run anyway").
- **Source code**: the exact code of that version, to [build it yourself](#build-it-yourself).
- The repository is private today, so these links work for people with access to it; it is meant to be open source.

## Try it in 2 minutes

No CLI, no login, no tokens: the demo runs the whole interface on fictional data.

```powershell
git clone https://github.com/lampi1/second-brain.git
cd second-brain
npm run setup      # pinned dependencies (install scripts off) + the Electron binary + the git hooks
npm run demo       # builds and opens the app with demo agents, browser tabs and a sample brain
```

You need [Node.js](https://nodejs.org) 22+ and [Git](https://git-scm.com). Windows 10/11 is the tested platform;
Linux and macOS are built for but not yet tried on a real machine (ADR 0054).

## Build it yourself

From the clone above, three commands take you from the code to your own running copy:

```powershell
npm run setup      # once (and again only if package-lock.json changes: `npm run pull` does that for you)
npm run build      # main + preload with esbuild, the React interface with Vite → out/
npm start          # opens the app; on first start a short setup window creates or links your brain
```

To use real agents, install and log in to at least one CLI yourself:
[Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`claude`), Codex (`codex`) and/or the Cursor CLI
(`agent`). The app never asks for your passwords. `npm run doctor` tells you what is still missing (Electron, build,
CLIs, logins, brain, MCP port).

### Change it

```powershell
npm run dev            # dev build + run: edit, run again, see it
npm run check:branch   # before you commit: typecheck, lint, the related unit tests, the secrets guard
```

Where things are:

| Folder | What lives there |
| --- | --- |
| `src/shared/contract.ts` | The one contract: every data shape and IPC channel. Change it first, then both sides. |
| `src/main/` | Electron main process: agent harnesses (`chats/`), browser tabs (`browser/`), local MCP server (`mcp/`), brain and costs (`brain/`). |
| `src/preload/` | The small allow-listed bridge `window.sb`. Nothing else crosses. |
| `src/renderer/` | The React interface (pages, components, Italian and English strings in `i18n/`). |
| `test/unit`, `test/e2e` | Vitest for every module, Playwright driving the real app for every visible feature. |
| `docs/adr/` | Every decision, numbered, with its reason. |

Or let the app change itself: open **Migliora l'app** and describe what you want; its Orchestrator prepares the change
on a branch, runs the checks and shows you the result before anything is merged.

Start with [CONTRIBUTING.md](CONTRIBUTING.md) (workflow, tests, ADRs, a map of the modules). AI agents working on the
repo read [AGENTS.md](AGENTS.md).

## Update

**From a clone (developers): one click.** Open **Impostazioni → Aggiornamenti**: it shows what is new on GitHub's
`main`, and **Aggiorna** downloads it, rebuilds and restarts the app on it, with no test suite. It only fast-forwards:
your local commits and uncommitted work are never merged, moved or dropped (it stops and tells you), and the
dependencies are reinstalled only when they changed. You can also write "aggiornati" to the Orchestrator, or from a
terminal:

```powershell
npm run pull       # fetch main, fast-forward, `npm ci` only when the lockfile changed, build
```

**Installed with the Windows installer:** download the newer installer from [Releases](https://github.com/lampi1/second-brain/releases).
Your brain, chats and settings live outside the install folder and are never removed by the installer. An in-app
updater that prepares the package in the background and asks you once is built, and is switched on after its Windows
restart test passes ([update integration](docs/update-integration-evidence.md)).

**Your stable copy from a clone** (ADR 0007): the same **Aggiorna** switches it to the new version at once; if the new
version does not open, the launcher goes back to the previous one. `npm run promote` does it with the full checks
first, `npm run rollback` goes back by hand.

## Features

### Agents as strips, questions as panels

Every Claude Code, Codex or Cursor agent is a strip in the **Grindhouse** with its streaming text, tool calls, diffs,
cost and context size. When an agent asks a question or a permission, it shows up as a panel right in its strip (or in
a floating layer, wherever you are in the app): answer with one key, with the context the agent had when it asked.
Strips are grouped by area and ordered by the Orchestrator; a click anywhere on one expands it inline, and it
maximizes or opens in focus mode. The globe on a strip shows the browser its agent drives beside it (expanding the
strip if needed). The sub-agents at work hang under their strip, each with the app agent it runs as, and a parent
waiting on them reads "in attesa", not "finito". Model and effort come from the agent's profile. A worker that sent
its final report to the Orchestrator and went idle closes by itself after a short delay (Settings → Archivia lavori
conclusi dopo; transcript kept, Ctrl+K reopens it); one that waits for you, a permission, colleagues or background
work stays open with an "In attesa di…" label.

### The Orchestrator: one chat that coordinates the others

![The Orchestrator, in its column on the right, with a decision waiting](docs/screenshots/regia.webp)

The Orchestrator is the chat you talk to first. It knows every agent, starts new ones from your agent catalog, routes
mail between them and tells you what needs you.

### Agents that improve, under your approval

![The Agenti page: the catalog of agents as cards, with runs, success and cost](docs/screenshots/agents.webp)

Each agent is a card with its role, engine, model and observed results (runs, success, cost); its details show the
whole prompt that makes it that agent. Agents learn from cost, time and outcome, and every proposed change to an agent
waits in **Agenti** until you approve it.

### Browsers your agents drive

![A QA agent's browser tab, big next to its chat](docs/screenshots/browser.webp)

Agents get real browser tabs inside the app through a local MCP server: navigate, click, type, read the page, take
screenshots, with trusted input like a real user. Each tab sits next to the agent that owns it. Logins persist per
environment, and when a page needs a password, MFA or a CAPTCHA the agent hands it to you: the app never types your
passwords.

### A live map of your brain

![The 3D brain map, lit where the agents are working right now](docs/screenshots/brain-map.webp)

Your brain is a folder of Markdown notes the agents read and write: open threads, journal, ideas, the errors they made
and the rules learned from them. A fresh brain starts empty: the app's own rules and tools stay inside the app
(ADR 0072). The dashboard shows it as pages, as a 2D map of its connections that fills the panel at any size, and as a 3D map
that lights up the files, tools and agents at work.

### DevOps in one page

![The DevOps page: mentions, pull requests, reviews and work items](docs/screenshots/devops.webp)

Mentions, comments and votes on your pull requests, reviews waiting for you, stuck work items, failed builds and the QA
status of each pull request, read on demand (zero tokens, read only). Every item opens its agent in one click.

### Quality you can measure

![The Qualità page: four metrics with their source and dates](docs/screenshots/quality.webp)

Four metrics computed from real logs, each with its source and the days it covers: errors you had to catch yourself
per 100 turns, rules that did not stop their error, pull requests held by QA or builds, bugs reopened after a fix.
Costs, budgets and estimates per agent and per day sit next to them.

### And more

- **Esegui**: shell blocks in a chat run with one click, and the output goes back to the chat.
- **Long chats** are handed off before the context fills: a note, then "Riprendi" in a fresh chat.
- **Model routing**: a versioned table picks engine, model and effort per kind of task.
- **Search** (Ctrl+K) across chats, browser tabs, pages and commands; an in-app **Guida** explains every concept.
- **Agent-friendly by design**: an app-control MCP server lets agents read the app state, screenshot it and drive it.
- **Screenshots everywhere**: an agent writes the path of a PNG, JPG or WebP (under the brain, the repo, a worktree or
  its evidence folder) and the app shows it as a thumbnail in the chat and in the question; Markdown and HTML reports
  open in the file viewer with their images (files beside the report or base64), never loaded from the internet. A
  click opens any of them large.

## Architecture

```mermaid
flowchart LR
  subgraph Renderer["Renderer (React, sandboxed)"]
    UI["Grindhouse · Orchestrator column<br/>Agenti · dashboard · 3D map"]
  end
  subgraph Main["Electron main (Node)"]
    CM["ChatManager"] --> CS["Claude / Codex<br/>sessions"]
    CM --> CU["CursorSession<br/>ACP"]
    BR["BrowserService<br/>tabs = WebContentsViews"]
    MCP["MCP server<br/>127.0.0.1 only"]
    BS["BrainService<br/>live feed · costs · estimates"]
  end
  UI <-- "typed IPC (contract.ts)<br/>via preload allow-list" --> Main
  CS --> C1(["claude / codex CLI<br/>your login"])
  CU --> C2(["agent CLI<br/>your login"])
  C1 & C2 -- "MCP tools" --> MCP --> BR
  BS <--> Brain[("your brain folder<br/>Markdown")]
```

Details: [docs/architecture.md](docs/architecture.md); every decision: [docs/adr/](docs/adr/).

## Security model

- Electron baseline, never relaxed: `contextIsolation`, `sandbox`, no `nodeIntegration`, a strict CSP, every IPC call
  checked against its sender, preload exposes only an allow-listed `window.sb`.
- The MCP server listens on 127.0.0.1 only, with Host/Origin checks. Per-chat browser endpoints scope browser tools to
  that chat's tabs; tokenized Orchestrator endpoints identify their caller. Generic local endpoints are also reachable
  by local processes: this is not a boundary between programs on the same computer.
- Browser tabs live in their own partition, apart from the app.
- Each CLI owns its login. API keys you type in Settings are encrypted with the OS secret store and decrypted only in
  main. App-owned conversation history is stored as plain text in your local profile: treat profile backups as private.
- No production access is wired in: no database, deploy or write-cloud commands.
- Dependencies: exact versions, well-known packages, published at least 14 days before they are installed; npm install
  scripts are off (`.npmrc`). A git hook scans every commit for secrets and personal data before it leaves your PC.

## Releasing (maintainers)

GitHub Actions are off for this repository, so a release is built on a Windows PC:

```powershell
npm run check                      # on a clean main: everything, e2e included
git tag v0.2.0                     # the version in package.json; push the tag
npm run package:windows            # Setup + update payload + checksums in test-results/installer/dist
npm run test:installer             # installs those exact bytes in a temp profile and launches them
npm run release:draft -- v0.2.0    # verifies tag, source and hashes, then creates a DRAFT release with gh
```

Review the draft on GitHub, publish it, and add its row to the [Download](#download) table. Details:
[Windows installer and updates](docs/windows-installer.md).

## Roadmap

- English interface (the strings are Italian today).
- Linux and macOS proved on real machines; installers (.dmg, .AppImage) with signing.
- More connectors behind the same interface (issue trackers beyond Azure DevOps).
- Team features: handing a to-do to a colleague, a shared team layer next to each person's brain.

## Limits

- **Use at your own risk.** A personal project, provided as is, without warranty (see [LICENSE](LICENSE)). Agents run
  commands on your machine with the permissions you give them: read what they propose before you approve it.
- **Logins and terms of service.** The app only drives the CLIs you installed and logged into yourself, for your own
  use. Anthropic's terms do not allow third-party products to offer Claude.ai (subscription) login to their users:
  check the current Anthropic, OpenAI and Cursor terms before you use it with a subscription, give it to others or
  build on it.
- **Each engine spends only its own tokens**: a Claude chat never starts Cursor and vice versa.

## License

[MIT](LICENSE)
