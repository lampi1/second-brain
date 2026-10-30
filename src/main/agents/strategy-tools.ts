// A Strategist's plan with the user (ADR 0108), on its chat's own MCP endpoint (/mcp/chat/:chatId/:token; the caller is
// the token's chat, never an argument), pre-approved like the delegation tools (chats/app-tool-approval.ts) and shown
// only to a Strategist root chat (ChatManager.chatToolShown): plan_propose puts its short plan on its strip for the
// user's «Approva e parti» / «Cambia qualcosa» (the answer comes back as the user's message); plan_update moves a step
// it does itself. Delegated steps move by themselves (agent_delegate's `step`, the children's reports). A first proposal
// before any question is refused unless it says why none was needed (shared/strategy.ts proposalGate, ADR 0121). Used by
// wiring.ts.
import { AWAY_PLAN_NOTE } from '../../shared/away';
import type { McpTool } from '../mcp/server';
import { callerOf } from '../mcp/caller';
import { checkProposal, proposalGate, STEP_STATES, stepIndex, type PlanStep, type StepState, type StrategyPlan } from '../../shared/strategy';
import { WORK_ROLE_IDS } from '../../shared/roles';

/** What the plan tools need from the chats (ChatManager). */
export interface StrategyChats {
  planOf(chatId: string): StrategyPlan | null;
  planPropose(chatId: string, steps: PlanStep[], doneWhen?: string): StrategyPlan;
  planUpdate(chatId: string, i: number, state: StepState): StrategyPlan;
}

export function strategyTools(chats: StrategyChats, away: () => boolean = () => false): McpTool[] {
  const str = { type: 'string' };
  return [{
    name: 'plan_propose',
    description: 'Show the user your short plan for approval (on your strip, or in the questions window when the user has "Popup" on), once your questions made clear what they want: 2 to 6 steps, each one plain line in the user\'s language with the role that does it (leave role out for a step you do yourself) and an optional short detail. Ask at least 3 concrete clarifying questions first, one at a time (fewer only after the user\'s «Basta domande»); only if the request truly settles the rest, pass noQuestionReason. The user approves («Piano approvato: parti.») or writes what to change, as a message: end your turn now and wait; propose again after a change, or re-show a pending plan with plan_propose if its panel was lost. An explicit direct typed approval also counts. agent_delegate is refused until the user approved.',
    inputSchema: { type: 'object', required: ['steps'], additionalProperties: false, properties: {
      steps: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'object', required: ['title'], additionalProperties: false, properties: {
        title: { ...str, description: 'one short plain line, e.g. "Trovo dove si calcola lo sconto"' }, role: { type: 'string', enum: [...WORK_ROLE_IDS] },
        detail: { ...str, description: 'optional: one short line on what the step covers, e.g. "carrello, ordine e reso"' },
      } } },
      doneWhen: { ...str, description: 'optional: when the whole job counts as finished, one line' },
      noQuestionReason: { ...str, description: 'only when the user answered fewer than 3 questions: one line naming what the request already settles' },
    } },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: async (a, ctx) => {
      const id = callerOf(ctx.params), { noQuestionReason, ...proposal } = a, { steps, doneWhen } = checkProposal(proposal);
      // «Modalità notte» (ADR 0191): nobody can answer a clarifying question, so none is required
      const plan = chats.planOf(id), refused = plan && !away() ? proposalGate(plan, noQuestionReason) : null;
      if (refused) throw new Error(refused);
      // the app approved it for the absent user
      if (chats.planPropose(id, steps, doneWhen).phase === 'running') return JSON.stringify({ approved: true, steps: steps.length, note: AWAY_PLAN_NOTE });
      return JSON.stringify({ shown: true, steps: steps.length, note: 'The plan is shown to the user with «Approva e parti» and «Cambia qualcosa». End your turn now: the answer arrives as the user\'s message. Delegate nothing before it.' });
    },
  }, {
    name: 'plan_update',
    description: 'Move a step of your approved plan that you do yourself (or correct one): state now (you started it), done, blocked, or todo. Steps you delegated with agent_delegate\'s `step` move by themselves.',
    inputSchema: { type: 'object', required: ['step', 'state'], additionalProperties: false, properties: {
      step: { type: 'integer', minimum: 1, description: 'the step number, from 1' }, state: { type: 'string', enum: [...STEP_STATES] },
    } },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: async (a, ctx) => {
      const id = callerOf(ctx.params), plan = chats.planOf(id);
      if (!plan) throw new Error('plan_update: only a Strategist with a plan approved by the user has steps.');
      if (!STEP_STATES.includes(a.state as StepState)) throw new Error(`plan_update: state = one of ${STEP_STATES.join(', ')}.`);
      const next = chats.planUpdate(id, stepIndex(plan, a.step, 'plan_update: step'), a.state as StepState);
      return JSON.stringify({ updated: true, done: next.steps.filter(s => s.state === 'done').length, of: next.steps.length, finished: next.phase === 'done' });
    },
  }];
}
