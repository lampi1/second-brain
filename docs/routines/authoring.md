# Authoring a routine package

How a routine is written (ADR 0175, 0176): by the Orchestrator from the user's plain-language need, or by hand. The
Orchestrator reads the same rules live (`app_routine_capabilities`, `app_routine_connectors`, the `app_guide` topic
"routine"); this page is the long form, with two worked examples that pass the preflight in the unit tests
(`test/unit/routine-examples.test.ts`).

## The model

- A routine is a **package**: one `routine.json` (and the secrets the user typed into it). Only the terminal CLI
  (`routine run`, `watch`, `resume`) executes it through `packages/routine-runtime`; the app prepares packages and reads run evidence on demand.
- Each **step is one plain Claude Code session**: a prompt, an optional model and effort, the Claude Code tools it may
  use (`allowedTools`), the MCP servers the package declares. No app roles, no app chats, no app tools, no approval
  steps.
- A step **ends by writing `step-result.json`** in its folder: `{outcome: done|failed|needs-human, summary, evidence,
  question?, devopsWrites?}`. The runtime appends this contract to every prompt; a prompt only says the job and what
  "done" means.
- **DevOps writes** (comment, state, fields, tags) are listed in `devopsWrites`; the runtime does them, on the run's own
  work item, within the grant in `routine.devops`. A step never calls DevOps to write.
- **A person is asked** with `outcome: "needs-human"` and a `question`: the runtime comments on the work item
  mentioning `escalation.contact`, polls for the answer and runs the step again with it.
- **Secrets are the user's.** Site passwords, the DevOps PAT and test DB passwords are typed by the user on the Routine
  page (or into `routine.json` in a terminal). An author leaves them out or writes `<set-by-user>`.

## Shape

```text
{ format: "second-brain-routine", schemaVersion: 1,
  routine: { id, title, description,
    inputs: [{ name, label?, required?, default? }],          // a step reads {{name}}; workItem = the run's work item
    steps: [{ id, title, prompt, model?, effort?, allowedTools?, mcpServers?, testDbs?, browser?: true,
              timeoutMs?, maxAttempts? }],
    trigger?,      // DevOps: one run per matching work item
    devops?,       // what the runtime may write on that item
    escalation?,   // who is asked on DevOps when a step needs a person
    mcpServers?,   // stdio MCP servers of the package (never the app)
    testDbs?,      // read-only TEST databases
    browser?,      // { origins }: the runtime's own browser
    loginSuccess?  // per-login success rule (AJAX login pages)
  },
  credentials?: [{ loginUrl, user, password }],
  secrets?: { devopsPat?, testDbs?: { <id>: { user, password } } } }
```

Placeholders: `{{<input>}}` for each declared input; `{{workItem}}`, `{{work-item-id}}`, `{{work-item-url}}` need a
trigger or a `workItem` input.

The runtime adds to each prompt: the inputs, the work item (title, description, repro steps, acceptance criteria), the
earlier steps' summaries, the test DB and browser notes, a person's answer, the previous failure on a retry, and the
`step-result.json` contract. It does not copy `files[]` into the session yet: put the know-how a step needs in its
prompt.

## The runtime's servers

A step gets these by declaring them, never by adding them to `routine.mcpServers` (the names are reserved):

| Server | How a step gets it | Tools |
|--------|--------------------|-------|
| `routine-devops` | the run has a work item | `get_work_item`, `get_work_item_comments`, `get_attachment` (read only) |
| `routine-testdb` | the step lists ids in `testDbs` | `test_db_query` (read only, TEST databases only) |
| `routine-browser` | the step has `browser: true` and the routine `browser.origins` | `navigate`, `snapshot`, `click`, `type`, `select_option`, `screenshot`, `login`, `fill_secret` |

Allow their tools with `mcp__<server>__*` in `allowedTools`.

**The browser signs in by itself**, host side, with the package credential whose `loginUrl` origin is in
`browser.origins`: it opens the stored `loginUrl` with its query (Air: `…/Account/Login?mode=local`) and, for AJAX
login pages, uses `loginSuccess` (Air: success = the URL leaves `/Account/Login`). The session never sees a password
and `type` refuses password fields. A prompt says "the browser is already logged into <site>"; never login steps,
credentials or selectors.

`browser.hide` (optional): CSS selectors of overlays the runtime hides on every page, so they never cover what a step
clicks (Air: `["#draggable", "ai-chat"]`, the Maia chat). Plain selectors only (no braces).

## Workflow (the Orchestrator)

1. Ask the user only what the need leaves open: inputs, the site and its test account, the DevOps project, area,
   states and tags, who is asked when a person is needed (a DevOps identity GUID: never guessed).
2. Write the know-how into the step prompts (read the brain now: a run never reads the brain).
3. `app_routine_save { package }` (or `packagePath`, a JSON file inside the brain; `dryRun: true` only checks). It runs
   the preflight:
   - `invalid`: each error has `path`, `message` and `fix`; fix them and propose again. Nothing was saved.
   - `needs-secrets`: saved in `<userData>/routines/<id>/routine.json`; the errors marked `secret: true` are the
     values the user types on the Routine page. Tell them which.
   - `ready`: saved.
4. A password or PAT in a proposal is refused. A revision of the same routine id keeps the secrets the user already
   stored (same `loginUrl` and user; same test DB id and user).
5. Saving runs nothing and switches no trigger on: the user executes `routine run`, `routine watch` or `routine resume` in a terminal. The app never launches the CLI.

## Example 1: Air bugfix (DevOps, browser, escalation)

[`examples/air-bugfix/routine.json`](examples/air-bugfix/routine.json). The need: "every new Air bug tagged
ai-fixable: reproduce it on the test site, fix it with a test on a local branch, comment and move it to Active; ask me
on the bug if the repro is unclear".

- `trigger`: Bug, state `New`, tag `ai-fixable`, at most 4 per hour; `devops` grants `comment` and `state` only.
- `reproduce` (`browser: true`): follows the repro steps on `https://air.example.test`, already logged in; screenshots
  are evidence; unclear steps → `needs-human` with one question.
- `fix`: branch `bugfix/{{work-item-id}}` in `{{repoPath}}`, root cause, a failing-then-passing test, a local commit;
  never pushes.
- `report`: `devopsWrites` = one Italian comment + state `Active`.
- `credentials`: the exact Air login URL with `?mode=local`, user only; `loginSuccess`: `urlNotContaining
  "/Account/Login"`. `escalation.contact` is a placeholder GUID: replace it with the user's DevOps identity id.
- Preflight: only the two secrets are missing (the site password and the PAT), which the user types.

From an old role-based export: `convertFlowToPackage` (`packages/routine-runtime/src/format.ts`) gives a starting
package (roles, tiers and approval steps dropped, the notes say what); then rewrite each step as a self-contained
prompt and add the browser, the login and the escalation, as this example does.

## Example 2: release notes (no DevOps, no secrets)

[`examples/release-notes/routine.json`](examples/release-notes/routine.json). The need: "from a local repo, Italian
release notes between two tags". Three inputs (`repoPath`, `from`, `to` with default `HEAD`), one step with
`git log` only, the result saved as evidence. Preflight: ok, nothing to type.

## Never

- App roles (Orchestrator, Strategist, Scout, Artisan, Sentinel, Herald) or `role`, `tier`, `engine` fields.
- App tools (`agent_*`, `app_*`, `flow_*`, `browser_login`, `handoff_to_user`, `mcp__second-brain__*`), or an MCP server
  pointing at the app.
- Approval or manual steps: a person is asked through `needs-human`.
- Passwords, PATs, production databases, production commands.
