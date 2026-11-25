// The steps of a plan as a clean list (ADR 0359), turn by turn: the steps of one turn may run together and sit in one framed
// block («Turno 2 · 3 insieme»), each with its number, its true state, who does it, what it waits for («Aspetta il passo 1») or
// «Parte subito», what it frees, what it touches, how long, its proof when it is «fatto» and its chats. Inline edit with
// «Annulla»: title, order (up and down), a new step, cancel, remove (only one not started); nothing is saved until «Salva», and
// a save names exactly what changed (plans:change, shared/plan-edit.ts). Used by PlanView.tsx.
import { useState } from 'react';
import type { PlanFull, PlanStepView } from '@shared/plan';
import type { StepOp } from '@shared/plan-edit';
import { openChatRef } from '../../actions';
import { t } from '../../i18n';
import { ago } from '../../lib/format';
import { errText } from '../../lib/ipc-error';
import { chatsOf, minutesText, startsText, stateWords, STEP_TONE, turnLabel, turnsOf, whoOf } from '../../lib/plans';
import { toast } from '../../store/ui';
import { useApp } from '../../store/store';
import { IconChat } from '../Icons';
import { LiveChip, Stale } from './LiveBits';

function ChatButtons({ s }: { s: PlanStepView }) {
  const titles = useApp(st => st.chats);
  return <>{chatsOf(s).map(id => <button key={id} type="button" className="pl-boxchat" onClick={() => openChatRef(id)} title={titles[id]?.title ?? id} data-testid={`pl-step-chat-${s.n}-${id}`}><IconChat size={11} /><span>{titles[id]?.title ?? id}</span></button>)}</>;
}

export function StepRow({ s, now, edit, last, onOp }: { s: PlanStepView; now: number; edit: boolean; last: number; onOp: (op: StepOp) => void }) {
  const list = (ns: readonly number[]) => ns.join(', ');
  const [title, setTitle] = useState(s.title);
  return <li className="pl-step" data-s={STEP_TONE[s.state]} data-drop={s.drop ? '' : undefined} data-added={s.added ? '' : undefined} data-testid={`pl-step-${s.n}`}>
    <i className="pl-step-n" aria-hidden="true">{s.n}</i>
    <div className="pl-step-body">
      <div className="pl-step-top">
        {edit && s.state === 'todo' && !s.drop
          ? <input className="pl-step-input" value={title} maxLength={160} aria-label={t('plans.step.title')} onChange={e => setTitle(e.target.value)} onBlur={() => { if (title.trim() && title.trim() !== s.title) onOp({ op: 'set', step: s.id, title: title.trim() }); }} data-testid={`pl-step-title-${s.n}`} />
          : <b>{s.title}</b>}
        <span className="pl-step-state" data-s={STEP_TONE[s.state]} data-testid={`pl-step-state-${s.n}`}>{stateWords(s, now)}</span>
        {s.added && <em data-k="new">{t('plans.step.new')}</em>}
        {s.drop && <em data-k="drop">{t('plans.step.drop')}</em>}
        {s.live && <LiveChip live={s.live} testid={`pl-step-live-${s.n}`} />}
        <Stale live={s.live} now={now} testid={`pl-step-stale-${s.n}`} />
      </div>
      {s.detail && <p className="pl-step-detail">{s.detail}</p>}
      <p className="pl-step-meta">
        {whoOf(s) && <span data-testid={`pl-step-who-${s.n}`}>{whoOf(s)}</span>}
        <span data-testid={`pl-step-waits-${s.n}`}>{startsText(s)}</span>
        {s.opens.length > 0 && <span>{t('plans.step.opens', { list: list(s.opens) })}</span>}
        {s.touches.length > 0 && <span>{t('plans.step.touches')}: {s.touches.join(', ')}</span>}
        {s.minutes && <span>{minutesText(s.minutes)}</span>}
        {s.endedAt && <span>{ago(s.endedAt, now)}</span>}
      </p>
      {s.proof && <p className="pl-step-proof" data-testid={`pl-step-proof-${s.n}`}><b>{t('plans.step.proof')}</b> {s.proof.text}</p>}
      <div className="pl-step-chats"><ChatButtons s={s} /></div>
      {edit && !s.drop && <div className="pl-step-tools">
        {s.state === 'todo' && <>
          <button type="button" className="btn btn-ghost btn-s" disabled={s.n === 1} aria-label={t('plans.step.up')} onClick={() => onOp({ op: 'move', step: s.id, to: s.n - 1 })} data-testid={`pl-step-up-${s.n}`}>↑</button>
          <button type="button" className="btn btn-ghost btn-s" disabled={s.n === last} aria-label={t('plans.step.down')} onClick={() => onOp({ op: 'move', step: s.id, to: s.n + 1 })} data-testid={`pl-step-down-${s.n}`}>↓</button>
          <button type="button" className="btn btn-ghost btn-s" onClick={() => onOp({ op: 'remove', step: s.id })} data-testid={`pl-step-remove-${s.n}`}>{t('plans.step.removeIt')}</button>
        </>}
        {s.state !== 'done' && s.state !== 'partial' && s.state !== 'cancelled' && <button type="button" className="btn btn-ghost btn-s" onClick={() => onOp({ op: 'cancel', step: s.id })} data-testid={`pl-step-cancel-${s.n}`}>{t('plans.step.cancel')}</button>}
      </div>}
    </div>
  </li>;
}

