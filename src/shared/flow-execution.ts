// One execution catalog shared by authoring, activation, automation and the runner; no implicit authority.
import type { FlowDefinition, FlowStep } from './flows';
import { browserWriteStep } from './flow-browser';
export type ExecutionKind = 'agent' | 'browser' | 'devops' | 'script' | 'query' | 'connector' | 'builtin' | 'user' | 'unsupported';
export interface ExecutionCheck { stepId: string; capability: ExecutionKind; state: 'supported' | 'configuration' | 'user' | 'unsupported'; detail: string }
export function executionKind(step: FlowStep): ExecutionKind {
  if (step.kind === 'approval' || step.kind === 'manual') return 'user';
  if (step.kind === 'check' && step.connector) return 'connector';
  if (step.kind === 'check' && step.action?.hash && (step.action.kind === 'script' || step.action.kind === 'query')) return step.action.kind;
  if (step.effect === 'production' || step.env === 'prod') return 'unsupported';
  if (step.kind === 'check' && step.action?.kind === 'builtin') return 'builtin';
  if (browserWriteStep(step)) return 'browser';
  if (step.kind === 'agent' && !step.action) {
    if (step.adapter === 'devops-write') return 'devops';
    if (step.effect !== 'external-write') return 'agent';
  }
  return 'unsupported';
}
export function executionChecks(definition: FlowDefinition): ExecutionCheck[] {
  return definition.steps.map(step => {
    const capability = executionKind(step);
    if (capability === 'unsupported') return { stepId: step.id, capability, state: 'unsupported', detail: 'Choose an agent with browser targets, a configured connector call, an embedded script/query, or a user step. A plain external-write instruction is not executable.' };
    if (capability === 'user' || step.env === 'prod') return { stepId: step.id, capability, state: 'user', detail: 'This step intentionally waits for the user.' };
    if (capability === 'devops' || step.testDbRead || step.adapter === 'test-db-read' || step.testEnvironment) return { stepId: step.id, capability, state: 'configuration', detail: 'Approve the exact execution grants with a manual, interval or DevOps trigger. A missing grant is configuration, not a missing app feature.' };
    if (capability === 'connector') return { stepId: step.id, capability, state: 'configuration', detail: 'The registered test-only connector, pinned tool schema and role access are checked before dispatch.' };
    return { stepId: step.id, capability, state: 'supported', detail: capability === 'script' || capability === 'query' ? 'Pinned content runs with local process authority; review the exact code. Credentials/interpreter are checked locally.' : capability === 'browser' ? 'Exact approved origins; requires the Claude browser boundary.' : 'Existing execution capability; inputs and environment are checked before launch.' };
  });
}
