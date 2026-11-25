// One work map, whole (ADR 0342, 0343): the only place where a plan is shown, approved, kept for later, started, replanned,
// stopped, resumed and archived. The buttons are exactly PlanInfo.can; main refuses the rest. An older version can be
// looked at and has none. Opening a finished map says it was seen: main archives it, the page stays open. The same when it
// finishes under the user's eyes, at their first move on it (a map that finishes with nobody there is not seen).
// Rendered by PlansPage.tsx; the drawing is WorkDrawing.tsx, the panel beside it WorkSide.tsx, the doubts PlanDoubts.tsx.
import { useEffect, useRef, useState } from 'react';
import { PLAN_LIMITS, type PlanAction, type PlanInfo, type PlanFull as View } from '@shared/plan';
import { openChatRef } from '../../actions';
import { t } from '../../i18n';
import { useNow } from '../../lib/clock';
import { ago } from '../../lib/format';
import { errText } from '../../lib/ipc-error';
import { buttonsOf, earlier, HELD_ACTIONS, heldBy, projectsOf } from '../../lib/plans';
import { useApp } from '../../store/store';
import { toast } from '../../store/ui';
import { IconArrowLeft, IconChat } from '../Icons';
import { Select } from '../Select';
import { LiveLine, whyOf } from './LiveBits';
import { PlanDoubts } from './PlanDoubts';
import { actionLabel, StateChip, StepDots, usePlanAction } from './PlanBits';
import { WorkDrawing } from './WorkDrawing';
import { WorkSide } from './WorkSide';
import './plans.css';

// What the user was writing to change a plan, kept when they leave the map and come back: bounded, per map.
const drafts = new Map<string, string>();
const keepDraft = (id: string, text: string) => {
  drafts.delete(id);
  if (text) drafts.set(id, text);
  if (drafts.size > 32) drafts.delete(drafts.keys().next().value!);
};

/** The map at a version (null = now), read again at every change. undefined = not read yet, null = not there. */
function useView(id: string, version: number | null): View | null | undefined {
  const [view, setView] = useState<{ version: number | null; v: View | null }>();
  useEffect(() => {
    let live = true, turn = 0;
    const read = () => {
      const mine = ++turn;
      window.sb.invoke('plans:view', { id, ...(version === null ? {} : { version }) }).then(
        v => { if (live && mine === turn) setView({ version, v }); },
        (e: unknown) => { if (live && mine === turn) toast(t('plans.failed', { why: errText(e) }), 'err'); });
    };
    read();
    const off = window.sb.on('plans:changed', read);
    return () => { live = false; off(); };
  }, [id, version]);
  return view?.v;
}

/** The line under the buttons: what pressing them means, in the state the map is in. */
export function noteOf(i: PlanInfo): string | null {
  if (i.state === 'toApprove') return t(i.replanned ? 'plans.note.replanned' : 'plans.note.toApprove');
  if (i.state === 'planned') return t('plans.note.planned');
  if (i.state === 'stopped' && i.stopped) return whyOf(i);
  if (i.planning) return t(i.state === 'running' ? 'plans.note.replanning' : 'plans.note.planning');
  return i.state === 'idea' ? t('plans.note.idea') : null;
}

/** The buttons of a map: only what PlanInfo.can allows; «Cambia il piano» opens the box to write what. An open doubt holds
 *  the approval and the start: those buttons stay, off, with the reason; a plan still in preparation shows the one to come. */
export function PlanButtons({ info }: { info: PlanInfo }) {
  const { busy, run } = usePlanAction();
  const [text, setText] = useState(drafts.get(info.id) ?? ''), [asking, setAsking] = useState(drafts.has(info.id));
  const buttons = buttonsOf(info), replan = info.can.includes('replan'), held = heldBy(info);
  const off = (a: PlanAction) => !!held && HELD_ACTIONS.includes(a), toCome = held && info.planning && !buttons.includes('approve');
  const edit = (v: string) => { keepDraft(info.id, v); setText(v); };
  const close = () => { edit(''); setAsking(false); };
  const press = (a: Exclude<PlanAction, 'seen'>) => { if (a === 'replan') setAsking(!asking); else void run(info, a); };
  const send = () => { void run(info, 'replan', text).then(ok => { if (ok) { close(); toast(t('plans.sent.replan'), 'info'); } }); };
  if (!buttons.length) return null;
  return <>
    {held && <p className="pl-held" role="status" id={`pl-held-${info.id}`} data-testid="pl-held">{t('plans.doubt.blocks', { n: held.n, text: held.first })}</p>}
    <div className="pl-actions" data-testid="pl-actions">
      {toCome && <button type="button" className="btn btn-s btn-primary" disabled aria-describedby={`pl-held-${info.id}`} data-testid="pl-do-approve">{actionLabel('approve', info.state)}</button>}
      {buttons.map((a, i) => <button key={a} type="button" className={`btn btn-s ${i === 0 && ['approve', 'start', 'resume'].includes(a) ? 'btn-primary' : a === 'archive' ? 'btn-subtle' : 'btn-ghost'}`} disabled={busy || off(a)} {...(off(a) ? { 'aria-describedby': `pl-held-${info.id}` } : {})}
        {...(a === 'replan' ? { 'aria-expanded': asking } : {})} onClick={() => press(a)} data-testid={`pl-do-${a}`}>{actionLabel(a, info.state)}</button>)}
    </div>
    {replan && asking && <form className="pl-replan" data-testid="pl-replan" onSubmit={e => { e.preventDefault(); send(); }}>
      <label className="field">{t('plans.replan.label')}
        <textarea autoFocus rows={3} value={text} maxLength={PLAN_LIMITS.change} onChange={e => edit(e.target.value)} data-testid="pl-replan-text"
          onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setAsking(false); } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} /></label>
      <p className="pl-muted">{t('plans.replan.hint')}</p>
      <div className="pl-actions"><button type="submit" className="btn btn-primary btn-s" disabled={busy || !text.trim()} data-testid="pl-replan-send">{t('plans.replan.send')}</button><button type="button" className="btn btn-ghost btn-s" onClick={close}>{t('plans.cancel')}</button></div>
    </form>}
  </>;
}

