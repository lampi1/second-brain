# 0159 — Unattended routine completion on shared test environments

Status: partly superseded by ADR 0168 (the "before activation" part) and ADR 0179 (app-execution portions); implemented, 2026-10-25 (initial design committed before implementation). Builds on ADR 0158; no production access or PR merge capability.

## Evidence and boundaries

The supplied deployment is an agent-based App Service release, not a deployment-group machine. Current `test-deployment.ts` only accepts machine groups; `devops-writer.ts` binds builds to `lastMergeSourceCommit` and the source branch. Those restrictions cannot deploy the supplied PR merge build. The other identified gaps are visible in `service.ts`, `runtime.ts` and the adapter tools. Tag inclusion/exclusion already exists and will be retained. No contradictory deployment fact was found in the app: company configuration is external, not part of this repository.

The supplied reference-script checks are the acceptance criteria. The previously attached brain archive does not contain that script or the current routine version; neither has been executed or assumed inspected. Tests use synthetic identifiers reproducing the supplied release shape. Company target values belong in private app configuration, never in this public repository.

## Decisions

1. **App Service deployment:** add a discriminated target alongside the existing VM target. Pin project/repository, definition/revision/execution fingerprint, one agent-based phase and queue, permitted deploy task IDs, service connection, subscription, resource group and web app. Reject variable groups, dynamic destinations and unapproved tasks. Verify the live Azure resource using read-only management requests. A read-only target inspector computes the fingerprint and returns a validated configuration for the user to register; it cannot activate a grant. Use only the run-owned PR's live merge ref/commit and a completed successful PR build from the approved pipeline. Recheck immediately before dispatch; keep draft validation, audit and uncertain-effect handling. Azure Repos draft PRs do not automatically trigger builds: a separate `pr-validation` grant requeues only the existing exact build policy of the owned PR. It never edits the policy/pipeline or publishes the draft.

2. **Environment ownership:** steps may declare an exact test target for their duration, requiring an explicit environment-use grant. Acquire before launching the worker; release on completion, failure, handoff, cancellation and startup recovery. Deployment effects retain separate ownership while remote activity is active or uncertain: a crash must never imply that Azure stopped. App Service ownership is keyed by its Azure resource identity. Local leases coordinate app runs; they do not lock out people or other tools. Detect external release activity/drift for the pinned definition/environment and expose conflicts rather than claim exclusivity over QA. Other definitions or direct Azure deployments remain unobserved. Stop waiting workers before releasing ownership; only the initiating lease may adopt a proven initial owned deployment attempt, once.

3. **Quiet skip and deduplication:** add an intake-only terminal skipped disposition, without comments, outputs or lessons. Delay the intake history until intake has accepted the item. Keep existing include/exclude tags. Attribute host work-item revisions durably and suppress their detection/requeue, including events detected while the originating run is active; unrelated human revisions must remain eligible. Unknown writes remain quarantined, not guessed successful.

4. **Human handoff:** distinguish an initial needs-human verdict from a downgrade after an explicit ai-fixable verdict. Both use the approved tags/state, owned-resource cleanup and human explanation; only a genuine downgrade emits the declared classification lesson. These are host-validated transitions, not prose conventions.

5. **Dense linked history:** keep one durable history record per step outcome/attempt. Allow a bounded, explicitly supplied step summary/evidence payload to enrich the host outcome, rendered with the existing safe link/image renderer. Only the approved DevOps organization and attachments uploaded by this run are link/image sources. Invalid markup never becomes executable HTML or suppresses the host's status evidence.

6. **Block mentions:** derive the milestone from the host transition, including a step-originated block/handoff. The host chooses the approved mention identities; agent-supplied mention reasons cannot manufacture permission or spam ordinary progress comments.

7. **Owned branch push:** add a separately approved host push capability, bound to the exact run, repository, workspace and one host-owned `fix/...` branch. Use explicit refspec and expected remote identity; disallow force, deletion, tags, alternate remotes and protected-branch writes. Require one exact `pushTargets` repository/workspace input, isolate credentialed publication in a host-created bare repository, and record commit/ref receipts. Unknown push outcomes remain blocked for reconciliation. No merge operation is added.

8. **Learning at authoring time:** expose declared outputs since the active version's activation, with run/version/output identities, hashes and a bounded cursor. The Orchestrator can inspect and propose an updated package; runtime prompts still cannot silently import later lessons or brain changes.

9. **Models:** expose valid enabled engine/model IDs and resolved per-role/per-tier choices, including missing mappings. Resolve omitted packaged model facts from this catalog and validate explicit choices when proposing/activating; do not invent a model ID or silently substitute a different engine. Existing approved versions remain readable and pinned.

## Validation and migration

Mocked tests cover deployment target/fingerprint and merge-build identity, work-item/PR/branch ownership, lifecycle leases and crash recovery, self-write suppression, quiet skip versus human handoff, safe history/mentions and model validation. Run the branch gate and build; inspect visible changes in a hidden dev instance. Write/update E2E specifications without running the E2E suite. Fresh security, correctness and UI reviews precede the authorized merge.

Existing packages remain unchanged. The next package version must declare intake/verdict transitions, step environment usage, host branch/push operations, merge-build deployment and structured step history; remove corresponding shell deployment/push and duplicate comment instructions. Approval still covers the exact package and automatic configuration. Registration, migration and operational limits are documented in [routine-test-targets.md](../routine-test-targets.md).

### Classic App Service parameter compatibility

Azure may serialize a normal deploy task with `definitionType: null`; accept exactly null or `task`, never task groups. Resolve whole `$(Parameters.Name)` references in the connection, web app, app kind and startup inputs from one explicit literal default in the pinned definition/environment process parameters. Empty startup is valid; missing, ambiguous, nested, partial or other-variable references fail closed. Unused Docker inputs remain irrelevant for package deployments. Resolution never mutates the fingerprinted definition.

Validate returned draft defaults against the same approved effective inputs before activation, retaining raw phase/revision checks and rejecting returned variable overrides. Release creation and activation keep their fixed payloads without variables, process-parameter or environment overrides. This changes no Azure definition, grant or production boundary.

Routine authoring remains generic: expose the supported composition primitives, grants and configuration paths through on-demand `app_flow_capabilities` sections, and direct the Orchestrator there before suggesting app-code changes. New workflows and supported targets are user data; genuinely unsupported host integrations still need adapters. The catalog grants no authority and adds no universal shell escape. See [routine-authoring.md](../routine-authoring.md).
