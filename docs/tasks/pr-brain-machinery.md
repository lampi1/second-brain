Title: feat(brain): app-owned brain machinery: product rules runtime, per-launch hooks, template utilities outside the brain

ADR 0062 moves enforcement into the app, generic text into brain-template, and keeps the brain personal content only.
This branch implements that for **new** brains and gives existing brains an owner-run, reviewable migration with crash
recovery. Engine scope is ADR62d only: per-launch Claude hooks plus a text fallback for Codex/ACP (Cursor).
Engine failover is out of scope.

## What changes

- **Product rules runtime** (`src/main/rules/`, built to `out/rules`):
  - Fixed-context budget (15,000 chars) and validated, locked now/error writers.
  - Topic matching on prompt, tool or path, injected once per revision with a shared per-turn cap.
  - Correction reminder, metadata-only feed, vendor-spend check and token-owned leases.
  - Lint, optional local auto-commit, masked session excerpts and reported-cost reading.
- **Claude per-launch plugin** (`adapters/claude-plugin.ts`, `rules/delivery.ts`):
  - The product runner goes first; the template hooks the product does not replace come after it, pointed at the app-owned copy.
  - Replaced: vendor-guard, brain-limits, chat-feed, auto-commit.
  - `launch.json` carries `{root, state, tools, correctionHook}`.
  - Product brains turn on through `brain.json rules.claudeLaunch` (default true). Legacy brains keep the app-wide switch.
- **Template utilities outside the brain** (`rules/tools.ts`):
  - The release `brain-template` code is rendered per brain into `<userData>/brain-tools/<hash>`. That folder holds a `.sb-tools.json` `{root, sig}` marker.
  - The copy is signature-guarded and built in a temp stage, then renamed. A failed build keeps the old copy.
  - Template scripts find the brain they serve through `ops/tools/brain-root.mjs`.
  - `brainScript(root, rel)`:
    - Product brain and shipped template code: returns the copy.
    - Personal scripts (e.g. `ops/tools/devops-me.mjs`) and legacy brains: returns the brain's own file.
  - Consumers moved to it: api.ts, usage.ts, estimates.ts, live.ts and detect.ts.
- **`{tools}` in brain text**: expanded in injected topics and in the launch instructions. The launch text states its value.
- **New brains** (`rules/new-brain.ts`, `brain/create.ts`):
  - `BrainCreator` removes the template code and the global wiring files. Those files are `harness/claude/settings.hooks.json`, `harness/cursor/hooks.json` and `.claude/settings.json`.
  - References to shipped code are rewritten as `{tools}/…`; references to personal scripts stay.
  - It writes the boot index, `CLAUDE.md` and `topic-map.md`, plus `brain.json` with `machinery: "product-v1"`, the stored template values and `topicFiles`.
  - It checks the launch budget and makes a git-isolated day-one commit.
  - 13 template topic files carry `when:` frontmatter.
- **Codex / ACP**: bounded topic text and the `{tools}` line go into launch instructions. This is a text fallback, not native pre-tool enforcement. Read-only launches get no writable commands.
- **Existing brains**: nothing migrates automatically.
  - `cli.mjs plan <brain> [out.json] [--with-hooks]` writes a reviewable plan with preimage hashes. It covers template frontmatter, `{tools}` references, shipped-code removal and activation. `.claude/hooks` and `harness/cursor` stay unless `--with-hooks` is given, because global CLI settings may still run them.
  - `migrate` writes a journal (`<brain>.product-migration.json`) before the two renames.
  - `recover` resolves a crash to one of three outcomes:
    - not-applied: the stage is kept.
    - restored: the original is moved back.
    - applied: returns the receipt.
  - `recover` rejects any journal whose paths migrate would not derive.
  - `rollback` restores the original and keeps the newer tree.

## Integrator-owned wiring (contract.ts, wiring.ts, index.ts are unchanged on purpose, AGENTS.md:88)

