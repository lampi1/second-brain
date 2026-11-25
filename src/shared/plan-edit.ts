// Editing the steps of a plan by explicit operations (ADR 0359): add, change, move, remove, cancel, mark done with a proof, take in
// the steps of another plan. A save never deletes by leaving something out: a step goes only with its own «remove» (and only
// one not started) or its own «annulla»; what the operations do not name stays exactly as it was. All the operations of one
// save apply together or none does (an error leaves the plan as it was). Pure: used by the chat manager (the plan a live chat
// carries), by main/plans/service.ts (a plan whose chat is gone), by the plans tool and the page's inline edit; pinned by
// test/unit/shared/plan-edit.test.ts.
import { isPresetId, type PresetId } from './model-presets';
import { circleOf, clashes, ended, nextStepId, STEP_DETAIL_MAX, STEP_PROOF_MAX, STEP_TITLE_MAX, STEPS_ALL_MAX, TOUCH_LEN, TOUCHES_MAX, type PlanStep, type StepProof } from './plan-steps';
import { isWorkRole, type WorkRoleId } from './roles';
import type { StrategyPlan } from './strategy';

/** A step named by its number (from 1, as the page shows it) or its id. */
export type StepRef = number | string;
export interface StepFields { title?: string; detail?: string | null; role?: WorkRoleId | null; preset?: PresetId | null; after?: StepRef[]; touches?: string[]; minutes?: number | null }
export type StepOp =
  | ({ op: 'add'; at?: number } & StepFields & { title: string })
  | ({ op: 'set'; step: StepRef } & StepFields)
  | { op: 'move'; step: StepRef; to: number }
  | { op: 'remove'; step: StepRef }
  | { op: 'cancel'; step: StepRef }
  | { op: 'done'; step: StepRef; proof: string }
  | { op: 'import'; steps: readonly PlanStep[] };

const MAX_OPS = 60;

