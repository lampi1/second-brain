// A Strategist's plan with the user (ADR 0108), on its chat's own MCP endpoint (/mcp/chat/:chatId/:token; the caller is
// the token's chat, never an argument), pre-approved like the delegation tools (chats/app-tool-approval.ts) and shown
// only to a Strategist root chat (ChatManager.chatToolShown): plan_propose puts its short plan on its strip for the
// user's «Approva e parti» / «Cambia qualcosa» (the answer comes back as the user's message); plan_update moves a step
// it does itself. Delegated steps move by themselves (agent_delegate's `step`, the children's reports). A first proposal
// before three answers requires the user to stop the questions (shared/strategy.ts proposalGate, ADR 0121). Used by
// wiring.ts.
import { AWAY_PLAN_NOTE } from '../../shared/away';
import type { McpTool } from '../mcp/server';
import type { ChatSummary } from '../../shared/contract';
import { callerOf } from '../mcp/caller';
import type { PresetId } from '../../shared/model-presets';
import { checkProposal, checkRevision, checkStep, proposalGate, STEP_STATES, stepIndex, type PlanStep, type StepState, type StrategyPlan, withAdded } from '../../shared/strategy';
import { WORK_ROLE_IDS } from '../../shared/roles';

/** What the plan tools need from the chats (ChatManager). */
export interface StrategyChats {
  planOf(chatId: string): StrategyPlan | null;
  planPropose(chatId: string, steps: PlanStep[], doneWhen?: string, map?: string, revise?: boolean): StrategyPlan;
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
/** The model and preset of a step (2026-11-23: the map shows role · model · preset per step): a started step's from its
 *  chat, the others from the role card (catalog.presetChoice); the caller = the plan's Strategist, for its own steps. */
export type StepModel = (callerId: string, step: PlanStep) => { preset?: PresetId; model?: string };
/** The app's StepModel (wiring.ts): `chat` reads a chat, `card` = catalog.presetChoice for a role and a preset. */
export function stepModelOf(chat: (id: string) => Pick<ChatSummary, 'model' | 'run' | 'agent'> | undefined, card: (roleId: string, preset?: PresetId) => { preset: PresetId; model: string | null } | null): StepModel {
  const fromChat = (c: Pick<ChatSummary, 'model' | 'run'> | undefined) => c ? { ...(c.run?.presetChoice?.preset ? { preset: c.run.presetChoice.preset } : {}), ...(c.model ? { model: c.model } : {}) } : {};
  return (callerId, step) => {
    // a started step: what its last chat really runs on
    const started = step.state !== 'todo' && step.chatIds?.length ? chat(step.chatIds[step.chatIds.length - 1]!) : undefined;
    if (started) return fromChat(started);
    // a step the Strategist does itself: its own chat
    if (!step.role) return fromChat(chat(callerId));
    const c = card(step.role, step.preset);
    return c ? { preset: c.preset, ...(c.model ? { model: c.model } : {}) } : {};
  };
}
const withModels =(steps: PlanStep[], callerId: string, of?: StepModel): PlanStep[] => !of ? steps : steps.map(s => {
  const m = of(callerId, s);
  return { ...s, ...(m.preset ? { preset: m.preset } : {}), ...(m.model ? { model: m.model } : {}) };
});
const onCheck =(steps: PlanStep[], ids: string[], what: string): void => {
  const bad = steps.filter(s => s.on !== undefined && !ids.includes(s.on)).map(s => s.on);
  if (bad.length) throw new Error(`${what}: no element ${bad.join(', ')} on the map. Its elements: ${ids.join(', ')} (new ones go in map.add).`);
};

export function strategyTools(chats: StrategyChats, away: () => boolean = () => false, maps?: StrategyMaps, stepModel?: StepModel): McpTool[] {
  const str = { type: 'string' };
  return [{
    name: 'plan_propose',
    description: 'Show the user your short plan for approval (on your strip, or in the questions window when the user has "Popup" on), once your questions made clear what they want: 2 to 6 steps, each one plain line in the user\'s language with the role that does it (leave role out for a step you do yourself) and an optional short detail. Ask at least 3 concrete clarifying questions first, one at a time (fewer only after the user\'s «Basta domande»), including a verified intake answer. The user approves («Piano approvato: parti.») or writes what to change, as a message: end your turn now and wait; propose again after a change, or re-show a pending plan with plan_propose if its panel was lost. An explicit direct typed approval also counts. agent_delegate is refused until the user approved. Work on a project: draw it on the project\'s map with `map` and each step\'s `on` (project_map_read shows the map and its element ids). «Aggiorna il piano»: revise: true, the whole plan again, every started or done step as { keep: n }; approval again.',
    inputSchema: { type: 'object', required: ['steps'], additionalProperties: false, properties: {
      revise: { type: 'boolean', description: 'true = bring this plan to the current standard (also under way): started and done steps come back as { keep: n }, the rest is checked as new; the user approves again' },
      steps: { type: 'array', minItems: 1, maxItems: 16, items: { type: 'object', additionalProperties: false, properties: {
        keep: { type: 'integer', minimum: 1, description: 'revise only: the old number of a step to keep as it is (then only par besides it)' },
        title: { ...str, description: 'one short plain line, e.g. "Trovo dove si calcola lo sconto"' }, role: { type: 'string', enum: [...WORK_ROLE_IDS] },
        detail: { ...str, description: 'optional: one short line on what the step covers, e.g. "carrello, ordine e reso"' },
        on: { ...str, description: 'the map element this step works on (an existing id, or one you add in map.add)' },
        par: { type: 'boolean', description: 'true = it does not depend on the step before it and runs together with it, in the same parallel group (delegated in the same agent_delegate call); leave out for a step that waits for the steps before it' },
        preset: { type: 'string', enum: ['min', 'base', 'max'], description: 'the role card\'s preset for this step; leave out for Base; the map shows role · model · preset' },
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
      const { map: mapArg, revise: reviseArg, ...rest } = a;
      if (reviseArg !== undefined && typeof reviseArg !== 'boolean') throw new Error('revise: true or false.');
      const revise = reviseArg === true, id = callerOf(ctx.params), plan = chats.planOf(id);
      if (revise && (!plan || !plan.steps.length)) throw new Error('plan_propose revise: there is no plan of yours to revise; propose it without revise.');
      const checked = revise ? checkRevision(plan!, rest) : checkProposal(rest);
      const doneWhen = checked.doneWhen, steps = withModels(checked.steps, id, stepModel);
      // «Modalità notte» (ADR 0191): nobody can answer a clarifying question, so none is required; a revision was asked
      const refused = plan && !away() && !revise ? proposalGate(plan) : null;
      if (refused) throw new Error(refused);
      let map: string | undefined;
      if (mapArg !== undefined) {
        if (!maps) throw new Error('plan_propose: project maps are not available here; leave map out.');
        if (!mapArg || typeof mapArg !== 'object' || Array.isArray(mapArg)) throw new Error('map: object required.');
        // nothing is drawn for a proposal that will be refused
        if (!plan) throw new Error('plan_propose: only a Strategist the Orchestrator or the user started has a plan with the user.');
        if (!revise && (plan.phase === 'running' || plan.phase === 'done')) throw new Error('plan_propose: the plan is approved and under way; update its steps with plan_update.');
        const drawn = maps.planDraw(id, mapArg as Record<string, unknown>);
        onCheck(steps, drawn.elements, 'steps[].on');
        map = drawn.project;
      } else if (revise && plan?.map) {
        // a revision keeps the plan's map: its elements still check every step's `on`
        if (maps) onCheck(steps, maps.elementsOf(plan.map), 'steps[].on');
        map = plan.map;
      } else if (steps.some(s => s.on !== undefined)) throw new Error('steps[].on needs map (the project the plan is drawn on).');
      // the app approved it for the absent user
      if (chats.planPropose(id, steps, doneWhen, map, revise).phase === 'running') return JSON.stringify({ approved: true, steps: steps.length, note: AWAY_PLAN_NOTE });
      return JSON.stringify({ shown: true, steps: steps.length, note: 'The plan is shown to the user with «Approva e parti» and «Cambia qualcosa». End your turn now: the answer arrives as the user\'s message. Delegate nothing before it.' });
    },
  }, {
    name: 'plan_update',
    description: 'Move a step of your approved plan that you do yourself (or correct one): state now (you started it), done, blocked, or todo. Steps you delegated with agent_delegate\'s `step` move by themselves. A piece you discover on the way: `add` it as one more step (no new approval; the user sees it marked new) and delegate it by its number.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      step: { type: 'integer', minimum: 1, description: 'the step number, from 1' }, state: { type: 'string', enum: [...STEP_STATES] },
      add: { type: 'object', required: ['title'], additionalProperties: false, description: 'instead of step and state: a new step', properties: { title: str, role: { type: 'string', enum: [...WORK_ROLE_IDS] }, detail: str,
        on: { ...str, description: 'the map element it works on' }, par: { type: 'boolean', description: 'true = together with the step before it' }, piece: { type: 'object', required: ['name'], additionalProperties: false, description: 'a new map piece for it (then leave `on` out)', properties: { name: str, kind: str, description: str, parent: str } } } },
    } },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: async (a, ctx) => {
      const id = callerOf(ctx.params), plan = chats.planOf(id);
      if (!plan) throw new Error('plan_update: only a Strategist with a plan approved by the user has steps.');
      if (a.add !== undefined) {
        const { piece, ...raw } = (a.add && typeof a.add === 'object' ? a.add : {}) as Record<string, unknown>;
        let step = checkStep(raw);
        withAdded(plan, step, 0); // refused before anything is drawn
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
