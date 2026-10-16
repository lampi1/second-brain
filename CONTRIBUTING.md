# Contributing to second-brain

Thanks for looking around. This guide gets you from a fresh clone to a merged change. AI agents working on the repo
follow [AGENTS.md](AGENTS.md), which has the same rules in a denser form.

## Set up

```powershell
git clone <repo url>; cd second-brain
npm run setup          # npm ci with install scripts off (.npmrc) + Electron's checksummed binary + the guard hooks
npm run demo           # build + the app on fictional data: no CLI, no login, no tokens
npm run doctor         # what is missing on this machine (Electron, build, CLIs, logins, brain, MCP port)
```

Windows 10/11 and Node.js 22+. To use real chats you need the Claude Code CLI and/or the Cursor CLI (`agent`), logged
in with your own account; the demo and every test except `test/live` need neither.

Useful environment variables: `SB_DEMO=1` (fake services), `SB_DEMO_FREEZE=1` (fixed clock and data),
`SB_HIDDEN=1` (window off screen and never focused: agents and tests), `SB_USER_DATA=<dir>` (an isolated profile),
`SB_BRAIN=<dir>` (a brain folder), `SB_MCP_PORT=0` (a random MCP port).

Your own brain starts from the template in this repo: `node brain-template/install.mjs` (see the README).

### The guard (optional config, per PC)

The repository is public, so `npm run setup` turns on two git hooks (`core.hooksPath .githooks`):
`pre-commit` scans what you stage and `pre-push` scans every commit you are about to push (files and their names, message,
author and committer, and the branch and tag names) for secrets and personal or company data, with `tools/guard/scan.mjs`. Two settings are optional, per
clone, and yours to set (setup only prints them):

```powershell
git config guard.denyList "<path to your deny list>"   # words that must never be published, one per line, kept outside the repo
git config guard.email "<you>@users.noreply.github.com" # the only e-mail allowed on your commits
git config user.email "<you>@users.noreply.github.com"
```

A deny list that is set but missing blocks every commit and push (it is never skipped). A block prints the file, the
line and the rule, never the matched text, and how to fix it: edit the line, or, only for a proven false positive, add
the printed line (`path rule sha256:…`) to `.guardallow`, which is reviewed like code. Commit messages and identities
are never silenced. Do not bypass the hooks with `--no-verify`: CI scans the whole history again. `npm run doctor`
shows whether the hooks are on and the config is readable.

## Workflow

1. Branch from `main` (`feat/<topic>`, `fix/<topic>`). Several people or agents at once: one git worktree each
   (`git worktree add ../second-brain-wt/<topic> -b feat/<topic>`).
2. Make the change with its tests (below).
3. `npm run check:branch`: typecheck, lint of the changed files, the unit tests related to them and the guard on them.
   No e2e: the e2e suite runs only on `main` (ADR 0027). This is what a branch needs.
4. Look at the change in the running app (`SB_HIDDEN=1 npm run dev`, a screenshot): a green check on a broken-looking
   screen is not done.
5. Push your branch (the pre-push guard scans every new commit) and open a pull request with the template filled in. After a merge, `npm run check` (everything, including the whole e2e
   suite) runs on `main`. Run heavy suites one at a time: two e2e runs on one machine make each other flaky.

