# Code work

{{OWNER}}'s rules for code in any repo. Read when: any code work (fix, implement, review, PR). Write when: a code-work
rule or a repo fact changes.

## Repos

| Repo | Path | Main branch | Notes |
|------|------|-------------|-------|
| (add one row per repo you work on) | `{{REPOS_WIN}}\<name>` | `main` | |

## Rules

- **Read the repo first**: its `AGENTS.md`/`README`, then the code around the change. Match its style and idioms.
- **Prove it**: a bug fix starts from a failing test or a reproduced symptom; "done" = the change seen working in the
  real product, plus the repo's checks green.
- **Review**: the `reviewer` agent on the diff before "done" or a commit; fix what it confirms.
- **Commits and PRs**: in English, conventional messages; push and PRs only where {{OWNER}} allows it.
- **Other people's code**: never rewrite what you were not asked to touch; a bug you find elsewhere is reported, not
  fixed inside your change.
- **Worktrees**: one per parallel job; land them with `node {{BRAIN}}/ops/tools/wt-land.mjs` (brain) or a PR (repos).
