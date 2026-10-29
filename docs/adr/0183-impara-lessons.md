# 0183 — Impara: lessons on a blackboard

2026-10-29. Accepted.

## Decision

A new page «Impara» (route `app_ui page impara`) teaches a PR, a technical topic or a pasted text piece by piece. One lesson is a flowchart drawn once (the blackboard), a list of pieces that each light some of its nodes, and short checks between pieces. The user goes on, asks «Spiegamelo meglio», an example, the code of the piece or a free question; each extra is a new piece placed right after the one it explains. At the end the user explains the whole thing back («Spiegalo tu») and gets a grade. Voice is optional both ways: the app's voice reads the piece, dictation answers checks and speaks commands («avanti», «non ho capito», «la b»).

Generation uses `HeadlessRunner.run`, a hidden read-only session, on the best engine that is on and can read files (Claude first). It is not an Orchestrator chat: a lesson is a document, not a conversation, and the Orchestrator does not start lessons. Two runs write a lesson (plan with the first two pieces, then the rest in the background), one short run each for an extra and for the grade. Checks are judged by the app at zero tokens; the first answer stays.

The app gathers the material itself, never the model: a GitHub PR through `gh pr view` and `gh pr diff` with the user's own login; a Task page DevOps PR through `git diff target...source` in its local clone, never a fetch; with no clone, the description only, said in the lesson. No credential is passed. A long diff is cut for the prompt and kept whole in the lesson's folder.

Every lesson is saved in `userData/learn/<id>/` (lesson.json plus its material) and reopens where it was. A lesson the app was closed during is marked and offers «Riprova».

## Security

The model's answer is parsed and capped (`shared/lesson.ts`): only flowcharts, focus only on node ids the diagram declares, colours only hex and added by the app (`withFocus`). Diagrams draw through the existing strict mermaid renderer as images. Runs are read-only in the lesson's folder or the PR's clone. No new dependency, IPC channels typed in the contract.

## Consequences

Model output was tried on the frozen demo (hand-written lessons about PR #251 and #249), not yet on a real model. Spaced reviews, flashcards and an `app_learn` tool for the Orchestrator are left for a second phase.
