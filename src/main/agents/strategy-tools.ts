// A Strategist's plan with the user (ADR 0108, 0359), on its chat's own MCP endpoint (/mcp/chat/:chatId/:token; the caller is
// the token's chat, never an argument), pre-approved like the delegation tools (chats/app-tool-approval.ts) and shown
// only to a Strategist root chat (ChatManager.chatToolShown): plan_propose puts its plan on the job's page (Piani) for
// the user's «Approva e parti» / «Cambia il piano» (the answer comes back as the user's message); plan_update moves a step
// it does itself, with the proof of a «fatto». Delegated steps move by themselves (agent_delegate's `step`, the children's
// reports). A first proposal lists its doubts and one open doubt keeps the plan from being shown for approval
// (shared/plan-doubts.ts, ADR 0344). Each step says what it waits for (`after`) and what it touches: the plan is split to run
// fast without losing quality (shared/strategy.ts PARALLEL_RULE). Used by wiring.ts.
import { AWAY_PLAN_NOTE } from '../../shared/away';
import type { McpTool } from '../mcp/server';
import type { ChatSummary } from '../../shared/contract';
import { callerOf } from '../mcp/caller';
import type { PresetId } from '../../shared/model-presets';
import { checkProposal, checkRevision, checkStep, DETAIL_ASK, DONE_WHEN_MAX, proposalGate, PLAN_HANDED, stepIndex, STEPS_MAX, TITLE_ASK, type StrategyPlan } from '../../shared/strategy';
import { STEP_STATES, type PlanStep, type StepProof, type StepState } from '../../shared/plan-steps';
import { WORK_ROLE_IDS } from '../../shared/roles';
import { checkDoubts, DOUBT_BY, DOUBTS_MAX, openDoubts, openDoubtsNote, type DoubtEvidence, type PlanDoubt } from '../../shared/plan-doubts';

/** What the plan tools need from the chats (ChatManager). */
export interface StrategyChats {
  planOf(chatId: string): StrategyPlan | null;
  planPropose(chatId: string, steps: PlanStep[], doneWhen?: string, revise?: boolean, doubts?: PlanDoubt[]): StrategyPlan;
  /** the list of doubts of a plan not (yet) to approve */
  planDoubts(chatId: string, doubts: PlanDoubt[]): StrategyPlan;
  /** what the user really said, as the app recorded it: only this closes a doubt «by the user» */
  doubtEvidence(chatId: string): DoubtEvidence;
  planUpdate(chatId: string, i: number, state: StepState, proof?: string): StrategyPlan;
  planAdd(chatId: string, step: PlanStep): StrategyPlan;
}
/** The preset of a step (ADR 0346: the plan names a preset, never a model): a started step's from its chat, the others
 *  the one the plan asks, as the role card's guards would give it (catalog.presetChoice); the caller = the plan's
 *  Strategist, for its own steps. */
export type StepPreset = (callerId: string, step: PlanStep) => PresetId | undefined;
/** The app's StepPreset (wiring.ts): `chat` reads a chat, `card` = catalog.presetChoice for a role and a preset. */
export function stepPresetOf(chat: (id: string) => Pick<ChatSummary, 'run'> | undefined, card: (roleId: string, preset?: PresetId) => { preset: PresetId } | null): StepPreset {
  return (callerId, step) => {
    // a started step: what its last chat really runs on
    const started = step.state !== 'todo' && step.chatIds?.length ? chat(step.chatIds[step.chatIds.length - 1]!) : undefined;
    if (started) return started.run?.presetChoice?.preset;
    // a step the Strategist does itself: its own chat
    if (!step.role) return chat(callerId)?.run?.presetChoice?.preset;
    return card(step.role, step.preset)?.preset;
  };
}
const withPresets = (steps: PlanStep[], callerId: string, of?: StepPreset): PlanStep[] => !of ? steps : steps.map(s => {
  const preset = of(callerId, s);
  return { ...s, ...(preset ? { preset } : {}) };
});

