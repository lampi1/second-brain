# ADR 0278 · A role may use any installed skill, and looking never asks

Date: 2026-11-13 · Status: accepted (owner, thread «Preparare la 1.0 con analisi profonda», with a screenshot of
«Skill «dataviz» non assegnata al ruolo Artisan: rifiutata»: «voglio libertà, gli agenti con identità devono portare
valore non peggiorare l'esperienza degli utenti»; «senza blocchi di permessi … tutto consentito da subito come dovrebbe
essere già») · Amends: ADR 0083 (roles and delegation), ADR 0090 (qualified skill names)

## Context

A role chat's `Skill` call passed the role gate (`src/main/agents/role-gate.ts`) only as
`<launch plugin>:<a skill the launch gave>`. Any other skill was refused with «Skill … non assegnata al ruolo …:
rifiutata»: the engine's own skills (`dataviz`), the user's own, another plugin's. The reason was that a bare name or
another prefix could load a user or project skill that only shares the name. In the owner's real data five of his
seven roles have no skill assigned, so for them every skill outside the launch was refused. The owner had already
decided that roles get every permission by default (2026-10-19).

## Decision

1. The role gate allows every `Skill` call at once: it is never asked to the user and never refused. The code
   `skillRefused` and its three texts are removed.
2. A bare name of a skill the launch gave is still rewritten to `<launch plugin>:<name>` on an engine that runs a
   changed input (Claude, issue #101), so the role's own copy wins over a same-named skill elsewhere.
3. The user's own rules still hold: a skill a rule of `permissions.json` names goes to that rule as in a plain chat,
   and while that file cannot be read a skill is asked. The roles' frame (`ROLE_PREAMBLE`) says they may use any skill
   the chat can load.
4. Looking never asks. A role the user limited to «Chiede conferma» or «Solo piano» (the quick-answer role is «Solo
   piano» by default) no longer sends `Read`, `Glob`, `Grep` or a read-only command to the user
   (`src/main/chats/auto-permit.ts`): in four days of the owner's data these were the only permission requests that
   reached him (8, all reads). A rule of his own policy (`permissions.json`) still holds what it names.
5. The Agent Studio hint and the Guida say it: a role starts with its skills and may use the other installed ones.

## Consequences

- A role can use the engine's built-in skills and the user's own without anybody assigning them first.
- A skill that ships inside a project folder can now be loaded by a role working there; before, the gate refused it.
  The app's other guards (destructive commands, production actions waiting for «Esegui») do not depend on this gate.
- Not changed: which skills a launch loads. A role chat still starts without the brain's whole skill folder
  (`engines/sessions.ts`); making every brain skill visible to every role is a separate choice.
- Tests: `test/unit/agents/role-gate.test.ts`, `test/unit/agents/delegation.test.ts`, `test/unit/chats/auto-permit.test.ts`.
