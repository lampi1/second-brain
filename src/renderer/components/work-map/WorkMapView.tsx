// One work map, whole (ADR 0342, 0343): the only place where a plan is shown, approved, kept for later, started, replanned,
// stopped, resumed and archived. The buttons are exactly WorkMapInfo.can; main refuses the rest. An older version can be
// looked at and has none. Opening a finished map says it was seen: main archives it, the page stays open. The same when it
// finishes under the user's eyes, at their first move on it (a map that finishes with nobody there is not seen).
// Rendered by WorksView.tsx; the drawing is WorkDrawing.tsx, the panel beside it WorkSide.tsx, the doubts MapDoubts.tsx.
import { useEffect, useRef, useState } from 'react';
import { WORK_MAP_LIMITS, type WorkMapAction, type WorkMapInfo, type WorkMapView as View } from '@shared/work-map';
import { openChatRef } from '../../actions';
import { t } from '../../i18n';
import { useNow } from '../../lib/clock';
import { ago } from '../../lib/format';
import { errText } from '../../lib/ipc-error';
import { buttonsOf, projectsOf } from '../../lib/work-maps';
import { useApp } from '../../store/store';
import { toast } from '../../store/ui';
import { IconArrowLeft, IconChat } from '../Icons';
import { Select } from '../Select';
import { MapDoubts } from './MapDoubts';
import { actionLabel, StateChip, StepDots, useWorkAction } from './WorkBits';
import { WorkDrawing } from './WorkDrawing';
import { WorkSide } from './WorkSide';
import './work-map.css';

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
      window.sb.invoke('workmap:view', { id, ...(version === null ? {} : { version }) }).then(
        v => { if (live && mine === turn) setView({ version, v }); },
        (e: unknown) => { if (live && mine === turn) toast(t('wm.failed', { why: errText(e) }), 'err'); });
    };
    read();
    const off = window.sb.on('workmap:changed', read);
    return () => { live = false; off(); };
  }, [id, version]);
  return view?.v;
}

/** The line under the buttons: what pressing them means, in the state the map is in. */
export function noteOf(i: WorkMapInfo): string | null {
  if (i.state === 'toApprove') return t(i.replanned ? 'wm.note.replanned' : 'wm.note.toApprove');
  if (i.state === 'planned') return t('wm.note.planned');
  if (i.state === 'stopped' && i.stopped) return t(`wm.stop.${i.stopped.by}`);
  if (i.planning) return t(i.state === 'running' ? 'wm.note.replanning' : 'wm.note.planning');
  return i.state === 'idea' ? t('wm.note.idea') : null;
}

/** The buttons of a map: only what WorkMapInfo.can allows; «Cambia il piano» opens the box to write what. */
export function WorkActions({ info }: { info: WorkMapInfo }) {
  const { busy, run } = useWorkAction();
  const [text, setText] = useState(drafts.get(info.id) ?? ''), [asking, setAsking] = useState(drafts.has(info.id));
  const buttons = buttonsOf(info), replan = info.can.includes('replan');
  const edit = (v: string) => { keepDraft(info.id, v); setText(v); };
  const close = () => { edit(''); setAsking(false); };
  const press = (a: Exclude<WorkMapAction, 'seen'>) => { if (a === 'replan') setAsking(!asking); else void run(info, a); };
  const send = () => { void run(info, 'replan', text).then(ok => { if (ok) { close(); toast(t('wm.sent.replan'), 'info'); } }); };
  if (!buttons.length) return null;
  return <>
    <div className="wm-actions" data-testid="wm-actions">
      {buttons.map((a, i) => <button key={a} type="button" className={`btn btn-s ${i === 0 && ['approve', 'start', 'resume'].includes(a) ? 'btn-primary' : a === 'archive' ? 'btn-subtle' : 'btn-ghost'}`} disabled={busy}
        {...(a === 'replan' ? { 'aria-expanded': asking } : {})} onClick={() => press(a)} data-testid={`wm-do-${a}`}>{actionLabel(a, info.state)}</button>)}
    </div>
    {replan && asking && <form className="wm-replan" data-testid="wm-replan" onSubmit={e => { e.preventDefault(); send(); }}>
      <label className="field">{t('wm.replan.label')}
        <textarea autoFocus rows={3} value={text} maxLength={WORK_MAP_LIMITS.change} onChange={e => edit(e.target.value)} data-testid="wm-replan-text"
          onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setAsking(false); } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} /></label>
      <p className="wm-muted">{t('wm.replan.hint')}</p>
      <div className="wm-actions"><button type="submit" className="btn btn-primary btn-s" disabled={busy || !text.trim()} data-testid="wm-replan-send">{t('wm.replan.send')}</button><button type="button" className="btn btn-ghost btn-s" onClick={close}>{t('wm.cancel')}</button></div>
    </form>}
  </>;
}

