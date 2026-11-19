// A Strategist's plan drawn on a project's map, told in the side panel (ADR 0326; before it a strip of steps over the
// drawing, ADR 0302 and 0307). The owner (2026-11-19): «la parte in alto dei passi è completamente inutile, rimuovila,
// occupa solo spazio … le mappe servono per tracciare l'andamento di un piano, sarebbe bello ci fosse anche un
// progressivo, una percentuale, e più dettagli nella parte dx».
// - PlanCard: the plan's percentage and bar, how many steps are done, which one is under way, how many are stuck and
//   how many wait for the user (a chat working on the step asked something), when the plan is finished; then every step in order, one row each (its mark, its title, how far it is). A row
//   opens on a click and tells the step in full: what it does, when it starts (after which steps, together with which),
//   who does it, on which box (a click shows it on the drawing), the chats working on it. A plan that waits for the user's ok has
//   every step open; a plan under way the step being done.
// - PlanAsk: the one line over the drawing while a plan waits for the ok, with «Approva e parti» always in sight.
// - Turn: a step's turn on a box of the drawing («2», «2∥»).
// Used by ProjectMapView.tsx and MapDetail.tsx.
import { useEffect, useState } from 'react';
import type { MapFlowStep, MapPlan } from '@shared/project-map';
import { planProgress } from '@shared/project-map-progress';
import { t } from '../../i18n';
import { ago } from '../../lib/format';
import { useApp } from '../../store/store';
import { ProgressHead } from './MapProgress';

/** A step's turn in its plan: «2», or «2∥» when it goes together with another step. */
export function Turn({ wave, par }: { wave: number; par?: boolean | undefined }) {
  return <small className="pm-turn-n" data-par={par ? '' : undefined} title={par ? t('pm.turnPar', { n: wave }) : t('pm.turn', { n: wave })}>{wave}{par ? '∥' : ''}</small>;
}

const list = (steps: MapFlowStep[]) => steps.map(s => s.step).join(', ');
/** When a step starts, in words: first, after which steps, together with which. */
export function whenOf(f: MapFlowStep, flow: MapFlowStep[]): string {
  const mates = flow.filter(x => x.wave === f.wave && x.step !== f.step), before = flow.filter(x => x.wave === f.wave - 1);
  const start = before.length ? t(before.length === 1 ? 'pm.step.after' : 'pm.step.afterMany', { steps: list(before) }) : t('pm.step.first');
  return mates.length ? `${start} ${t(mates.length === 1 ? 'pm.step.with' : 'pm.step.withMany', { steps: list(mates) })}` : start;
}
const minutes = (ms: number) => `${Math.max(1, Math.round(ms / 60_000))} min`;
/** How far a step is, in words. */
export function stateOf(f: MapFlowStep, now: number): string {
  if (f.state === 'now') { const a = f.startedAt ? ago(f.startedAt, now) : ''; return a && a !== t('appText.format.now') ? t('pm.step.nowSince', { at: a }) : t('pm.step.now'); }
  if (f.state === 'done') return f.startedAt && f.endedAt && f.endedAt > f.startedAt ? t('pm.step.doneIn', { time: minutes(f.endedAt - f.startedAt) }) : t('pm.step.done');
  return t(f.state === 'blocked' ? 'pm.step.blocked' : 'pm.step.todo');
}

/** The steps told in full when the user picked none: all of them while the plan waits for the ok, else the one under way. */
export function followOf(plan: MapPlan): number | 'all' | null {
  return plan.phase === 'proposed' || plan.phase === 'revising' ? 'all' : plan.flow.find(f => f.state === 'now')?.step ?? null;
}
const MARK = (f: MapFlowStep) => (f.state === 'done' ? '✓' : f.state === 'blocked' ? '✕' : f.step);

