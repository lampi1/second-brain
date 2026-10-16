# ADR 0061 · One app repo for every PC: product only, guarded before each push

Date: 2026-10-16 · Status: accepted (owner, panel 16/10) · Source: the owner's words (16/10): on the personal PC "lavorare all'app second
brain e averla aggiornata anche in questo pc", "mi va bene avere i dati vuoti, senza informazioni personali mie, anche
per provarla come la proverebbe un futuro utente da zero", "simulare un altro dev che lavora sull'app per l'app e anche
ad altre sue cose", "anche a costo di stravolgere tutto"; "una chiara distinzione tra parte del prodotto app, parte
personale, parte lavoro/progetti" · Builds on: ADR 0004 (phase 5, never executed), ADR 0007 (stable vs dev), ADR 0027
(checks) · Changes: ADR 0059 (the owner's personal brain is not synced to the second PC for now)

## Context
Three kinds of content, today mixed in two places:
- **Product**: the app's code, docs, tests, and a generic brain template.
- **Personal**: the owner's words, rules and research notes.
- **Work**: the employer's products, customers, hosts and colleagues.

The dev repo (this one, local only) holds the product plus 7 files that are not product: `docs/research/*.md` (5,
mostly the owner's notes and words) and `docs/mockups/*` (3, a design draft with employer wording). Its history is
worse: 734 commits authored with the owner's work e-mail, and a full scan finds about 2,260 deny-list hits plus a few
secret-shaped strings (not checked whether real or test values) in old revisions.

The product reaches GitHub (`lampi1/second-brain`, now private) only through a one-way export
(`product-sync.mjs` in the brain): it copies the promoted commit minus the 7 files, rewrites names, builds
`brain-template/` from the brain's generic tools plus hand-written template files, adds `LICENSE`,
`tools/guard/scan.mjs` and `.guardallow`, scans, and pushes one commit per sync as `lampi1`. That repo's 15 commits are
clean. A change made on another PC would never come back: the export only goes out.

## Decision
- **One app repo, `lampi1/second-brain`, product only, cloned by every PC.** Work happens in it on both PCs: branches
  and merges as today, `git pull` / `git push` both ways. No personal and no work content in its tree or its history.
- **Its history is the product repo's, not the dev repo's.** The current dev tree, cleaned (below), lands as one commit
  on top of `lampi1/second-brain`'s main. This PC then works from a fresh clone of it; the old dev repo is kept read-only
  on this PC as `second-brain-app-archive` (its history stays searchable, never pushed). Open worktrees are merged or
  moved before the switch.
- **The 7 non-product files leave the repo**: `docs/research/*.md` go to the owner's personal side of the brain,
  `docs/mockups/*` are deleted (an old draft; the screenshots replaced it).
- **The repo carries what the export used to add**: `brain-template/` (the empty brain a new user starts with), `LICENSE`,
  `tools/guard/scan.mjs`, `.guardallow`. From now on the template is edited here, in the repo; the export's rename
  tables stop being needed because these files are written generic from the start.
- **The guard replaces the export**: git hooks installed by `npm run setup`
  (`core.hooksPath`, repo-local config) runs `tools/guard/scan.mjs` on the pushed commits (tree, messages, author,
  committer). Its built-in rules (secrets, private hosts, e-mails, home paths) always run; a private deny list named by
  the repo-local `git config guard.denyList` is added on top. `npm run setup` only prints that command: each PC's
  owner sets it once. On this PC it is the full list (`%LOCALAPPDATA%/second-brain/publish/deny.txt`: work terms and
  the owner's personal names, owner 16/10), so a work or personal name blocks the push; once set, a missing or
  unreadable list blocks, it never skips. The deny list never enters the repo: it is made of the names it keeps out.
  `test/unit/publish-guard.test.ts` uses the same command.
- **This PC commits and pushes any time, safely** (owner, 16/10: "possa sempre committare e pushare da questo pc senza
  però info … gestito bene professionalmente"). Three nets, each enough alone for its scope:
  - `pre-commit`: a fast scan of the staged changes only (seconds), so a bad line is caught where it is written;
  - `pre-push`: the full scan of every commit being pushed (tree, messages, author, committer); never skippable from the
    app or by agents (`--no-verify` is forbidden to agents, as in the repo rules);
  - CI on GitHub: the same scanner on every push and pull request, built-in rules only (the deny list is never
    uploaded), as the last net for a PC without hooks; GitHub secret scanning turned on if the plan offers it.
  A block names file:line and the rule, never the value, and says how to fix it (edit, or a `.guardallow` line with
  the file's hash for a proven false positive, reviewed like code).
- **Commits that reach GitHub use a neutral identity** (`lampi1 <…@users.noreply.github.com>`), set once per PC
  in the repo's local git config (`user.name`, `user.email`, `guard.email`; `npm run setup` prints the commands); with
  `guard.email` set the hooks refuse a commit, tag or committer with another e-mail, and the built-in `email` rule
  blocks a non-noreply address at push anyway.
- **The export is retired**: `product-sync.mjs` is paused after the switch, deleted once both PCs have pushed and
  pulled once. `src/main/sync.ts` (release-sync outcomes) goes with it.
- **The second PC starts from zero, as a new user and a new developer would**: `git clone`, `npm run setup`, first start
  with the template brain. Its brain is its own, new. Every gap found there (setup, onboarding, docs) is a product bug.
- **Brain domains (ADR 0059) stay a product feature**; the owner's personal brain is not synced to the second PC for now.

## Rejected
- Pushing the dev repo as it is: work e-mail on every commit, work terms and secret-shaped strings in the history.
- Rewriting the dev repo's 734 commits: slow, error-prone, every SHA changes anyway, and the history it would save is
  kept in the archive.
- Keeping the export and adding an import back: two histories to reconcile on every change, conflicts on every sync.

## Consequences
- The brain-domain push guard (ADR 0059) runs this same scanner, shipped with the app in `out/guard/scan.mjs`; only its
  private deny and allow lists stay in `%LOCALAPPDATA%/second-brain/publish`.
- Agents still never push (repo rule 8): the owner pushes and pulls; the hook protects every push he makes.
- The brain's own copies of the generic tools may drift from `brain-template/`; the owner's brain keeps working as
  today. Whether the brain later uses the product's tools as their source is a separate decision.
- Work: clean the 7 files, bring the template and guard in, hook + identity in `setup`, one squashed commit onto
  `lampi1/second-brain`, switch this PC's checkout (stable release and launcher untouched: they point at
  `%LOCALAPPDATA%/second-brain/releases/`), retire the export, update `AGENTS.md`, `CONTRIBUTING.md`, ADR 0004 and 0059.