export function WorkMapView({ id, onBack }: { id: string; onBack: () => void }) {
  const [version, setVersion] = useState<number | null>(null), [picked, setPicked] = useState<number | null>(null);
  const view = useView(id, version), now = useNow(15_000);
  const owner = view?.info.ownerChatId, chat = useApp(s => (owner ? s.chats[owner]?.title : undefined));
  const { run } = useWorkAction();
  // seen: once, at the first reading of a finished map, or at the user's first move on one that finished meanwhile
  const first = useRef(true), said = useRef(false), [justSeen, setJustSeen] = useState(false);
  const unseen = version === null && !!view?.info.can.includes('seen');
  const see = () => { if (!view || said.current) return; said.current = true; void run(view.info, 'seen').then(ok => { if (ok) setJustSeen(true); else said.current = false; }); };
  useEffect(() => { if (!view) return; if (first.current && unseen) see(); first.current = false; });
  const back = <button type="button" className="btn btn-ghost btn-s" onClick={onBack} data-testid="wm-back"><IconArrowLeft size={13} />{t('wm.back')}</button>;
  if (!view) return <section className="wm" data-testid="wm-map"><div className="wm-head">{back}</div><div className="wm-empty">{view === null ? t('wm.gone') : t('wm.loading')}</div></section>;
  const { info, history } = view, note = version === null ? (justSeen && info.state === 'archived' ? t('wm.note.finished') : noteOf(info)) : null;
  const live = () => { if (unseen) see(); };
  return <section className="wm" data-testid="wm-map" data-state={info.state} onPointerDownCapture={live} onKeyDownCapture={live}>
    <div className="wm-head">
      {back}
      <h2 data-testid="wm-title">{info.title}</h2>
      <StateChip info={info} />
      {projectsOf(info).map(p => <span key={p} className="wm-project" title={t('wm.side.project')}>{p}</span>)}
      {info.steps > 0 && <><StepDots info={info} /><span className="wm-muted">{t('wm.steps', { done: info.done, n: info.steps })}</span></>}
      <span className="sp" />
      {owner && chat !== undefined && <button type="button" className="btn btn-ghost btn-s" onClick={() => openChatRef(owner)} title={chat} data-testid="wm-open-chat"><IconChat size={13} />{t('wm.openChat')}</button>}
      {history.length > 1 && <Select value={version === null ? '' : String(version)} onChange={e => { setPicked(null); setVersion(e.target.value ? Number(e.target.value) : null); }} aria-label={t('wm.version')} data-testid="wm-version">
        <option value="">{t('wm.version.now')}</option>
        {history.filter(h => version !== null || h.version !== view.map.version).sort((a, b) => b.version - a.version).map(h => <option key={h.version} value={String(h.version)}>{t('wm.version.item', { n: h.version, at: ago(h.at, now), what: h.summary })}</option>)}
      </Select>}
    </div>
    {version !== null && <div className="wm-old" role="status" data-testid="wm-old">{t('wm.old', { n: view.map.version })} <button type="button" className="btn btn-ghost btn-s" onClick={() => setVersion(null)} data-testid="wm-old-back">{t('wm.old.back')}</button></div>}
    {version === null && <div className="wm-do" data-s={info.state}>{note && <p data-testid="wm-note">{note}</p>}<WorkActions key={info.id} info={info} /></div>}
    <MapDoubts view={view} />
    <div className="wm-body">
      <WorkDrawing boxes={view.boxes} links={view.links} now={now} picked={picked} onPick={n => setPicked(picked === n ? null : n)} />
      <WorkSide view={view} picked={picked} now={now} onPick={setPicked} />
    </div>
  </section>;
}
