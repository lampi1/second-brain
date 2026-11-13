<!-- How to report a vulnerability and what the app's security baseline is; for users and security researchers. -->
# Security

## Reporting a vulnerability

Do not open a public issue. Report it privately from the repository's **Security** tab
([Report a vulnerability](https://github.com/lampi1/second-brain/security/advisories/new)) and give the maintainer
time to fix it before you publish anything. Say which commit you tested, what an attacker needs, and what they get.

Only `main` is supported: fixes land there.

## What the app does on your machine

second-brain starts AI agents that run commands, edit files and drive a browser with your own accounts. That is its
job, not a bug. What counts as a vulnerability is anything that gets around the lines below:

- The renderer runs with context isolation, a sandbox and a CSP; every IPC call is checked for its sender.
- The local MCP server listens on 127.0.0.1 only, with a token per chat.
- Secrets never go to logs or to plain files; the app handles credentials only in the cases its rules list
  (`docs/agents/rules.md`, rule 2), encrypted with the system keychain.
- The app never changes the settings, hooks or config of Claude Code, Codex, Cursor or OpenCode.
- The Orchestrator never grants, on the user's behalf, a permission that touches production, a database or Azure
  without the user's own yes (ADR 0275).
- An MCP server added by an agent stays off until the user reads its command and activates it.

## The guard

The repository is public, so git hooks scan every commit and push for secrets and personal data
(`tools/guard/scan.mjs`, set up by `npm run setup`). Never bypass them with `--no-verify`.
