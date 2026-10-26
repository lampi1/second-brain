// Opens an idle routine worker under existing catalog/engine policies; runtime binds it before sending any work.
// The runner's runs need no open Orchestrator (ADR 0155): without one, the Orchestrator chats' default engine is the
// opener. A step's engine/model pick (the user's, for experiments) wins over the role's routing, under the same
// engine policy (openRefusal). Used by service wiring, with dependency ports so routing can be tested without Electron.
import type { NewChat, ChatSummary } from '../../shared/contract';
import type { AgentCatalogService } from '../agents/catalog';
import type { BrainService } from '../services';
import { openRefusal } from '../engines/policy';
import { tierRank } from '../../shared/roles';
import type { FlowWorkerRequest } from './runtime';

interface WorkerPorts {
  catalog: Pick<AgentCatalogService, 'resolve' | 'list'>;
  brain: Pick<BrainService, 'settings' | 'route'>;
  chats(): readonly ChatSummary[];
  create(request: NewChat, sealed?: { digest: string; instructions: string }, routine?: ChatSummary['routine']): Promise<ChatSummary>;
}
export function createFlowWorker(ports: WorkerPorts) {
  return async (request: FlowWorkerRequest): Promise<ChatSummary> => {
    const routine = { runId: request.flowRunId, stepId: request.stepId, ...(request.browserWrite ? { browserWrite: true as const } : {}) };
    const settings = ports.brain.settings();
    const owner = ports.chats().find(chat => chat.id === request.ownerId && chat.isOrchestrator && !chat.closedAt);
    const opener = owner?.harness ?? settings.orchestratorChats.harness;
    const profile = ports.catalog.list().profiles.find(role => role.id === request.roleId);
    if (!profile) throw new Error('The routine role is unavailable.');
    // Flow evidence allows more labels than chat launch criteria. The runtime prompt and report validator retain
    // every label; an empty explicit launch contract still requires agent_report, without truncating evidence.
    const input: NewChat = { harness: opener, cwd: request.workspace, title: request.title,
      roleId: request.roleId, roleVersion: profile.activeVersion, goal: request.goal.slice(0, 2000),
      doneWhen: request.doneWhen.length <= 12 ? request.doneWhen : [], deliveryPolicy: 'display',
      ...(request.tier ? { tier: request.tier } : {}), ...(request.reviewOf ? { reviewOf: request.reviewOf } : {}) };
    if (request.packageDigest) {
      if (!request.agentPrompt || !request.engine || !request.model || !request.tier || tierRank(request.tier) > tierRank(profile.tierMax)) throw new Error('Incomplete frozen routine worker');
      const refusal = openRefusal(settings, opener, request.engine as NewChat['harness']);
      if (refusal) throw new Error(`Routine worker: ${refusal}`);
      return ports.create({ ...input, harness: request.engine as NewChat['harness'], model: request.model, ...(request.effort ? { effort: request.effort } : {}) }, { digest: request.packageDigest, instructions: request.agentPrompt }, routine);
    }
    const resolved = ports.catalog.resolve(input);
    const agent = { id: profile.id, name: profile.name, version: profile.activeVersion,
      harness: resolved.request.harness, model: resolved.request.model ?? null, effort: resolved.request.effort ?? null,
      chosenBy: 'orchestrator' as const, ...(resolved.tier ? { tier: resolved.tier } : {}),
      ...(resolved.modelFrom ? { modelFrom: resolved.modelFrom } : {}), stats: null };
    const routed = ports.brain.route({ api: null, agent, title: input.title!, prompt: request.goal, ask: {},
      canRun: harness => !openRefusal(settings, opener, harness),
      defaults: { harness: settings.orchestratorChats.harness,
        models: { claude: settings.orchestratorChats.claudeModel || null, cursor: settings.orchestratorChats.cursorModel || null },
        effort: settings.orchestratorChats.claudeEffort || null } });
    if ('error' in routed) throw new Error(`Routine worker: ${routed.error}`);
    // the step's own pick: its engine (with its model, or the engine's default), else the routed engine with its model
    const harness = (request.engine ?? routed.harness) as typeof routed.harness;
    const model = request.model ?? (request.engine && request.engine !== routed.harness ? undefined : routed.model);
    const effort = request.effort ?? routed.effort;
    const refusal = openRefusal(settings, opener, harness);
    if (refusal) throw new Error(`Routine worker: ${refusal}`);
    return ports.create({ ...input, harness, ...(model ? { model } : {}), ...(effort ? { effort } : {}), route: routed.route }, undefined, routine);
  };
}
