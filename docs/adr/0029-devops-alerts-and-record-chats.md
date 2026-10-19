# ADR 0029 · DevOps alerts with a sound, and "Apri chat" on every DevOps record

Date: 2026-10-13 · Status: accepted · amended by ADR 0079 (the DevOps page is now "Task": page id task, settings tasks.*, IPC tasks:*)

## Context
The user (13/10): "vorrei che ... mi notificasse quando qualcuno mi ha taggato o qualcosa cambia, senza spendere token,
usando la stessa cosa automatica che abbiamo per la pagina devops", then: "voglio una notifica in app anche con il
suono e su devops vorrei un pulsantino comodo per far partire una chat da un record devops". The DevOps page already
reads the brain's devops-me.mjs on its own timer (zero tokens); its news went to the feed as the quiet kind `devops`.

## Decision
- **What interrupts** (`isAlert`, `main/devops/model.ts`): a mention, a change on my work items (touched, taken), a
  comment, vote or failed build on my PRs, a state or assignee change on a ticket I follow. A review asked on someone
  else's PR and a comment-only change on a followed ticket stay pull-only (ADR 0022).
- **How**: a feed event of the new kind `devops-alert` (toast tier, counts for the bell, DevOps badge), plus a short
  two-note Web Audio chime played by the app page as the event arrives (`feed:events`, not the toasts' repaint, which a
  minimized window throttles; `renderer/lib/chime.ts`). Mute of the kind
  and do-not-disturb silence both (no toast, no chime); setting `devops.sound` (on by default, the page's head has the
  switch) turns only the chime off. A hidden run (tests, agents) mutes the window. Nothing goes to the Regia's chat:
  no item in its view, no tokens.
- **Never twice**: the news key already carries the change (revision, comment id, vote value, build id); the keys seen
  by any read are kept in `devops.json` (`notified`, last 3000), so a restart or a news leaving the 14-day list never
  alerts again. The first read ever is a baseline (no alert); a `devops.json` from before this ADR counts its news as
  seen.
- **"Apri chat"** on each news, PR, review, work item, followed ticket, test plan and test case: one click, no dialog,
  through the brain pages' `DiscussBridge.newChat` (toast "Chat aperta: <title>"). Title "Area · <record title>"
  (area: the PR's repo or the work item's project, else "DevOps"); the first message has
  the link, type, state and the first step (bug or task: read it all, then a plan; PR: review and QA, or what is
  missing for mine; test plan or case: run or check). Folder: the PR's repo clone in `<home>/source/repos/<repo>` when
  main finds it (`DevopsState.repoDirs`), else the brain folder. Work items carry no repo or area path in the script's
  output, so they always start in the brain folder.

## Consequences
The user hears about what concerns him within one read interval and can start working on a record in one click. The
area is the repo or project name (no product names in the app); a product mapping can come later from the brain.