Commits follow [Conventional Commits](https://www.conventionalcommits.org): `feat(chats): …`, `fix(browser): …`,
`test(e2e): …`, `docs: …`, in English, the subject saying what changes for the user.

## Adding a feature, contract first

Main, preload and renderer talk only through `src/shared/contract.ts`. A new capability goes in this order:

1. **Contract.** Add the data shapes, then the channel: a request/response in `InvokeMap` (and its name in
   `INVOKE_CHANNELS`), or a push from main in `EventMap` (and `EVENT_CHANNELS`). Channel names are `area:verb`. The
   compiler now fails until both sides exist.
2. **Main.** Put the logic in a module under `src/main/<area>/` behind an interface in `services.ts`, wire it in
   `wiring.ts`, and add the handler to the `handlers` object in `index.ts`. `ipc.ts` registers every channel with the
   sender check: never call `ipcMain` or `ipcRenderer` anywhere else.
3. **Demo.** Give the demo services (`src/main/demo.ts`, `demo-wiring.ts`) believable fictional data for it, so the UI,
   the e2e tests and the README screenshots can show it without a CLI.
4. **Renderer.** Call it with `sb.invoke('area:verb', …)` / `sb.on('area:event', …)` from `src/renderer/sb.ts`; keep
   state in the store (`src/renderer/store/`). The renderer never imports main, preload, Node or Electron (lint
   enforces it).
5. **Tests**: a unit test for the module, an e2e spec with a screenshot for what the user sees.
6. **Decision**: if you chose between real alternatives, add an ADR.

## Tests

| Kind | Where | Run | Notes |
|------|-------|-----|-------|
| Unit | `test/unit/` | `npm test`, or `npx vitest run <file>` | Vitest in Node; every module has them |
| End-to-end | `test/e2e/` | `npm run test:e2e`, or `npx playwright test <spec>` after `npm run build` | Playwright drives the real Electron app, hidden, with an isolated profile; `launchDemo()` in `helpers.ts` starts the frozen demo |
| Visual baselines | `test/e2e/ui.spec.ts-snapshots/` | part of e2e | Windows rendering; update with `--update-snapshots` only for an intended UI change, and look at the diff |
| Live | `test/live/` | `SB_LIVE=1 npx vitest run test/live` | real Claude CLI, spends real tokens: opt-in only |
| README screenshots | `test/shots/` | `npm run shots` | writes `docs/screenshots/*.webp` from the frozen demo |

Rules: every user-visible feature has an e2e test that takes a screenshot (`shot(page, 'name')`); tests never show a
window or take focus (`SB_HIDDEN=1` is set by the helpers); no test spends tokens unless it lives in `test/live`;
fixtures are fictional (example.com, "Alfa", made-up names), never real people, customers or paths.

## Code style

- Every file starts with a header comment: what it does, why, who uses it.
- TypeScript strict; small modules; prefer 100 lines of our own over a package with a large tree.
- Logs through `src/main/log.ts` (`log.warn('scope', 'message', { cause, hint })`): an error says its cause and what to
  do about it. No secrets in logs, ever.
- New runtime dependency: well known, exact version, published at least 14 days before you add it
  (`npm install --save-exact --before=<date>`), plus one line in an ADR saying why.
- Security baseline (`contextIsolation`, `sandbox`, CSP, IPC sender check, MCP on 127.0.0.1) is never relaxed.

## Decisions (ADRs)

`docs/adr/NNNN-short-title.md`, numbered in order: **Context** (the problem and the forces), **Decision** (what we do,
precisely), **Consequences** (what it costs, what it enables). Read the ADRs of the area you touch first: most "why is
it like this?" questions are answered there.

## A map of the modules

Good places to start are marked ★: self-contained, well tested, easy to verify with a screenshot.

| Area | Where | What lives there |
|------|-------|------------------|
| Contract | `src/shared/contract.ts` | every data shape and IPC channel |
| Chats | `src/main/chats/` | Claude (stream-json) and Cursor (ACP) sessions, the chat manager, mail between chats, hand-offs of long chats, warm engine, cost |
| Browser | `src/main/browser/` | tabs as WebContentsViews, trusted input over CDP, page snapshots and refs, environments and logins, hand-offs to the user |
| MCP | `src/main/mcp/`, `src/main/appctl/` | the local MCP server (per-chat endpoints with tokens) and the app-control tools for agents |
| Brain | `src/main/brain/` | the brain folder, live feed, notifications, usage, costs, budgets, estimates, quality, model routing |
| DevOps ★ | `src/main/devops/`, `src/renderer/brain/pages/` | the DevOps page: model, service, demo data |
| Esegui | `src/main/run/` | running a chat's shell block on the user's click, the result back to the chat |
| Search ★ | `src/main/search/` | the Ctrl+K full-text index |
| Skills ★ | `src/main/skills/` | the skills and agents page |
| Migliora l'app | `src/main/improve/` | the app's own Regia, branch stages, promotion |
| Renderer shell | `src/renderer/components/`, `store/`, `lib/` | tiles, views, Regia widget, panels, palette; one external store; pure helpers (★ `lib/` is all unit-tested) |
| Brain pages | `src/renderer/brain/` | today, to-do, ideas, explore, 3D map (`map/`), Qualità, Costi |
| Demo | `src/main/demo*.ts` | fake chats, browser pages and brain for `npm run demo`, tests and screenshots |
| Scripts | `scripts/` | build, light check, doctor, logs, release (promote/rollback), demo, screenshots |

Ideas that fit a first contribution: an English string table for the UI (start from one page), a new `doctor` check,
more demo data for a page that looks empty in `npm run demo`, an e2e spec for a flow that only has unit tests.

## Reporting bugs and security issues

Bugs and ideas: open an issue with the template. Security problems: do not open a public issue; report them
privately from the repository's **Security** tab ("Report a vulnerability") and give the maintainer time to fix them.