function StepRow({ f, flow, now, open, you, nameOf, onToggle, onShow, onChat }: { f: MapFlowStep; flow: MapFlowStep[]; now: number; open: boolean; you: boolean; nameOf: (id: string) => string | undefined; onToggle: () => void; onShow: (on: string) => void; onChat: (chatId: string) => void }) {
  const titles = useApp(s => (f.chatIds ?? []).map(id => s.chats[id]?.title ?? '').join('\n')).split('\n');
  const box = f.on ? nameOf(f.on) : undefined;
  return <li className="pm-planstep" data-s={f.state} data-open={open ? '' : undefined} data-you={you ? '' : undefined} data-testid={`pm-step-${f.step}`}>
    <button type="button" className="pm-planstep-head" aria-expanded={open} onClick={onToggle} data-testid={`pm-step-head-${f.step}`}>
      <i>{MARK(f)}</i><b>{f.title}{f.added && <em className="pm-new">{t('pm.new')}</em>}</b><small data-k="state">{you ? <em className="pm-you">{t('pm.step.waits')}</em> : stateOf(f, now)}</small>
    </button>
    {open && <div className="pm-planstep-more" data-testid={`pm-stepcard-${f.step}`}>
      {f.detail && <p>{f.detail}</p>}
      <p className="pm-muted">{whenOf(f, flow)}</p>
      <div className="pm-planstep-meta">
        {f.role && <span>{t('pm.step.by', { role: f.role[0]!.toUpperCase() + f.role.slice(1) })}</span>}
        {f.on && box && <button type="button" onClick={() => onShow(f.on!)} data-testid={`pm-stepcard-on-${f.step}`}>{t('pm.step.on', { name: box })}</button>}
        {(f.chatIds ?? []).map((id, i) => (titles[i] ? <button type="button" key={id} onClick={() => onChat(id)}>{t('pm.step.chat', { title: titles[i]! })}</button> : null))}
      </div>
    </div>}
  </li>;
}

/** The line over the drawing while a plan waits for the user's ok: the approval is in sight wherever the panel is. */
export function PlanAsk({ plan, onApprove, onChange }: { plan: MapPlan; onApprove: () => void; onChange: () => void }) {
  return <section className="pm-planask" data-testid="pm-plan-ask">
    <span className="dash-eyebrow">{t('pm.plan')} · {t('pm.planPhase.proposed')}</span>
    <b>{plan.title}</b>
    <span className="pm-muted">{t('pm.stepsCount', { n: plan.steps })}</span>
    <span className="sp" />
    <button type="button" className="btn btn-primary btn-s" onClick={onApprove} data-testid="pm-plan-approve">{t('pm.planApprove')}</button>
    <button type="button" className="btn btn-ghost btn-s" onClick={onChange} data-testid="pm-plan-change">{t('pm.planChange')}</button>
  </section>;
}

export function PlanCard({ plan, now, waiting, nameOf, onShow, onChat }: {
  plan: MapPlan; now: number;
  /** the chats that wait for the user: a step one of them works on says so */
  waiting: ReadonlySet<string>;
  nameOf: (id: string) => string | undefined; onShow: (on: string) => void; onChat: (chatId: string) => void;
}) {
  const { flow } = plan, p = planProgress(plan, waiting);
  // which steps are open: all of them while the plan waits for the ok, the one under way after (it changes by itself
  // as the plan moves on) until the user opens or closes one; a new phase follows the plan again
  const follow = followOf(plan);
  const [mine, setMine] = useState<Set<number> | null>(null);
  useEffect(() => { setMine(null); }, [plan.chatId, plan.phase]);
  const open = mine ?? new Set(follow === 'all' ? flow.map(f => f.step) : follow === null ? [] : [follow]);
  const toggle = (step: number) => { const next = new Set(open); if (!next.delete(step)) next.add(step); setMine(next); };
  const count = [t('pm.planSteps', { done: p.done, total: p.total }), ...(p.now.length ? [t(p.now.length === 1 ? 'pm.plan.nowOne' : 'pm.plan.nowMany', { steps: p.now.map(f => f.step).join(', ') })] : []),
    ...(p.blocked.length ? [t('pm.plan.blocked', { n: p.blocked.length })] : []), ...(p.you.length ? [t('pm.waiting', { n: p.you.length })] : [])].join(' · ');
  return <section className="pm-plancard" data-phase={plan.phase} data-testid="pm-plan">
    <span className="dash-eyebrow">{t('pm.plan')} · {t(`pm.planPhase.${plan.phase}`)}</span>
    <h3>{plan.title}</h3>
    <ProgressHead pct={p.pct} count={count} of={plan.title} state={p.blocked.length ? 'blocked' : p.done === p.total && p.total > 0 ? 'done' : 'now'} />
    {plan.doneWhen && <p className="pm-plan-when"><b>{t('pm.plan.doneWhen')}</b> {plan.doneWhen}</p>}
    <ol className="pm-plansteps" aria-label={t('pm.plan.steps')} data-testid="pm-flow">
      {flow.map(f => <StepRow key={f.step} f={f} flow={flow} now={now} open={open.has(f.step)} you={p.you.includes(f)} nameOf={nameOf} onToggle={() => toggle(f.step)} onShow={onShow} onChat={onChat} />)}
    </ol>
    <button type="button" className="btn btn-ghost btn-s" onClick={() => onChat(plan.chatId)} data-testid="pm-plan-chat">{t('pm.openChat')}</button>
  </section>;
}
