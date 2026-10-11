# second-brain

A personal operating system for working with AI agents, in two parts:

- **The app** (`src/`, Electron, Windows first): a desktop cockpit where your Claude Code and Cursor chats run as
  tiles, their questions and permission requests show up as panels, agents drive internal browser tabs over MCP, and
  your brain folder updates live.
- **The brain template** (`brain-template/`): an empty "second brain" folder with the method already in it: memory
  files (open threads, journal, ideas, AI errors and praise, reflections), the rules for how the brain is changed,
  specialist agents (reviewer, code investigator, brain editor, flow optimizer), hooks, Claude/Cursor adapters and
  generic tools (mail between chats, memory lines, new-chat prompts, daily brief, costs, lint, a local site).

The brain is data, the app is product: this repo ships the product, empty. Your brain fills up by use.

## Requirements

- Windows 10/11 (the app is tested there first), Node.js 22+, Git.
- At least one harness, each with **your own** login: Claude Code (`claude`, logged in with your account) and/or the
  Cursor CLI (`agent`, logged in with your account).

## Install

1. Create your brain (guided: name, folder, repos folder, Claude and/or Cursor; it writes your `me.md`):
   ```
   node brain-template/install.mjs
   ```
   It asks before touching anything in your home folder (`~/.claude`, `~/.cursor`), and backs up every file it changes.
2. Open a chat in the new brain folder and ask "cosa devo fare oggi?". The agents read `AGENTS.md` and grow the brain
   from there (`now.md`, `journal/`, `ideas.md`...).
3. The app (optional): `npm run setup`, `npm run build`, `npm start`. Point it to your brain folder in the settings.
   Development commands, checks and architecture: `AGENTS.md`, `docs/architecture.md`, `docs/adr/`.

## Limits

- **Use at your own risk.** This is a personal project, provided as is, without warranty (see `LICENSE`). Agents run
  commands on your machine with the permissions you give them: read what they propose before you approve it.
- **Logins and terms of service**: the app never handles credentials: it starts the official `claude` and `agent`
  CLIs, each with the user's own login. Anthropic's terms do not allow third-party products to offer Claude.ai
  (subscription) login to their users; this app only drives the CLI you installed and logged into yourself, for your
  own use. Check the current Anthropic and Cursor terms before you use it with a subscription, give it to others or
  build on it.
- **Each harness spends only its own tokens**: a Claude chat never runs Cursor and vice versa (`vendor-guard` hook).
- **Production safety is text plus hooks**: the rules in `me.md` "Safety" and the guards in `.claude/hooks/` and
  `harness/cursor/prod-guard.mjs` reduce risk; they are not a sandbox. Keep auto-run off for commands that touch
  production.
- The rules and tools carry dated design notes from the method's first user; they are written in English and Italian.

## Publishing safely

`tools/guard/scan.mjs` blocks a publish when the tree or the git history carries secrets, personal paths, e-mails,
real GUIDs, internal hosts or words from a private deny list (`node tools/guard/scan.mjs . --history --deny <file>`).
False positives are silenced only in `.guardallow` (`<path glob> <rule>`), never by weakening a rule.

## License

MIT (`LICENSE`).
