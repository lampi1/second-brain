// A Strategist's plan with the user (ADR 0108), on its chat's own MCP endpoint (/mcp/chat/:chatId/:token; the caller is
// the token's chat, never an argument), pre-approved like the delegation tools (chats/app-tool-approval.ts) and shown
// only to a Strategist root chat (ChatManager.chatToolShown): plan_propose puts its short plan on its strip for the
// user's «Approva e parti» / «Cambia qualcosa» (the answer comes back as the user's message); plan_update moves a step
// it does itself. Delegated steps move by themselves (agent_delegate's `step`, the children's reports). A first proposal
// before three answers requires the user to stop the questions (shared/strategy.ts proposalGate, ADR 0121). Used by
// wiring.ts.
import { AWAY_PLAN_NOTE } from '../../shared/away';
import type { McpTool } from '../mcp/server';
import { callerOf } from '../mcp/caller';
import { checkProposal, checkStep, proposalGate, STEP_STATES, stepIndex, type PlanStep, type StepState, type StrategyPlan } from '../../shared/strategy';
import { WORK_ROLE_IDS } from '../../shared/roles';

/** What the plan tools need from the chats (ChatManager). */
export interface StrategyChats {
  planOf(chatId: string): StrategyPlan | null;
  planPropose(chatId: string, steps: PlanStep[], doneWhen?: string, map?: string): StrategyPlan;
  planUpdate(chatId: string, i: number, state: StepState): StrategyPlan;
  planAdd(chatId: string, step: PlanStep): StrategyPlan;
}
/** The project maps a plan is drawn on (projectmap/service.ts, ADR 0276). */
export interface StrategyMaps {
  /** Puts the plan's new pieces on the project's map (a new map when the project has none), taking back the unstarted
   *  pieces of this chat's earlier proposal; answers the map's folder name and every element id on it. */
  planDraw(chatId: string, a: { project?: unknown; title?: unknown; add?: unknown; links?: unknown; keep?: unknown }): { project: string; elements: string[]; added: string[] };
  /** the element ids of a map */
  elementsOf(project: string): string[];
}
const onCheck = (steps: PlanStep[], ids: string[], what: string): void => {
  const bad = steps.filter(s => s.on !== undefined && !ids.includes(s.on)).map(s => s.on);
  if (bad.length) throw new Error(`${what}: no element ${bad.join(', ')} on the map. Its elements: ${ids.join(', ')} (new ones go in map.add).`);
};