export function strategyTools(chats: StrategyChats, away: () => boolean = () => false, stepPreset?: StepPreset): McpTool[] {
  const str = { type: 'string' };
  return [{
    name: 'plan_propose',
    description: 'Every step needs title and after (the numbers of the steps it waits for, [] = starts at once); title at most ' + TITLE_ASK + ' characters, detail at most ' + DETAIL_ASK + ', doneWhen at most ' + DONE_WHEN_MAX + ', at most ' + STEPS_MAX + ' new steps; a step takes only title, role, detail, after, touches, minutes, preset (keep with revise). Show the user your plan for approval (on its page), once your questions made clear what they want: as many steps as the work needs, each one plain line in the user\'s language with the role that does it (leave role out for a step you do yourself) and an optional short detail. Split it so that as many steps as really can run at the same time do: `after` = the numbers of the steps a step waits for ([] = it starts at once), `touches` = what it writes or holds alone (two steps that may run together never share one), `minutes` = your estimate. `doubts` = every real doubt of the job ([] when nothing is open), each closed by the user\'s recorded answer, the code or the brain with its source; while one is open the plan is not shown for approval (doubts may come alone, before the steps). The user approves («Piano approvato: parti.») or writes what to change, as a message: end your turn now and wait; propose again after a change, or re-show a pending plan with plan_propose if its panel was lost. An explicit direct typed approval also counts. agent_delegate is refused until the user approved. «Aggiorna il piano»: revise: true, the whole plan again, every started or ended step as { keep: n } or, when the new plan does not need a started one any more, its number in `remove`; approval again: until then what started goes on and nothing new starts. The plan\'s page is kept by the app, with no call. The rest of the user\'s plans: the `plans` tool.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      doubts: { type: 'array', maxItems: DOUBTS_MAX, description: 'every doubt of this job, open and closed; a doubt open before must come back', items: { type: 'object', required: ['text'], additionalProperties: false, properties: {
        text: { ...str, description: 'the doubt as a Sì/No question in the user\'s language; ask it with these words' },
        by: { type: 'string', enum: [...DOUBT_BY], description: 'who closed it (leave out while open): user = his recorded answer; code | brain = where you read it; choice = your own, only after «Basta domande» or in night mode' },
        answer: { ...str, description: 'code, brain, choice: the answer (for user the app fills in his)' },
        source: { ...str, description: 'code: file and place; brain: the note; choice: why; user: the question he answered, or his exact words in this chat' } } } },
      revise: { type: 'boolean', description: 'true = bring this plan to the current standard (also under way): started and ended steps come back as { keep: n }, the rest is checked as new; the user approves again' },
      remove: { type: 'array', maxItems: 40, items: { type: 'integer', minimum: 1 }, description: 'revise only: the old numbers of started steps the new plan does not need any more; they go on until the user approves, then they stop' },
      steps: { type: 'array', minItems: 1, maxItems: 40, items: { type: 'object', additionalProperties: false, properties: {
        keep: { type: 'integer', minimum: 1, description: 'revise only: the old number of a step to keep as it is (then only `after` besides it)' },
        title: { ...str, description: `required: one short plain line (at most ${TITLE_ASK} characters), e.g. "Trovo dove si calcola lo sconto"` }, role: { type: 'string', enum: [...WORK_ROLE_IDS] },
        detail: { ...str, description: `optional: what the step covers and how it is done, a few lines (at most ${DETAIL_ASK} characters)` },
        after: { type: 'array', items: { type: 'integer', minimum: 1 }, description: 'required on every step: the numbers (from 1, in this list) of the steps this one waits for; [] = it can start at once' },
        touches: { type: 'array', maxItems: 12, items: str, description: 'what it writes or holds alone: files, folders, a worktree slot, a test node, a local stack' },
        minutes: { type: 'integer', minimum: 1, description: 'your estimate for the step, in minutes' },
        preset: { type: 'string', enum: ['min', 'base', 'max'], description: 'the role card\'s preset for this step; leave out for Base. The page shows role · preset; the model is the card\'s when the step starts' },
      } } },
      doneWhen: { ...str, description: 'optional: when the whole job counts as finished, a line or two' },
    } },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: async (a, ctx) => {
      const { revise: reviseArg, doubts: doubtsArg, ...rest } = a;
      if (reviseArg !== undefined && typeof reviseArg !== 'boolean') throw new Error('revise: true or false.');
      const revise = reviseArg === true, id = callerOf(ctx.params), plan = chats.planOf(id);
      if (plan?.handed) throw new Error(`plan_propose refused: ${PLAN_HANDED}`);
      if (!revise && rest.remove !== undefined) throw new Error('plan_propose: remove goes with revise: true.');
      if (revise && (!plan || !plan.steps.length)) throw new Error('plan_propose revise: there is no plan of yours to revise; propose it without revise.');
      if (!revise && plan && (plan.phase === 'running' || plan.phase === 'done')) throw new Error('plan_propose: the plan is approved and under way; update its steps with plan_update, or bring it to the current standard with plan_propose revise: true.');
      // the doubts first: with one open nothing is checked or shown, only the list is kept for the user to see
      const evidence = plan ? chats.doubtEvidence(id) : null;
      const doubts = plan && evidence ? checkDoubts(doubtsArg, plan.doubts, evidence) : undefined;
      const open = openDoubts({ doubts });
      if (open.length) {
        chats.planDoubts(id, doubts!);
        return JSON.stringify({ shown: false, openDoubts: open.map(d => d.text), note: openDoubtsNote(open, evidence!.mayChoose) });
      }
      // a list alone, every doubt closed: kept; the steps come with the proposal
      if (doubts && doubtsArg !== undefined && a.steps === undefined) {
        chats.planDoubts(id, doubts);
        return JSON.stringify({ shown: false, openDoubts: [], note: 'Every doubt is closed: propose the plan with its steps.' });
      }
      const checked = revise ? checkRevision(plan!, rest) : checkProposal(rest);
      const doneWhen = checked.doneWhen, steps = withPresets(checked.steps, id, stepPreset);
      // «Modalità notte» (ADR 0191): the plan starts as proposed, with no list asked for; a revision was asked by the user
      const refused = plan && !away() && !revise ? proposalGate(plan, doubts !== undefined) : null;
      if (refused) throw new Error(refused);
      // the app approved it for the absent user
      if (chats.planPropose(id, steps, doneWhen, revise, doubts).phase === 'running') return JSON.stringify({ approved: true, steps: steps.length, note: AWAY_PLAN_NOTE });
      return JSON.stringify({ shown: true, steps: steps.length, note: 'The plan is shown to the user on its page (Piani) with «Approva e parti», «Approva, parti dopo» and «Cambia il piano». End your turn now: the answer arrives as the user\'s message. Delegate nothing before it.' });
    },
  }, {
    name: 'plan_update',
    description: 'Move a step of your approved plan that you do yourself (or correct one): state now (you started it), done (needs `proof`: what you did and how you know it works: what you ran, read or saw), blocked, partial, cancelled, or todo. Steps you delegated with agent_delegate\'s `step` move by themselves, with the report as their proof. A piece you discover on the way: `add` it as one more step (no new approval; the user sees it marked new) and delegate it by its number. Closing your chat finishes no step.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      step: { type: 'integer', minimum: 1, description: 'the step number, from 1' }, state: { type: 'string', enum: [...STEP_STATES.filter(s => s !== 'check')] },
      proof: { ...str, description: 'state done: what you did and how you know it works' },
      add: { type: 'object', required: ['title'], additionalProperties: false, description: 'instead of step and state: a new step', properties: { title: str, role: { type: 'string', enum: [...WORK_ROLE_IDS] }, detail: str,
        after: { type: 'array', items: { type: 'integer', minimum: 1 }, description: 'the numbers of the plan\'s steps it waits for' }, touches: { type: 'array', items: str }, minutes: { type: 'integer', minimum: 1 } } },
    } },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: async (a, ctx) => {
      const id = callerOf(ctx.params), plan = chats.planOf(id);
      if (!plan) throw new Error('plan_update: only a Strategist with a plan approved by the user has steps.');
      if (a.add !== undefined) {
        const step = checkStep(plan, a.add && typeof a.add === 'object' ? a.add : {});
        // refused before anything changes
        if (plan.stopped) throw new Error('plan_update add: the user stopped this job; wait for the user to resume it.');
        const grown = chats.planAdd(id, step);
        return JSON.stringify({ added: true, step: grown.steps.length, of: grown.steps.length });
      }
      if (!STEP_STATES.includes(a.state as StepState) || a.state === 'check') throw new Error(`plan_update: state = one of ${STEP_STATES.filter(s => s !== 'check').join(', ')}.`);
      if (a.state === 'done' && (typeof a.proof !== 'string' || !a.proof.trim())) throw new Error('plan_update: a step is «fatto» only with its proof: say what you did and how you know it works.');
      const next = chats.planUpdate(id, stepIndex(plan, a.step, 'plan_update: step'), a.state as StepState, typeof a.proof === 'string' ? a.proof : undefined);
      return JSON.stringify({ updated: true, done: next.steps.filter(s => s.state === 'done').length, of: next.steps.length, finished: next.phase === 'done' });
    },
  }];
}
export type { StepProof };