/** The steps after the operations, in order; throws with what to change. `by`: who gives a proof of «fatto». */
export function applySteps(plan: StrategyPlan, ops: readonly StepOp[], now: number, by: StepProof['by'] = 'user'): StrategyPlan {
  if (!Array.isArray(ops) || !ops.length || ops.length > MAX_OPS) throw new Error(`Da 1 a ${MAX_OPS} operazioni sui passi.`);
  let steps: PlanStep[] = plan.steps.map(s => structuredClone(s));
  const find = (ref: StepRef, what: string): number => {
    const i = typeof ref === 'number' ? ref - 1 : steps.findIndex(s => s.id === ref);
    if (!Number.isInteger(i) || i < 0 || i >= steps.length) throw new Error(`${what}: il passo ${String(ref)} non c’è (da 1 a ${steps.length}).`);
    return i;
  };
  const text = (v: unknown, max: number, what: string): string => {
    if (typeof v !== 'string' || !v.trim()) throw new Error(`${what}: serve un testo.`);
    const t = v.replace(/\s+/g, ' ').trim();
    if (t.length > max) throw new Error(`${what}: al massimo ${max} caratteri.`);
    return t;
  };
  const idsOf = (refs: readonly StepRef[], self: string | null, what: string): string[] => [...new Set(refs.map(r => steps[find(r, what)]!.id))].filter(id => id !== self);
  const fields = (s: PlanStep, f: StepFields, what: string): PlanStep => {
    const out: PlanStep = { ...s };
    if (f.title !== undefined) out.title = text(f.title, STEP_TITLE_MAX, `${what}.title`);
    if (f.detail !== undefined) { if (f.detail === null || f.detail === '') delete out.detail; else out.detail = text(f.detail, STEP_DETAIL_MAX, `${what}.detail`); }
    if (f.role !== undefined) { if (f.role === null) delete out.role; else if (isWorkRole(f.role)) out.role = f.role; else throw new Error(`${what}.role: un ruolo di lavoro.`); }
    if (f.preset !== undefined) { if (f.preset === null) delete out.preset; else if (isPresetId(f.preset)) out.preset = f.preset; else throw new Error(`${what}.preset: min, base o max.`); }
    if (f.touches !== undefined) {
      if (!Array.isArray(f.touches) || f.touches.length > TOUCHES_MAX) throw new Error(`${what}.touches: al massimo ${TOUCHES_MAX}.`);
      if (f.touches.length) out.touches = f.touches.map((t, k) => text(t, TOUCH_LEN, `${what}.touches[${k}]`)); else delete out.touches;
    }
    if (f.minutes !== undefined) { if (f.minutes === null) delete out.minutes; else if (Number.isInteger(f.minutes) && f.minutes > 0 && f.minutes <= 100_000) out.minutes = f.minutes; else throw new Error(`${what}.minutes: minuti interi, più di 0.`); }
    return out;
  };
  ops.forEach((o, k) => {
    const what = `operazione ${k + 1}`;
    switch (o.op) {
      case 'add': {
        if (steps.length >= STEPS_ALL_MAX) throw new Error(`${what}: un piano ha al massimo ${STEPS_ALL_MAX} passi.`);
        const id = nextStepId(steps), s = fields({ id, title: '', state: 'todo' }, o, what);
        const after = o.after ? idsOf(o.after, id, `${what}.after`) : [];
        const at = o.at === undefined ? steps.length : Math.min(Math.max(o.at - 1, 0), steps.length);
        steps.splice(at, 0, { ...s, ...(after.length ? { after } : {}), ...(plan.phase === 'running' || plan.phase === 'done' ? { added: true as const } : {}) });
        break;
      }
      case 'set': {
        const i = find(o.step, what), was = steps[i]!;
        if ((o.after !== undefined || o.role !== undefined) && was.state !== 'todo') throw new Error(`${what}: il passo ${i + 1} è già partito: da cambiare restano titolo e dettaglio.`);
        const next = fields(was, o, what), after = o.after === undefined ? was.after : idsOf(o.after, was.id, `${what}.after`);
        if (after?.length) next.after = after; else delete next.after;
        steps[i] = next;
        break;
      }
      case 'move': {
        const i = find(o.step, what);
        if (steps[i]!.state !== 'todo') throw new Error(`${what}: il passo ${i + 1} è già partito: non si sposta.`);
        const to = Math.min(Math.max(o.to - 1, 0), steps.length - 1), [s] = steps.splice(i, 1);
        steps.splice(to, 0, s!);
        break;
      }
      case 'remove': {
        const i = find(o.step, what), s = steps[i]!;
        if (s.state !== 'todo') throw new Error(`${what}: il passo ${i + 1} è già partito: si annulla (cancel), non si toglie, così la sua storia resta.`);
        steps.splice(i, 1);
        steps = steps.map(x => { if (!x.after?.includes(s.id)) return x; const after = x.after.filter(id => id !== s.id); const { after: _a, ...rest } = x; return after.length ? { ...rest, after } : rest; });
        break;
      }
      case 'cancel': {
        const i = find(o.step, what), s = steps[i]!;
        if (ended(s)) throw new Error(`${what}: il passo ${i + 1} è già finito (${s.state}).`);
        const { proof: _p, ...rest } = s;
        steps[i] = { ...rest, state: 'cancelled', endedAt: now };
        break;
      }
      case 'done': {
        const i = find(o.step, what), s = steps[i]!;
        if (s.state === 'cancelled') throw new Error(`${what}: il passo ${i + 1} è annullato.`);
        steps[i] = { ...s, state: 'done', startedAt: s.startedAt ?? now, endedAt: s.endedAt ?? now, proof: { at: now, by, text: text(o.proof, STEP_PROOF_MAX, `${what}.proof`) } };
        break;
      }
      case 'import': {
        if (steps.length + o.steps.length > STEPS_ALL_MAX) throw new Error(`${what}: i passi sarebbero più di ${STEPS_ALL_MAX}.`);
        const map = new Map<string, string>(), added: PlanStep[] = [];
        for (const s of o.steps) { const id = nextStepId([...steps, ...added]); map.set(s.id, id); added.push({ ...structuredClone(s), id }); }
        steps = [...steps, ...added.map(s => { const after = (s.after ?? []).map(id => map.get(id)).filter((id): id is string => !!id); const { after: _a, ...rest } = s; return after.length ? { ...rest, after } : rest; })];
        break;
      }
    }
  });
  const circle = circleOf(steps);
  if (circle) throw new Error(`I passi ${circle.join(' → ')} si aspettano a vicenda: un giro che non finisce.`);
  const clash = clashes(steps)[0];
  if (clash) throw new Error(`I passi ${clash.a} e ${clash.b} possono andare insieme e toccano entrambi «${clash.on}»: uno aspetta l’altro (after), o dividi quello che scrivono.`);
  // a plan that was over has work again; one that was waiting for the user's ok waits for it again
  const over = steps.length > 0 && steps.every(ended);
  return { ...plan, steps, ...(plan.phase === 'done' && !over ? { phase: 'running' as const, at: now } : plan.phase === 'running' && over ? { phase: 'done' as const, at: now } : {}) };
}
