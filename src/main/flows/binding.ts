// Host-only launch identity shared by automatic/manual binding, reports and routine-scoped adapters.
import { createHash } from 'node:crypto';
import type { ChatSummary } from '../../shared/contract';
import type { FlowAgentBinding, FlowRun, FlowStep } from '../../shared/flows';
export function launchOf(chat: ChatSummary): FlowAgentBinding['launched'] {
  const route = chat.route?.agent;
  return { roleId: chat.run?.agentId, tier: chat.routinePackage ? chat.run?.tier : route?.tier,
    ...(!chat.routinePackage && route?.modelFrom === 'table' ? { fromTable: true } : {}),
    packageDigest: chat.routinePackage, promptHash: chat.routinePromptHash, engine: chat.harness, model: chat.model, effort: chat.effort ?? undefined };
}
export function assertPackageBinding(run: FlowRun, step: FlowStep, binding: FlowAgentBinding): void {
  if (!step.agentPrompt) return;
  const actual = binding.launched;
  if (!actual || actual.packageDigest !== run.definitionDigest || actual.promptHash !== createHash('sha256').update(step.agentPrompt).digest('hex')
    || actual.roleId !== step.role || actual.tier !== step.tier || actual.fromTable || actual.engine !== step.engine || actual.model !== step.model || (step.effort && actual.effort !== step.effort)) {
    throw new Error('Frozen routine worker package, prompt, role, tier, engine, model or effort does not match the approved step');
  }
}