1. `src/main/brain/index.ts:249`: a product brain has no `ops/tools/brain-site.mjs`. Replace the existence check:
   ```ts
   import { brainScript, isProduct } from '../rules/tools';
   // ...
   : !(isProduct(root) ? brainScript(root, 'ops/tools/brain-site.mjs') : fs.existsSync(path.join(root, 'ops', 'tools', 'brain-site.mjs'))) ? `la cartella ${root} non ha il server dati del cervello (ops/tools/brain-site.mjs)` : null
   ```
2. `src/main/wiring.ts:438` (memTool) and `src/main/pulse/wiring.ts:23` (tool): resolve mem.mjs through the copy:
   ```ts
   const tool = root ? brainScript(root, 'ops/tools/mem.mjs') : null;   // wiring.ts, keep the existsSync check
   const tool = () => { const base = root(); return base ? brainScript(base, 'ops/tools/mem.mjs') : null; }; // pulse
   ```
3. Optional: the defaults already resolve through Electron. `app.getPath('userData')/brain-tools` holds the copies. `app.getAppPath()/brain-template` holds the template, which `scripts/release.mjs` ships. Call `useToolsHome()` / `useTemplateRoot()` only to relocate them.
4. Re-export `BrainRulesConfig` (now with `claudeLaunch`) from `src/main/rules/types.ts` through `contract.ts` if the settings UI needs it.
5. Decide the switch semantics. For a product brain, `rules.claudeLaunch: true` turns the plugin on even when the app-wide `launchRulesClaude` is false (the default). The per-brain opt-out is `rules.claudeLaunch: false`. If an explicit app-wide off must win, pass `on` from wiring.ts:329.
6. Feed/focus: product hook state lives under `userData/claude-plugin/rule-state`. It holds event, session and time only, never prompt or tool-input text. It still needs to be connected to the app feed service.

## Not done (do not mark these ADR62 rows done)

- **ADR62e, live fixtures**: `test/fixtures/hooks` are synthetic protocol examples. Recording real hook inputs needs a cheap live `claude -p --model haiku` run in a temp folder, and that run would also validate `${CLAUDE_PLUGIN_ROOT}` on Windows. It was not run because it spends model tokens and writes a session under `~/.claude`, so it needs Brother's ok.
- **ADR62d**: native Codex/Cursor enforcement is not implemented by design; they get a launch-text fallback.
- **ADR62b**: frontmatter is one JSON-flow `when:` line (valid YAML), not arbitrary YAML.
- **ADR62c**: the guard covers Claude Write/Edit/MultiEdit and the product writers, not arbitrary shell programs.
- **Parity**: the cost reader reports explicit totals only. Feed/focus and praise/recall parity need the wiring above.
- **No personal migration**: the owner runs `plan`, reviews the plan, then runs `migrate` with every chat stopped.

## Validation (Windows)

- `npm ci`; `npx eslint .` clean; `npx tsc --noEmit` clean.
- `npx vitest run test/unit/brain`: 50 files, 483 passed, 1 skipped (platform skip).
- New tests in `rules-tools.test.ts` (13) cover:
  - Rendering, reuse, mem.mjs writing through the copy, and script resolution.
  - Template hooks, the activation switch and `{tools}`.
  - Reference rewriting, the migration plan, and every crash-recovery state (pending refusal, before, between and after the renames, invalid journal).
- `create.test.ts` checks the real template result.
- `npm run check:branch`: typecheck and lint green; unit **red in 3 runs, on time-bound tests only, a different set each time**: file-diff, default-brain, archive, compare/headless and correction-catch-hook timeouts or duration assertions. The machine was at 100% CPU with about 50 node/claude processes from other sessions. None of these tests or their subjects are in this diff, and all of them pass when run alone (7 files, 64 tests). The first run also caught real publish-guard findings in the new tests (user paths, a GUID, emails) and a timeout in rules-tools; both are fixed. **Rerun check:branch on an idle machine before the merge.**
- Guard scan of the branch commits: `guard: clean`
- App not launched; no e2e, live model call, push, real-brain or global-settings write.
