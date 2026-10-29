// Portable automatic-flow configuration and durable event envelope, shared with host and decision UI.
// Activation authorizes detection, dispatch and the explicit host grants below; existing flow gates retain their authority.
import type { FlowScope } from './flows';
export type FlowTrigger = { kind: 'manual' } | { kind: 'interval'; everyMinutes: number } | {
  kind: 'devops'; everyMinutes: number; organization: string; project: string; areaPath: string;
  workItemType: string; states: string[]; includeExisting: boolean;
  /** Filters (ADR 0155): every include tag must be on the item, no exclude tag may be; ids = only these items;
   *  iterationPath = under this iteration; maxPerHour = at most this many starts per hour (queue keeps the rest). */
  includeTags?: string[]; excludeTags?: string[]; workItemIds?: number[]; iterationPath?: string; maxPerHour?: number;
};
/** User-approved DevOps write categories; anything not listed is denied by the host (ADR 0145). */
export const DEVOPS_WRITE_OPS = ['tags', 'comment', 'fields', 'test-plans', 'test-results', 'pr-links', 'rich-comments', 'attachments', 'related-links', 'pr-create', 'pr-comment', 'pr-publish', 'pr-abandon', 'test-deploy', 'test-environment', 'git-push', 'pr-validation'] as const;
export type DevOpsWriteOp = typeof DEVOPS_WRITE_OPS[number];
/** The exact write grant shown in the approval modal: one organization, its projects, ops and work item fields. */
export interface DevOpsWriteGrant { organization: string; projects: string[]; ops: DevOpsWriteOp[]; fields: string[];
  /** DevOps identity ids (GUIDs, lowercase) a comment may @mention; absent or empty = no mentions. Needs the comment op. */
  mentions?: string[];
  /** Exact user-configured test-only targets, displayed in the approval modal and revalidated before every request. */
  deployTargets?: TestDeployTarget[];
  /** Exact destination and host-bound workspace input for routine branch publication. */
  pushTargets?: { project: string; repositoryId: string; workspaceInput: string }[] }
export interface TestDeployTargetBase {
  id: string; organization: string; project: string; projectId: string; releaseDefinitionId: number; definitionRevision: number; definitionSha256: string;
  environmentId: number; environmentName: string; queueId: number;
  artifactAlias: string; buildDefinitionId: number; repositoryId: string; confirmedTest: true;
}
export interface MachineTestDeployTarget extends TestDeployTargetBase {
  kind?: 'deployment-group'; deploymentGroupId: number; poolId: number; agentId: number; machineId: number; machineName: string; computerName: string;
}
export interface AppServiceTestDeployTarget extends TestDeployTargetBase {
  kind: 'app-service'; subscriptionId: string; resourceGroup: string; webAppName: string; serviceConnectionId: string;
  allowedTaskIds: string[];
}
export type TestDeployTarget = MachineTestDeployTarget | AppServiceTestDeployTarget;
/** Local test DB target identifiers explicitly approved for this exact automation revision; absent = deny-all. */
export interface TestDbReadGrant { targetIds: string[] }
export interface FlowAutomationConfig {
  flowId: string; flowVersion: number; trigger: FlowTrigger; scope: FlowScope;
  inputs: Record<string, string>; priority: 'urgent' | 'normal';
  /** Absent = deny-all. Independent of trigger kind; approval is the configuration's exact revision. */
  devopsWrite?: DevOpsWriteGrant;
  testDbRead?: TestDbReadGrant;
}
export interface FlowAutomationRule {
  id: string; revision: number; config: FlowAutomationConfig; ownerOrchestratorId: string;
  status: 'proposed' | 'enabled' | 'paused' | 'rejected'; approvedRevision?: number;
  createdAt: number; updatedAt: number; approvedAt?: number; feedback?: string;
  nextCheckAt?: number; lastCheckAt?: number; lastResult?: string; error?: string; failures: number;
  /** Earlier approved revisions still granting the runs they started (a filter edit or a carried new flow version
   *  keeps in-flight runs working, ADR 0155); newest last, at most 10. */
  history?: { revision: number; config: FlowAutomationConfig }[];
}
export interface FlowAutomationEvent {
  id: string; ruleId: string; ruleRevision: number; sourceKey: string; subjectKey: string;
  title: string; inputs: Record<string, string>; createdAt: number; updatedAt: number;
  status: 'pending' | 'notified' | 'started' | 'blocked' | 'cancelled'; attempts: number;
  /** a start the user asked for on one work item (Routine page), not a detection */
  manual?: true;
  nextAttemptAt?: number; runId?: string; reason?: string;
}
export interface FlowAutomationSnapshot {
  revision: number; paused: boolean; background: boolean; rules: FlowAutomationRule[];
  events: FlowAutomationEvent[]; storageError?: string;
}
export interface FlowDetectionItem { key: string; title: string; inputs: Record<string, string> }
/** A detector never writes external state. Cursor is committed atomically with the corresponding events. */
export interface FlowDetectionResult { cursor: Record<string, string>; items: FlowDetectionItem[]; summary: string }