/** The steps, in turns; with `edit` on, the user's changes are kept as operations and saved together. */
export function PlanSteps({ view, now, edit, ops, onOp }: { view: PlanFull; now: number; edit: boolean; ops: readonly StepOp[]; onOp: (op: StepOp) => void }) {
  const { turns, dropped } = turnsOf(view.steps), last = view.steps.length, [fresh, setFresh] = useState('');
  const add = () => { if (!fresh.trim()) return; onOp({ op: 'add', title: fresh.trim() }); setFresh(''); };
  if (!view.steps.length && !edit) return <p className="pl-muted" data-testid="pl-steps-empty">{t('plans.noPlan')}</p>;
  return <div className="pl-steps" data-testid="pl-steps" aria-label={t('plans.steps.label')}>
    {turns.map(g => <section key={g.turn} className="pl-turn2" data-together={g.together ? '' : undefined} data-testid={`pl-turn-${g.turn}`}>
      <h4>{turnLabel(g)}</h4>
      <ol>{g.steps.map(s => <StepRow key={s.id} s={s} now={now} edit={edit} last={last} onOp={onOp} />)}</ol>
    </section>)}
    {dropped.length > 0 && <section className="pl-turn2" data-drop="" data-testid="pl-dropped"><h4>{t('plans.step.dropped')}</h4><ol>{dropped.map(s => <StepRow key={s.id} s={s} now={now} edit={false} last={last} onOp={onOp} />)}</ol></section>}
    {edit && <div className="pl-step-add"><input value={fresh} maxLength={160} placeholder={t('plans.step.add')} aria-label={t('plans.step.add')} onChange={e => setFresh(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} data-testid="pl-step-new" />
      <button type="button" className="btn btn-ghost btn-s" disabled={!fresh.trim()} onClick={add} data-testid="pl-step-new-add">{t('plans.step.add')}</button>{ops.length > 0 && <small>{ops.length}</small>}</div>}
  </div>;
}

/** Saves the kept operations as one save; the plan moves by itself at plans:changed. */
export async function saveChange(id: string, change: { set?: Record<string, unknown>; add?: Record<string, unknown>; remove?: Record<string, unknown>; steps?: StepOp[] }): Promise<boolean> {
  try { await window.sb.invoke('plans:change', { id, change }); toast(t('plans.edit.saved'), 'info'); return true; } catch (e) { toast(errText(e), 'err'); return false; }
}
