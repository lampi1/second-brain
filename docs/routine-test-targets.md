# Unattended routines on shared test environments

The host can now run a sealed bug-fix package through intake, analysis, BEFORE, an owned fix branch and PR, a validated test release, AFTER and human PR review. It never merges a PR or operates production. Package and automatic configuration remain separately versioned, exact user approvals.

## Register an App Service test target

1. Ask the Orchestrator for `app_flow_test_targets`: it returns the actual user-data path of `test-deploy-targets.json` and registered targets.
2. Ask it to call `app_flow_inspect_test_target` with the exact test-only candidate below. The host reads the release definition, hosted queue, service connection and Azure resource, verifies their identities, and computes the current revision/fingerprint. It performs no deployment and does not edit configuration.
3. Review the returned `{schema:1,targets:[...]}` and save it at that path yourself. Preserve other registered targets. This file is user-managed, outside the public repository; the Orchestrator must not install or change it.
4. Copy the returned target unchanged into a new automatic proposal's `devopsWrite.deployTargets`. Approve its operations and exact target in the modal. Changing/removing local registration invalidates the grant at execution; reinspection never silently approves a changed definition.

Candidate (replace synthetic values with your verified private configuration; `definitionRevision` and `definitionSha256` are computed by the inspector):

```json
{
  "kind": "app-service", "id": "shared-test", "confirmedTest": true,
  "organization": "contoso", "project": "Example",
  "projectId": "11111111-2222-3333-4444-555555555555",
  "releaseDefinitionId": 4, "environmentId": 9, "environmentName": "Shared test",
  "queueId": 7, "artifactAlias": "_app", "buildDefinitionId": 6,
  "repositoryId": "11111111-2222-3333-4444-555555555555",
  "subscriptionId": "11111111-2222-3333-4444-555555555555",
  "resourceGroup": "Sample_Test", "webAppName": "sample-test",
  "serviceConnectionId": "11111111-2222-3333-4444-555555555555",
  "allowedTaskIds": ["497d490f-eea7-4f2b-ab94-48d9c1acdcb1"]
}
```

The current adapter supports the Microsoft Azure App Service Deploy v4 task, one agent-based phase on the exact hosted queue, one build artifact, automatic approvals, no gates/variable groups/variables, no slots, dynamic destinations or custom scripts. Extra authority fails closed. The service connection's subscription and the live ARM web app/resource-group identity must match. Azure CLI authentication needs read access for inspection and the approved DevOps operations for execution; credentials never enter package, agent prompt or receipts.

## Update an existing package

Existing versions remain pinned. Create and approve a new version; do not edit a running version or rely on mutable brain files.

| Area | New package contract |
| --- | --- |
| Quiet intake | Set `package.intake: true`. The first agent reads the bug, then calls `flow_intake` with accept or skip. Skip terminates without comments, outputs or lessons. Writes remain unavailable before acceptance. |
| Classification | Record `flow_verdict` ai-fixable explicitly. Initial needs-human is lesson-free; a later downgrade uses the declared lesson output and existing approved tags/state/cleanup. |
| BEFORE / AFTER | Set each step's `testEnvironment` to the registered target ID. Grant `test-environment`. The host acquires ownership before opening/binding its worker and rejects changed-environment evidence. |
| Commit and push | Grant `git-push` with one `pushTargets` entry `{project,repositoryId,workspaceInput}`. The workspace input must be declared by the step. Create and commit on the host-provided `fix/routine-<run-id>` branch, then call `flow_devops_write` `push-branch` with only project/repositoryId. Remove shell push instructions. |
| Draft PR validation | Azure Repos draft PRs do not automatically trigger validation builds. Grant `pr-validation`; call `queue-pr-validation` with targetId and the own PR's current lastMergeCommit. The host requeues the existing exact build-policy evaluation for the approved pipeline, without changing policy, pipeline or draft status. Missing/ambiguous policy blocks with a reason. |
| Test deployment | Grant `test-deploy`. Call `deploy-test` with targetId (optional buildId), then poll `test-deploy-status`. Only this run's live PR merge ref/commit and the approved pipeline's succeeded pullRequest build qualify. Remove shell deployment scripts. |
| History | Set `package.history: true`; use `flow_step_history` for a concise outcome/evidence/next-step summary with safe markdown. The host combines it with the actual outcome and attempt number. Remove duplicate direct progress comments. |
| Models | Read `app_flow_models` before proposing. Specify enabled engine/model IDs and role/tier, or let the host freeze missing facts from the current role. No later silent substitution. |
| Improvement | Read `app_flow_outputs_since_active` with its bounded cursor, inspect lessons and run dossiers, and propose a new sealed version. Outputs never become ambient runtime memory. |

PR publication, work-item resolution, screenshots, related links, independent reviews and bounded rework retain their existing explicit grants/contracts. Mentions are host milestones: accepted intake, block, downgrade and final result. Partial restart across an intake-protocol change is refused; restart from the beginning. Other compatible prefixes retain their accepted intake/verdict.

## Safety and observable limits

- Leases coordinate this app's runs by exact Azure web-app identity, including aliases. The host checks queued/active releases and compares deployment snapshots for the pinned definition/environment. It does **not** lock QA users out or observe another release definition/direct Azure deployment to the same app. A centrally enforced Azure/environment lock is needed for that stronger guarantee.
- A deployment can update only the lease present at its dispatch, once, after proving its initial attempt. Later test leases cannot be rebaselined by polling status. A foreign release/redeployment invalidates evidence.
- Workers waiting for a question/permission must stop before local ownership is released. Cancel, failure, downgrade, context exit and process recovery release local step leases; an active or uncertain remote release keeps its separate lease until proven terminal.
- Work-item revisions and original comment revisions caused by the host are suppressed. Human edits remain eligible, including while a run occupies its concurrency slot. An uncertain write quarantines that item without swallowing other items' updates.
- A lost response to an external write is not success and is not blindly retried. Known release outcomes can reconcile pending deployment/cancellation receipts; unknown creation identities require human investigation.
- Push exports committed HEAD into an isolated bare repository with host configuration, without source hooks/fsmonitor, arbitrary remotes, force or tags. Source-worktree uncommitted changes are not published. The initial implementation bounds the bundle at 256 MiB; a larger repository blocks clearly.
- This change was validated with synthetic/mocked Azure identities. The private reference script and current routine package were unavailable in the supplied archive. No real deployment, DB query, pipeline edit or end-to-end company run was performed.

Design rationale: [ADR 0159](adr/0159-unattended-routine-completion.md). The authored UI E2E specification is intentionally not run on the feature branch; hidden dev captures verify the changed consent and fullscreen surfaces.
