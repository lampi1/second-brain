# ADR 0062 · Rules machinery in the product: the app enforces, the brain holds the content

Date: 2026-10-16 · Status: accepted (owner, panel 16/10: topic text injected by hook, hooks in app code per launch, unit + opt-in
live tests, migration all at once) · Source: the owner's request (16/10): centralize in the app repo the machinery that makes agents follow rules and read memory cheaply, so any developer who clones the repo can improve it; keep in
the user's brain only the personal content; weaker models skip on-demand files, so rules are enforced by tools and
hooks where possible · Builds on: ADR 0059 (brain domains), ADR 0060 (per-launch rules: plugin folder, adapters),
ADR 0061 (one app repo, `brain-template/` in it; on `feat/one-app-repo`, not on main yet), ADR 0063 (browser rules
enforced by the tools; on `feat/tool-rules`, not on main yet)

## Context
Today the owner's brain carries two things mixed together:
- **Machinery**: loading tiers (one small file always loaded, the rest on demand with a "Read when" line, a map that
  routes topics to files), hooks (a fixed-context budget that refuses growing writes, a single writer for the shared
  "now" file with a line cap, a chat feed that tells the coordinator where the user is, a correction catcher, a vendor
  guard, a Stop auto-commit, prompt reminders), tools (memory writer with validation, brain lint, session finder,
  cost reader, environment leases, recurrence check), an error log with a fixed header, behaviour tests with
  states, the rules for changing rules, sub-agent routing, an output-style framework.
- **Content**: the user's own rules and words, customers, environments, hosts, colleagues, credentials, their error
  log entries and test cases, their output style.

`brain-template/` (ADR 0061) already holds generic copies of most of the machinery, but as **brain files**: each
user's brain gets its own copy at setup, which then drifts; a fix made by one developer never reaches existing
brains. And most rules are text the model must choose to read: the cheap models skip the on-demand files (seen on
16/10 with the browser rules: a Sonnet chat opened a local stack in the wrong environment although the rule was
written; ADR 0063 turns it into a refusal in the browser tools, `src/main/browser/rules.ts` on its branch).

## Decision
**1. Three homes, one test for each piece: "would a stranger's brain need it unchanged?"**
| Piece | Home | Examples |
|-------|------|----------|
| Enforcement (hooks, guards, validated writers, lint, leases) | **app code**, versioned, unit-tested, delivered per launch | budget guard, now-file writer, chat feed, correction catcher, vendor guard, auto-commit, lease, lint |
| Generic rules and formats every user starts with | **`brain-template/`** (text, in the repo) | how rules are changed, error-log header, behaviour-test format, map layout, agent standard, sub-agent routing defaults |
| Personal and work content, and the user's tuning | **the user's brain** | the always-loaded file, topic files, error entries, test cases, output style, budgets and paths in its config |

The app code never contains a user's content; the brain never contains a copy of the app's code. Values a hook
needs (budget, which files are always loaded, line caps) live in the brain's config (`brain.json`, schema in
`src/shared/contract.ts`), with defaults in code.

**2. Three loading tiers, the cheapest one that makes the rule hold wins.**
- **Enforced by tool** (strongest, preferred): the rule is a check in an app MCP tool or a `PreToolUse` hook; a
  violation is a refusal whose text is the exact fix (as `browser/rules.ts`). Any rule that can be checked on a tool
  call goes here first.
- **By topic, injected by hook**: each topic file declares in front matter when it applies
  (`when: { prompt: [keywords], tools: [names], paths: [globs] }`). A product hook on `UserPromptSubmit` and
  `PreToolUse` matches and **injects the file's text** (not a pointer), once per chat until the file changes, within
  a per-turn size cap; above the cap it injects the file's first section plus its path. "Read when" lines become
  this front matter; the map is generated from it.
- **Always**: one small core file per user (their identity, how to talk to them, safety), under a budget the guard
  enforces (default 15,000 characters for the whole fixed context).

**3. Delivery: the app's generated per-launch config, never the user's files.** The product hooks ship in the app
(`src/main/rules/hooks/*.mjs`, built to `out/`) and reach each CLI through the per-launch adapters of ADR 0060:
the Claude plugin folder (`--plugin-dir`), Codex and Cursor per their adapter. Today `adapters/claude-plugin.ts`
copies only the brain's `hooks/hooks.json`, not hook scripts and nothing from the app: it must learn to add the app's
built hook scripts and their `hooks.json` entries (paths under `${CLAUDE_PLUGIN_ROOT}`), merged with the brain's. Chats started outside the app keep the
brain's own copies until the owner removes them (rule 6: the app never writes `~/.claude`).

**4. How a cloner contributes.**
- A generic rule → `brain-template/` (text) plus, when it can be checked, a hook or tool check in `src/main/rules/`.
- Every hook and check has unit tests on recorded hook inputs (`test/fixtures/hooks/`, no tokens), as the CLI
  contracts of ADR 0055.
- Every generic rule in `brain-template/` has a behaviour case; the cases that need a model run opt-in
  (`SB_LIVE=1 npx vitest run test/live/rules`, cheapest model, the developer's own tokens), never in `npm run check`.
- The publish guard (ADR 0061) keeps any user content out of both.

**5. Migration: all at once** (owner, panel 16/10, chosen over one mechanism per branch). One integration branch
brings every mechanism into the product, in this build order inside it: budget guard and now-file writer; topic
injection hook, front matter on the template's topic files, generated map; correction catcher, error-log writer,
behaviour-case format; chat feed / focus (moved into the app, which already knows the focus); leases, vendor guard,
auto-commit, lint, session finder, cost reader. The owner's brain switches in the same release: front matter on its
topic files, its machinery copies removed, content only. Safety net, two separate steps: before the switch the owner's brain is tagged in its
git, and a checkout of that tag restores the old machinery; `npm run rollback` (ADR 0007) only swaps the app back to
the previous release, needed too if the new app expects the new brain layout.

## Rejected
- **Keep the machinery in `brain-template/` only**: copied once per brain, drifts, a fix never reaches existing users.
- **A pointer ("read X") instead of injecting the text**: the failure we are fixing; cheap models ignore it.
- **Load every rule always**: blows the context budget and dilutes the rules that matter.
- **Write hooks into the user's `~/.claude/settings.json`**: breaks rule 6 and ADR 0060.

## Consequences
- The app becomes the source of truth for enforcement: a broken hook breaks every chat. Each hook fails open with a
  `warn` log (`hint`: which hook, which input), except safety guards, which fail closed.
- `brain-template/.claude/hooks` and the template's tool copies shrink to content; ADR 0061's template keeps only text.
- Work not done yet: the plugin adapter delivering app hook scripts (point 3).
- Not verified yet: how Codex and Cursor expose prompt-time hooks (injection may be limited to Claude at first; the
  other engines then get the topic files in their per-launch instructions).