export function strategyTools(chats: StrategyChats, away: () => boolean = () => false, maps?: StrategyMaps): McpTool[] {
  const str = { type: 'string' };
  return [{
    name: 'plan_propose',
    description: 'Show the user your short plan for approval (on your strip, or in the questions window when the user has "Popup" on), once your questions made clear what they want: 2 to 6 steps, each one plain line in the user\'s language with the role that does it (leave role out for a step you do yourself) and an optional short detail. Ask at least 3 concrete clarifying questions first, one at a time (fewer only after the user\'s «Basta domande»), including a verified intake answer. The user approves («Piano approvato: parti.») or writes what to change, as a message: end your turn now and wait; propose again after a change, or re-show a pending plan with plan_propose if its panel was lost. An explicit direct typed approval also counts. agent_delegate is refused until the user approved. Work on a project: draw it on the project\'s map with `map` and each step\'s `on` (project_map_read shows the map and its element ids).',
    inputSchema: { type: 'object', required: ['steps'], additionalProperties: false, properties: {
      steps: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'object', required: ['title'], additionalProperties: false, properties: {
        title: { ...str, description: 'one short plain line, e.g. "Trovo dove si calcola lo sconto"' }, role: { type: 'string', enum: [...WORK_ROLE_IDS] },
        detail: { ...str, description: 'optional: one short line on what the step covers, e.g. "carrello, ordine e reso"' },
        on: { ...str, description: 'the map element this step works on (an existing id, or one you add in map.add)' },
      } } },
      map: { type: 'object', additionalProperties: false, description: 'the project map the plan is drawn on', properties: {
        project: { ...str, description: 'an existing map\'s name or id' }, title: { ...str, description: 'the project\'s name, when it has no map yet: only the pieces this work touches get drawn' },
        add: { type: 'array', maxItems: 20, description: 'the pieces that do not exist yet (shown dashed, «previsto»)', items: { type: 'object', required: ['name'], additionalProperties: false, properties: {
          id: str, name: str, kind: { type: 'string', enum: ['person', 'system', 'external', 'env', 'doc', 'part'] }, description: str, parent: { ...str, description: 'for a part: its system' } } } },
        links: { type: 'array', maxItems: 20, items: { type: 'object', required: ['from', 'to', 'label'], additionalProperties: false, properties: { from: str, to: str, label: str } } },
      } },
      doneWhen: { ...str, description: 'optional: when the whole job counts as finished, one line' },
    } },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: async (a, ctx) => {
      const { map: mapArg, ...rest } = a;
      const id = callerOf(ctx.params), { steps, doneWhen } = checkProposal(rest);
      // «Modalità notte» (ADR 0191): nobody can answer a clarifying question, so none is required
      const plan = chats.planOf(id), refused = plan && !away() ? proposalGate(plan) : null;
      if (refused) throw new Error(refused);
      let map: string | undefined;
      if (mapArg !== undefined) {
        if (!maps) throw new Error('plan_propose: project maps are not available here; leave map out.');
        if (!mapArg || typeof mapArg !== 'object' || Array.isArray(mapArg)) throw new Error('map: object required.');
        const drawn = maps.planDraw(id, mapArg as Record<string, unknown>);
        onCheck(steps, drawn.elements, 'steps[].on');
        map = drawn.project;
      } else if (steps.some(s => s.on !== undefined)) throw new Error('steps[].on needs map (the project the plan is drawn on).');
      // the app approved it for the absent user
      if (chats.planPropose(id, steps, doneWhen, map).phase === 'running') return JSON.stringify({ approved: true, steps: steps.length, note: AWAY_PLAN_NOTE });
      return JSON.stringify({ shown: true, steps: steps.length, note: 'The plan is shown to the user with «Approva e parti» and «Cambia qualcosa». End your turn now: the answer arrives as the user\'s message. Delegate nothing before it.' });
    },
  }, {
    name: 'plan_update',
    description: 'Move a step of your approved plan that you do yourself (or correct one): state now (you started it), done, blocked, or todo. Steps you delegated with agent_delegate\'s `step` move by themselves. A piece you discover on the way: `add` it as one more step (no new approval; the user sees it marked new) and delegate it by its number.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      step: { type: 'integer', minimum: 1, description: 'the step number, from 1' }, state: { type: 'string', enum: [...STEP_STATES] },
      add: { type: 'object', required: ['title'], additionalProperties: false, description: 'instead of step and state: a new step', properties: { title: str, role: { type: 'string', enum: [...WORK_ROLE_IDS] }, detail: str,
        on: { ...str, description: 'the map element it works on' }, piece: { type: 'object', required: ['name'], additionalProperties: false, description: 'a new map piece for it (then leave `on` out)', properties: { name: str, kind: str, description: str, parent: str } } } },
    } },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: async (a, ctx) => {
      const id = callerOf(ctx.params), plan = chats.planOf(id);
      if (!plan) throw new Error('plan_update: only a Strategist with a plan approved by the user has steps.');
      if (a.add !== undefined) {
        const { piece, ...raw } = (a.add && typeof a.add === 'object' ? a.add : {}) as Record<string, unknown>;
        let step = checkStep(raw);
        if (plan.map && maps) {
          if (piece !== undefined) { const drawn = maps.planDraw(id, { project: plan.map, add: [piece], keep: true }); step = { ...step, on: drawn.added[0]! }; }
          onCheck([step], maps.elementsOf(plan.map), 'add.on');
        } else if (step.on !== undefined || piece !== undefined) throw new Error('plan_update add: this plan is not drawn on a map; leave on and piece out.');
        const grown = chats.planAdd(id, step);
        return JSON.stringify({ added: true, step: grown.steps.length, of: grown.steps.length });
      }
      if (!STEP_STATES.includes(a.state as StepState)) throw new Error(`plan_update: state = one of ${STEP_STATES.join(', ')}.`);
      const next = chats.planUpdate(id, stepIndex(plan, a.step, 'plan_update: step'), a.state as StepState);
      return JSON.stringify({ updated: true, done: next.steps.filter(s => s.state === 'done').length, of: next.steps.length, finished: next.phase === 'done' });
    },
  }];
}
