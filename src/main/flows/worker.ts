// Opens an idle routine worker under existing catalog/engine policies; runtime binds it before sending any work.
// Used by service wiring, with dependency ports so routing and first-turn ordering can be tested without Electron.
import type { NewChat, ChatSummary } from '../../shared/contract';
import type { AgentCatalogService } from '../agents/catalog';
import type { BrainService } from '../services';
import { openRefusal } from '../engines/policy';
import type { FlowWorkerRequest } from './runtime';

interface WorkerPorts {
  catalog: Pick<AgentCatalogService, 'resolve' | 'list'>;
  brain: Pick<BrainService, 'settings' | 'route'>;
  chats(): readonly ChatSummary[];
  create(request: NewChat): Promise<ChatSummary>;
}
export function createFlowWorker(ports: WorkerPorts) {
  return async (request: FlowWorkerRequest): Promise<ChatSummary> => {
    const owner = ports.chats().find(chat => chat.id === request.ownerId && chat.isOrchestrator && !chat.closedAt);
    if (!owner) throw new Error('The routine owner is unavailable; reopen its Orchestrator.');
    const profile = ports.catalog.list().profiles.find(role => role.id === request.roleId);
    if (!profile) throw new Error('The routine role is unavailable.');
    // Flow evidence allows more labels than chat launch criteria. The runtime prompt and report validator retain
    // every label; an empty explicit launch contract still requires agent_report, without truncating evidence.
    const input: NewChat = { harness: owner.harness, cwd: request.workspace, title: request.title,
      roleId: request.roleId, roleVersion: profile.activeVersion, goal: request.goal.slice(0, 2000),
      doneWhen: request.doneWhen.length <= 12 ? request.doneWhen : [], deliveryPolicy: 'display',
      ...(request.tier ? { tier: request.tier } : {}), ...(request.reviewOf ? { reviewOf: request.reviewOf } : {}) };
    const resolved = ports.catalog.resolve(input), settings = ports.brain.settings();
    const agent = { id: profile.id, name: profile.name, version: profile.activeVersion,
      harness: resolved.request.harness, model: resolved.request.model ?? null, effort: resolved.request.effort ?? null,
      chosenBy: 'orchestrator' as const, ...(resolved.tier ? { tier: resolved.tier } : {}),
      ...(resolved.modelFrom ? { modelFrom: resolved.modelFrom } : {}), stats: null };
    const routed = ports.brain.route({ api: null, agent, title: input.title!, prompt: request.goal, ask: {},
      canRun: harness => !openRefusal(settings, owner.harness, harness),
      defaults: { harness: settings.orchestratorChats.harness,
        models: { claude: settings.orchestratorChats.claudeModel || null, cursor: settings.orchestratorChats.cursorModel || null },
        effort: settings.orchestratorChats.claudeEffort || null } });
    if ('error' in routed) throw new Error(`Routine worker: ${routed.error}`);
    const refusal = openRefusal(settings, owner.harness, routed.harness);
    if (refusal) throw new Error(`Routine worker: ${refusal}`);
    return ports.create({ ...input, harness: routed.harness, ...(routed.model ? { model: routed.model } : {}),
      ...(routed.effort ? { effort: routed.effort } : {}), route: routed.route });
  };
}