export function PlanFull({ id, onBack }: { id: string; onBack: () => void }) {
  const [version, setVersion] = useState<number | null>(null), [picked, setPicked] = useState<number | null>(null);
  const view = useView(id, version), now = useNow(15_000);
  const owner = view?.info.ownerChatId, chat = useApp(s => (owner ? s.chats[owner]?.title : undefined));
  const { run } = usePlanAction();
  // seen: once, at the first reading of a finished map, or at the user's first move on one that finished meanwhile
  const first = useRef(true), said = useRef(false), [justSeen, setJustSeen] = useState(false);
  const unseen = version === null && !!view?.info.can.includes('seen');
  const see = () => { if (!view || said.current) return; said.current = true; void run(view.info, 'seen').then(ok => { if (ok) setJustSeen(true); else said.current = false; }); };
  useEffect(() => { if (!view) return; if (first.current && unseen) see(); first.current = false; });
  const back = <button type="button" className="btn btn-ghost btn-s" onClick={onBack} data-testid="pl-back"><IconArrowLeft size={13} />{t('plans.back')}</button>;
  if (!view) return <section className="pl" data-testid="pl-map"><div className="pl-head">{back}</div><div className="pl-empty">{view === null ? t('plans.gone') : t('plans.loading')}</div></section>;
  const { info, history } = view, note = version === null ? (justSeen && info.state === 'archived' ? t('plans.note.finished') : noteOf(info)) : null;
  const live = () => { if (unseen) see(); };
  return <section className="pl" data-testid="pl-map" data-state={info.state} onPointerDownCapture={live} onKeyDownCapture={live}>
    <div className="pl-head">
      {back}
      <h2 data-testid="pl-title">{info.title}</h2>
      <StateChip info={info} />
      {projectsOf(info).map(p => <span key={p} className="pl-project" title={t('plans.side.project')}>{p}</span>)}
      {info.steps > 0 && <><StepDots info={info} /><span className="pl-muted">{t('plans.steps', { done: info.done, n: info.steps })}</span></>}
      {version === null && <LiveLine live={info.live} id="map" now={now} />}
      <span className="sp" />
      {owner && chat !== undefined && <button type="button" className="btn btn-ghost btn-s" onClick={() => openChatRef(owner)} title={chat} data-testid="pl-open-chat"><IconChat size={13} />{t('plans.openChat')}</button>}
      {history.length > 1 && <Select value={version === null ? '' : String(version)} onChange={e => { setPicked(null); setVersion(e.target.value ? Number(e.target.value) : null); }} aria-label={t('plans.version')} data-testid="pl-version">
        <option value="">{t('plans.version.now')}</option>
        {earlier(history).map(h => <option key={h.version} value={String(h.version)}>{t('plans.version.item', { n: h.version, at: ago(h.at, now), what: h.summary })}</option>)}
      </Select>}
    </div>
    {version !== null && <div className="pl-old" role="status" data-testid="pl-old">{t('plans.old', { n: view.map.version })} <button type="button" className="btn btn-ghost btn-s" onClick={() => setVersion(null)} data-testid="pl-old-back">{t('plans.old.back')}</button></div>}
    {version === null && <div className="pl-do" data-s={info.state}>{note && <p data-testid="pl-note">{note}</p>}<PlanButtons key={info.id} info={info} /></div>}
    <PlanDoubts key={`${id}-${version ?? ''}`} view={view} now={now} />
    <div className="pl-body">
      <WorkDrawing boxes={view.boxes} links={view.links} now={now} picked={picked} onPick={n => setPicked(picked === n ? null : n)} />
      <WorkSide view={view} picked={picked} now={now} onPick={setPicked} />
    </div>
  </section>;
}
