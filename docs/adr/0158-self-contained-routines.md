# 0158 — Versioned routine packages, scoped effects and observable runs

Status: partly superseded by ADR 0168 (the draft/activation part) and ADR 0179 (app-execution portions); accepted for implementation, 2026-10-25. Builds on ADR 0155. No new runtime dependency.

## Decision

A routine can carry a schema-1 `package`: hashed script/query/reference/checklist assets, declared outputs, required grant operations, optional per-step work-item history and a downgrade policy. Each agent step freezes its full `agentPrompt`, role, tier, engine/model/effort and selected asset IDs. Step instructions, inputs, evidence labels, workspace, retries, independent review and gates remain part of the same definition digest. Approval authorizes that exact version; editing creates a new draft.

The Orchestrator uses the brain when authoring: read relevant source rules, inline the operative requirements, copy required assets and record optional source provenance/hash. It must ask about missing contracts rather than fabricate company procedures. App-provided ambient memory, role prompt, recall and brain skill mounts are excluded for packaged workers. Host safety policy and engine/tier availability still apply. Frozen launch identity is checked at manual/automatic bind, report acceptance and host adapter use. Global CLI settings, user hooks and unrestricted shell/file tools remain outside this package mechanism: this is not an OS sandbox.

Assets are materialized under app data, isolated by context and definition digest, verified against exact bytes, and rejected for undeclared files, links or tampering. Script/query commands use this package directory as cwd; the selected brain path remains a namespace, not a runtime source. Explicit brain outputs append only to declared `routine-outputs/*.md` notes. They never silently change rules or skills. The downgrade lesson is host-reserved.

JSON and Markdown export include the complete package without reading its original sources. ZIP uses the same saved package. Exports never contain runs. If known-secret redaction would change approved package bytes, export refuses and requests a scrubbed new version. Imports create drafts, never grants or automatic activation. Secret detection is conservative, not proof that arbitrary prose contains no sensitive data.

## Scoped DevOps operations

`flow_devops_write` derives its work item and grants from the current bound task and exact approved automatic rule. New separately visible grant categories cover rich comments, attachments, related links, creation/comments/publication/abandonment of the run's own PR, and test deployment. Raw HTML is escaped. A tiny Markdown renderer allows same-organization HTTPS links and images referring only to host-uploaded run attachments. Uploads accept bounded PNG/JPEG evidence files in the run's own folder, with type/signature, path, link and size checks. Related work items use the Related relation; PRs use Azure's artifact relation because PRs are not work items.

A durable write intent precedes the first remote mutation. Successful exact replays return the stored result. An ambiguous outcome blocks further mutations for that run until reconciled; it is never blindly retried. Grants and bound task identity are checked again across asynchronous boundaries. This is not distributed exactly-once delivery: a timeout after a server accepted a request remains explicitly unknown.

## Exact test deployment targets

The user maintains `<userData>/test-deploy-targets.json` (schema 1, `targets` array); agents have a read-only discovery tool. Every target is copied into the approval modal with its organization, project ID/name, definition ID/revision/execution fingerprint, single environment, deployment group/queue/pool, registered agent/machine ID, machine name/computer name, build definition/repository and artifact alias. `confirmedTest: true` is mandatory. The host never infers environment safety from a name. A trusted administrator must verify that the configured target is actually test.

Only a single-environment classic release with one Build artifact and no variable groups is supported. The successful build must match the run-owned PR repository/branch/source commit. Two server-side equality demands pin `Agent.Name` and `Agent.ComputerName`; the host verifies the registered IDs, pool/group/queue, capabilities and exact execution fingerprint immediately before dispatch. The release starts as a draft, with environments manual, and its returned snapshot is checked before activating its exact instance environment ID. Azure approvals are not bypassed.

A global org/pool/agent lease is retained through AFTER checks. Cancellation/downgrade abandons only the run's own draft PR, cancels only its own release and releases the lease only after confirmed terminal deployment status. Unknown outcomes retain the lease. A failed settlement is visible and cannot stall other routines. A partial restart with run-owned PR/deployment resources is refused; restart from the beginning after cleanup. Atomic resource ownership transfer is deliberately not implemented.

## Production preparation

`package.production` expresses **non-executable intent**: db-read, db-write or deploy; explicit target ID; embedded recipe ID/hash; timeout; read/affected-row budget; optional rollback asset. These are visible in exports and review with “design only, not enabled.” They grant no access, expose no production tool, and never weaken the existing exact-command user-click gate. A future routine-only production adapter needs a user-managed target/credential registry, separate exact-version grants, database privileges, transactional row-count checks, target attestation, revocation and recovery before execution is possible. No production connection, query or deploy was performed for this change.

## Evidence and improvement

Runs retain their original automatic approval in the same transaction that creates them. Host transitions (including crash recovery), attempts, decisions, receipts, canonical agent reports, declared outputs, history delivery failures, remote operation journals and deployment leases produce a redacted Markdown/JSON dossier. It explicitly distinguishes host observations from unobserved shell effects and hidden reasoning. Arbitrary screenshots/files must be supplied as explicit evidence; the host cannot infer unrecorded work.

`app_flow_dossier` provides a short summary or full evidence on demand. The Orchestrator's lightweight hint includes recent finished runs without injecting whole dossiers into every prompt. Routine detail, current run and history open the same fullscreen inspector with saved prompts/assets, original grant and dossier. “Review with Orchestrator” hands off the exact run ID. Improvements are new proposed versions, never retroactive edits or silently learned instructions.

## Worker placement

Host-created workers retain a presentation-only routine/run/step marker across restart and continuation. Legacy bindings also identify older workers. Routine workers, descendants and owned browser tiles are excluded from the Grindhouse and its sidebar. Open-agent links, focus shortcuts and owned browser references route to the Routine page, which embeds the live chat and browser as ordinary page surfaces so permission panels and file viewers remain usable. This marker never confers execution authority.

## Migration and validation

Existing routines retain their old definition and visible legacy warning. They are not silently rewritten. Ask the Orchestrator to create a new package version, inline referenced rules/checklists, copy scripts, freeze prompts/models, declare outputs and the downgrade policy, then inspect/export and approve it and its exact automatic configuration. Existing in-flight runs keep their pinned version. The company bug-fix routine will be rewritten separately with the user, as requested.

Mocked tests cover content/path safety, operation grants/ownership/revocation, exact deployment targets and leases, frozen bindings and reports, portable identity, output contracts and recovery. Branch checks and build must pass. E2E specifications are updated but are not run here; no live Azure, database, model or hardware voice validation. Production preparation is metadata only. Semantic voice turn classifiers and streaming ASR remain evaluated proposals, not shipped claims.
