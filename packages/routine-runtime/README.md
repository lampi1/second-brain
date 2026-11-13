<!-- The terminal guide of the routine runtime (ADR 0175): install, run a package exported from the app on any machine
     (a VM included), and the run / resume / watch commands. Read by people; the same commands the app shows. -->
# routine: run routine packages from a terminal

A routine package is a folder with a `routine.json` (or the `.zip` the app exports). `routine` runs it with the same
runtime as the app. Each step is a plain Claude Code session (`claude -p`). A step is done when it writes
`step-result.json`. The runtime does the DevOps writes. When a step needs a person, the runtime asks in a DevOps
comment and waits for the answer there. No app and no brain folder are needed.

## Install (once per machine)

Needs Node 20 or later, git, and Claude Code logged in (`claude`, then `/login`).

PowerShell 5.1 (Windows), one line at a time:

```powershell
git clone https://github.com/lampi1/second-brain.git
cd second-brain\packages\routine-runtime
npm install
npm run build
npm link
```

Linux / macOS:

```sh
git clone https://github.com/lampi1/second-brain.git
cd second-brain/packages/routine-runtime
npm install && npm run build && npm link
```

Install the browser, only for packages with browser steps. On Windows this is optional, because Edge is used when
Playwright's Chromium is missing:

```sh
npx playwright-core install chromium
```

Check: `routine --help`.

## Get a package onto the machine

1. In the app, export the routine from its Routine page. This gives a `.zip` with `routine.json` inside.
2. Copy the zip to the machine (VM, server, another PC).
3. Open `routine.json` and replace every `<set-by-user>` value: the site login (`credentials`), the DevOps PAT
   (`secrets.devopsPat`) and the test DB logins. The file then holds secrets: keep it out of git and shared folders.
   The runtime masks these values as `***` in every run file. `routine` refuses to start while any
   `<set-by-user>` is left, and prints which field to fill.

## Commands

| Command | What it does |
|---------|--------------|
| `routine run <package> [--input name=value]... [--from-step <id>]` | One run. Ctrl+C stops it; the run can be resumed later. |
| `routine resume <run folder>` | Continues a run from the step that did not finish. |
| `routine watch <package>` | Polls the package's DevOps trigger and starts one run per new work item. Ctrl+C stops cleanly. A restart never runs an item twice. |

`<package>` is a folder, its `routine.json`, or the `.zip`.

Options for every command:

- `--runs-dir <folder>`: where runs are kept (see below).
- `--headed`: show the browser window.
- `--test-dbs <file.json>`: the test databases this machine trusts, as a list of `{"server","port","database"}`.
- `--engine claude`: the only engine for now. `--engine cursor` is refused.

While a run is going, the terminal shows the current step (`Passo 2 di 5: … · in corso 4 min`) and the last
action. When a person is needed, it shows the DevOps comment to answer. At the end it prints the path of `report.md`.

Exit codes: 0 done, 1 failed or refused by preflight, 2 wrong command line, 130 stopped with Ctrl+C.

## Where runs go

Each run gets its own folder: `<runs dir>/<routine id>/<run id>/`. Inside are `run.json`, `report.md`,
`events.jsonl`, and `steps/NN-<step>/`. A step folder holds `prompt.md`, `transcript.jsonl`, `step-result.json`
and `evidence/`.

The default runs dir is set by `defaultRunsDir()` in `src/paths.ts`:

- Windows: `%LOCALAPPDATA%\routine-runtime\runs`
- macOS: `~/Library/Application Support/routine-runtime/runs`
- Linux: `$XDG_STATE_HOME/routine-runtime/runs` (default `~/.local/state/routine-runtime/runs`)

`ROUTINE_RUNS_DIR` or `--runs-dir` overrides it.

## Try the demo

`demo/routine.json` has two steps:

1. Sign in to the Air test site and save a screenshot. This step uses the routine browser.
2. Read work item 126308 from DevOps with the PAT.

Copy the folder, fill its `<set-by-user>` values, then:

PowerShell 5.1:

```powershell
Copy-Item -Recurse .\demo $env:USERPROFILE\routine-demo
notepad $env:USERPROFILE\routine-demo\routine.json
routine run $env:USERPROFILE\routine-demo
```

Linux / macOS:

```sh
cp -r demo ~/routine-demo && ${EDITOR:-nano} ~/routine-demo/routine.json
routine run ~/routine-demo
```

The screenshot is at `steps/01-air-login/evidence/air-home.png`. The work item is in
`steps/02-work-item/evidence/work-item.md`.

`demo/fake-claude.mjs` is a stand-in for the Claude CLI, used by the tests. It spends no tokens and needs no login.

## Developers

- Build: `npm run build` creates `dist/routine.mjs` (the command) and `dist/routine-mcp.mjs` (the runtime's MCP
  servers: `routine-browser`, `routine-devops`, `routine-testdb`).
- Tests are in the app repo's `test/unit/routine-runtime/`. Decisions are in ADR 0175 and 0176.
