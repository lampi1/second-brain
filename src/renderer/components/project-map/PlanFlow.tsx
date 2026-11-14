// A plan drawn on a project's map, told step by step (ADR 0302, ADR 0307). The owner (2026-11-14): «voglio che si capisca
// bene ogni passaggio». The strip: the turns left to right with an arrow between them, the steps of one turn stacked
// under «insieme». Under it, each step in full: what it does (title and detail), when it starts (after which steps,
// together with which), who does it, on which box, how far it is. A plan that waits for the user's ok shows every step;
// a plan under way shows the step being done, and any other on a click. Used by ProjectMapView.tsx.
import { useEffect, useState } from 'react';
import type { MapFlowStep, MapPlan } from '@shared/project-map';
import { t } from '../../i18n';
import { ago } from '../../lib/format';
import { useApp } from '../../store/store';

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

function StepCard({ f, flow, now, nameOf, onShow, onChat }: { f: MapFlowStep; flow: MapFlowStep[]; now: number; nameOf: (id: string) => string | undefined; onShow: (on: string) => void; onChat: (chatId: string) => void }) {
  const titles = useApp(s => (f.chatIds ?? []).map(id => s.chats[id]?.title ?? '').join('\n')).split('\n');
  const box = f.on ? nameOf(f.on) : undefined;
  return <li className="pm-stepcard" data-s={f.state} data-testid={`pm-stepcard-${f.step}`}>
    <div className="pm-stepcard-head"><i>{f.state === 'done' ? '✓' : f.state === 'blocked' ? '✕' : f.step}</i><b>{f.title}</b>{f.added && <em className="pm-new">{t('pm.new')}</em>}</div>
    {f.detail && <p>{f.detail}</p>}
    <p className="pm-muted">{whenOf(f, flow)}</p>
    <div className="pm-stepcard-meta">
      <span data-k="state">{stateOf(f, now)}</span>
      {f.role && <span>{t('pm.step.by', { role: f.role[0]!.toUpperCase() + f.role.slice(1) })}</span>}
      {f.on && box && <button type="button" onClick={() => onShow(f.on!)} data-testid={`pm-stepcard-on-${f.step}`}>{t('pm.step.on', { name: box })}</button>}
      {(f.chatIds ?? []).map((id, i) => (titles[i] ? <button type="button" key={id} onClick={() => onChat(id)}>{t('pm.step.chat', { title: titles[i]! })}</button> : null))}
    </div>
  </li>;
}

export function PlanFlow({ plan, now, nameOf, onShow, onChat }: { plan: MapPlan; now: number; nameOf: (id: string) => string | undefined; onShow: (on: string) => void; onChat: (chatId: string) => void }) {
  const { flow } = plan;
  const waiting = plan.phase === 'proposed' || plan.phase === 'revising';
  // which steps are told in full: all of them while the plan waits for the ok, the one under way after
  const first = (): number | 'all' | null => (waiting ? 'all' : flow.find(f => f.state === 'now')?.step ?? null);
  const [open, setOpen] = useState<number | 'all' | null>(first);
  useEffect(() => { setOpen(first()); }, [plan.chatId, plan.phase]);
  const turns = [...new Set(flow.map(f => f.wave))].map(w => flow.filter(f => f.wave === w));
  const told = open === 'all' ? flow : flow.filter(f => f.step === open);
  return <div className="pm-flowbox">
    <div className="pm-flowrow">
      <ol className="pm-flow" aria-label={t('pm.flow')} data-testid="pm-flow">
        {turns.map(group => <li key={group[0]!.wave} className="pm-turn" data-par={group.length > 1 ? '' : undefined} data-testid={`pm-turn-${group[0]!.wave}`}>
          {group.length > 1 && <em className="pm-together">{t('pm.together')}</em>}
          {group.map(f => <button type="button" key={f.step} className="pm-step" data-s={f.state} data-par={f.par ? '' : undefined} aria-pressed={open === 'all' || open === f.step}
            onClick={() => { setOpen(o => (o === f.step ? null : f.step)); if (f.on) onShow(f.on); }}
            title={f.title} data-testid={`pm-step-${f.step}`}><i>{f.state === 'done' ? '✓' : f.state === 'blocked' ? '✕' : f.step}</i><span>{f.title}</span></button>)}
        </li>)}
      </ol>
      <button type="button" className="btn btn-ghost btn-s pm-flow-all" aria-pressed={open === 'all'} onClick={() => setOpen(o => (o === 'all' ? null : 'all'))} data-testid="pm-flow-all">{t(open === 'all' ? 'pm.step.less' : 'pm.step.all')}</button>
    </div>
    {told.length > 0 && <ol className="pm-stepcards" data-all={open === 'all' ? '' : undefined} data-testid="pm-stepcards">
      {told.map(f => <StepCard key={f.step} f={f} flow={flow} now={now} nameOf={nameOf} onShow={onShow} onChat={onChat} />)}
    </ol>}
  </div>;
}
