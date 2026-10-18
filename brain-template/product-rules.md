<!-- Generic description of app-owned rules for newly created brains; read when using product memory commands or migrating. -->
# App-owned brain machinery

The app creates new brains with `brain.json` containing `machinery: "product-v1"` and a `rules` section.
Identity, safety, topic rules and memory entries remain personal content. The app supplies hook executables per launch.
Global Claude, Codex and Cursor settings are never changed by this path.

The default fixed context allowance is 15,000 characters. Topic text has a separate 6,000-character allowance per
turn in Claude. A topic uses JSON flow frontmatter, which is valid YAML:

```yaml
---
when: {"prompt":["review","code"],"tools":["Edit"],"paths":["**/src/**"]}
---
```

The launch instructions give the installed product memory command. `now` updates only the named chat's line;
`error` appends one validated line. Both reject control characters and concurrent writers. `lint` reports the
fixed-context allowance and generates the topic map. `lease` acquires a lease and returns a token required to release it.
`session` reads an explicitly selected transcript with credential masking; `cost` reports its recorded total or unknown.

Optional local auto-commit is off by default. When enabled it requires a standalone brain with no remotes and an
empty index, and commits only the validated now/error files. It never pushes.

Codex and ACP receive bounded topic content in their launch context. These adapters do not claim native pre-tool
enforcement. External chats keep their existing wiring until the owner deliberately migrates them.

Template code (ops/tools, harness scripts, .claude/hooks) is not kept in a product brain. The app renders the
release utilities for each brain into its own data folder; brain files reference them as `{tools}/…` and the launch
instructions name that folder. Personal scripts the owner adds stay in the brain and keep their paths.

Existing brains are not migrated automatically. `plan` writes a reviewable plan that records each file's SHA-256;
`migrate` applies the whole plan, creates a backup git tag and retains the old tree. A journal next to the brain
survives a crash: `recover` reports it not applied, restores the original, or confirms it applied. `rollback`
restores the original and keeps the newer tree. Stop all chats before switching. App release rollback is separate.
