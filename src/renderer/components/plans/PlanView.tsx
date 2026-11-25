// One plan, whole (ADR 0359): the head with the title, the state, the progress bar and its percentage; the buttons (exactly
// PlanInfo.can; main refuses the rest); and the tabs Passi (the clean list of steps in turns), Dubbi e decisioni, Storico
// (every version, one can be looked at) and Chat. The goal, the why, the project (editable), the constraints and the files
// and links are above the tabs; «Modifica» makes them and the steps editable in place, nothing is saved until «Salva» and
// «Annulla» drops it, and a save names exactly what changed (plans:change). An older version can be looked at and has no buttons.
// Opening a finished plan says it was seen: main archives it, the page stays open. «Riprendi» says what it will do before it
// does it. Rendered by PlansPage.tsx; the steps are PlanSteps.tsx, the doubts PlanDoubts.tsx.
import { useEffect, useRef, useState } from 'react';
import { PLAN_LIMITS, type PlanInfo, type PlanFull as View, type PlanLink } from '@shared/plan';
import type { StepOp } from '@shared/plan-edit';
import { openChatRef } from '../../actions';
import { t } from '../../i18n';
import { useNow } from '../../lib/clock';
import { ago } from '../../lib/format';
import { errText } from '../../lib/ipc-error';
import { buttonsOf, earlier, HELD_ACTIONS, heldBy, minutesText, type PlanButton } from '../../lib/plans';
import { useApp } from '../../store/store';
import { toast } from '../../store/ui';
import { IconArrowLeft, IconChat } from '../Icons';
import { Select } from '../Select';
import { LiveLine, whyOf } from './LiveBits';
import { actionLabel, ProgressBar, StateChip, usePlanAction } from './PlanBits';
import { PlanDoubts } from './PlanDoubts';
import { PlanSteps, saveChange } from './PlanSteps';
import './plans.css';

// What the user was writing to change a plan, kept when they leave the plan and come back: bounded, per plan.
const drafts = new Map<string, string>();
const keepDraft = (id: string, text: string) => {
  drafts.delete(id);
  if (text) drafts.set(id, text);
  if (drafts.size > 32) drafts.delete(drafts.keys().next().value!);
};
/** «Riprogetta» on a row opens the plan with the box for the words already open. */
const asked = new Set<string>();
export function wantReplan(id: string): void { asked.add(id); }

/** The plan at a version (null = now), read again at every change. undefined = not read yet, null = not there. */
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

/** The line under the buttons: what pressing them means, in the state the plan is in. */
export function noteOf(i: PlanInfo): string | null {
  if (i.deleted) return null;
  if (i.state === 'toApprove') return t(i.replanned ? 'plans.note.replanned' : 'plans.note.toApprove');
  if (i.state === 'planned') return t('plans.note.planned');
  if (i.state === 'stopped' && i.stopped) return whyOf(i);
  if (i.planning) return t(i.state === 'running' ? 'plans.note.replanning' : 'plans.note.planning');
  return i.state === 'idea' ? t('plans.note.idea') : null;
}

/** The buttons of a plan: only what PlanInfo.can allows; «Riprogetta» opens the box to write what. An open doubt holds the
 *  approval and the start: those buttons stay, off, with the reason. */
export function PlanButtons({ info }: { info: PlanInfo }) {
  const { busy, run } = usePlanAction();
  const [text, setText] = useState(drafts.get(info.id) ?? ''), [open, setOpen] = useState(drafts.has(info.id) || asked.delete(info.id)), [sure, setSure] = useState(false);
  const buttons = buttonsOf(info), replan = info.can.includes('replan'), held = heldBy(info);
  const off = (a: PlanButton) => !!held && HELD_ACTIONS.includes(a);
  const edit = (v: string) => { keepDraft(info.id, v); setText(v); };
  const close = () => { edit(''); setOpen(false); };
  const press = (a: PlanButton) => { if (a === 'replan') setOpen(!open); else void run(info, a); };
  const send = () => { void run(info, 'replan', text).then(ok => { if (ok) { close(); toast(t('plans.sent.replan'), 'info'); } }); };
  if (!buttons.length) return null;
  return <>
    {held && <p className="pl-held" role="status" id={`pl-held-${info.id}`} data-testid="pl-held">{t('plans.doubt.blocks', { n: held.n, text: held.first })}</p>}
    <div className="pl-actions" data-testid="pl-actions">
      {buttons.map((a, i) => <button key={a} type="button" className={`btn btn-s ${i === 0 && ['approve', 'start', 'resume', 'restore'].includes(a) ? 'btn-primary' : a === 'archive' || a === 'delete' ? 'btn-subtle' : 'btn-ghost'}`} disabled={busy || off(a)}
        {...(off(a) ? { 'aria-describedby': `pl-held-${info.id}` } : {})} {...(a === 'replan' ? { 'aria-expanded': open } : {})} onClick={() => press(a)} data-testid={`pl-do-${a}`}>{actionLabel(a, info.state)}</button>)}
      {info.deleted && (sure
        ? <button type="button" className="btn btn-s pl-danger" onClick={() => { void window.sb.invoke('plans:forget', { id: info.id }).catch((e: unknown) => toast(errText(e), 'err')); }} data-testid="pl-forget-yes">{t('plans.forget.yes')}</button>
        : <button type="button" className="btn btn-ghost btn-s" onClick={() => setSure(true)} data-testid="pl-forget">{t('plans.do.forget')}</button>)}
    </div>
    {info.can.includes('resume') && <p className="pl-muted" data-testid="pl-resume-note">{t('plans.note.resume')}</p>}
    {replan && open && <form className="pl-replan" data-testid="pl-replan" onSubmit={e => { e.preventDefault(); send(); }}>
      <label className="field">{t('plans.replan.label')}
        <textarea autoFocus rows={3} value={text} maxLength={PLAN_LIMITS.change} onChange={e => edit(e.target.value)} data-testid="pl-replan-text"
          onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} /></label>
      <p className="pl-muted">{t('plans.replan.hint')}</p>
      <div className="pl-actions"><button type="submit" className="btn btn-primary btn-s" disabled={busy || !text.trim()} data-testid="pl-replan-send">{t('plans.replan.send')}</button><button type="button" className="btn btn-ghost btn-s" onClick={close}>{t('plans.cancel')}</button></div>
    </form>}
  </>;
}

type Tab = 'steps' | 'doubts' | 'history' | 'chats';
const TABS: readonly Tab[] = ['steps', 'doubts', 'history', 'chats'];

/** The words of the plan above the tabs: goal, why, project, constraints, files and links; each editable in place. */
function Words({ view, edit, draft, set }: { view: View; edit: boolean; draft: Draft; set: (d: Partial<Draft>) => void }) {
  const { record: m } = view;
  const field = (key: 'goal' | 'why' | 'project', max: number, rows = 2) => edit
    ? <label className="field pl-field"><span>{t(`plans.${key}`)}</span>{key === 'project' ? <input value={draft[key]} maxLength={max} onChange={e => set({ [key]: e.target.value })} data-testid={`pl-edit-${key}`} />
      : <textarea rows={rows} value={draft[key]} maxLength={max} onChange={e => set({ [key]: e.target.value })} data-testid={`pl-edit-${key}`} />}</label>
    : (m[key] ? <div className="pl-field"><h4>{t(`plans.${key}`)}</h4><p data-testid={`pl-${key}`}>{m[key]}</p></div> : null);
  return <div className="pl-words" data-testid="pl-words">
    {edit && <label className="field pl-field"><span>{t('plans.new.title')}</span><input value={draft.title} maxLength={PLAN_LIMITS.title} onChange={e => set({ title: e.target.value })} data-testid="pl-edit-title" /></label>}
    {field('goal', PLAN_LIMITS.goal)}{field('why', PLAN_LIMITS.why)}{field('project', PLAN_LIMITS.project)}
    {(edit || m.constraints.length > 0) && <div className="pl-field"><h4>{t('plans.constraints')}</h4>
      <ul className="pl-list">{(edit ? draft.constraints : m.constraints).map((c, i) => <li key={`${c}-${i}`}>{c}{edit && <button type="button" className="btn btn-ghost btn-s" onClick={() => set({ constraints: draft.constraints.filter((_, k) => k !== i) })} data-testid={`pl-constraint-remove-${i}`}>{t('plans.remove')}</button>}</li>)}</ul>
      {edit && <input value={draft.newConstraint} placeholder={t('plans.constraint.add')} aria-label={t('plans.constraint.add')} maxLength={PLAN_LIMITS.constraint} onChange={e => set({ newConstraint: e.target.value })}
        onKeyDown={e => { if (e.key === 'Enter' && draft.newConstraint.trim()) { e.preventDefault(); set({ constraints: [...draft.constraints, draft.newConstraint.trim()], newConstraint: '' }); } }} data-testid="pl-constraint-new" />}</div>}
    {(edit || m.links.length > 0) && <div className="pl-field"><h4>{t('plans.links')}</h4>
      <ul className="pl-list">{(edit ? draft.links : m.links).map((l, i) => <li key={`${l.ref}-${i}`}><code>{l.ref}</code>{l.label ? ` · ${l.label}` : ''}{edit && <button type="button" className="btn btn-ghost btn-s" onClick={() => set({ links: draft.links.filter((_, k) => k !== i) })} data-testid={`pl-link-remove-${i}`}>{t('plans.remove')}</button>}</li>)}</ul>
      {edit && <input value={draft.newLink} placeholder={t('plans.link.add')} aria-label={t('plans.link.add')} maxLength={500} onChange={e => set({ newLink: e.target.value })}
        onKeyDown={e => { if (e.key === 'Enter' && draft.newLink.trim()) { e.preventDefault(); set({ links: [...draft.links, { kind: /^https?:\/\//.test(draft.newLink) ? 'link' : 'file', ref: draft.newLink.trim() }], newLink: '' }); } }} data-testid="pl-link-new" />}</div>}
    {m.from && m.from.length > 0 && <p className="pl-muted" data-testid="pl-from">{t('plans.from')}: {m.from.join(', ')}</p>}
  </div>;
}

interface Draft { title: string; goal: string; why: string; project: string; constraints: string[]; links: PlanLink[]; newConstraint: string; newLink: string }
const draftOf = (v: View): Draft => ({ title: v.record.title, goal: v.record.goal ?? '', why: v.record.why ?? '', project: v.record.project ?? '', constraints: [...v.record.constraints], links: v.record.links.map(l => ({ ...l })), newConstraint: '', newLink: '' });

export function PlanView({ id, onBack }: { id: string; onBack: () => void }) {
  const [version, setVersion] = useState<number | null>(null), [tab, setTab] = useState<Tab>('steps');
  const view = useView(id, version), now = useNow(15_000);
  const owner = view?.info.ownerChatId, chat = useApp(s => (owner ? s.chats[owner]?.title : undefined));
  const { run } = usePlanAction();
  const [edit, setEdit] = useState(false), [ops, setOps] = useState<StepOp[]>([]), [draft, setDraft] = useState<Draft | null>(null), [base, setBase] = useState<Draft | null>(null);
  // seen: once, at the first reading of a finished plan, or at the user's first move on one that finished meanwhile
  const first = useRef(true), said = useRef(false), [justSeen, setJustSeen] = useState(false);
  const unseen = version === null && !!view?.info.can.includes('seen');
  const see = () => { if (!view || said.current) return; said.current = true; void run(view.info, 'seen').then(ok => { if (ok) setJustSeen(true); else said.current = false; }); };
  useEffect(() => { if (!view) return; if (first.current && unseen) see(); first.current = false; });
  const back = <button type="button" className="btn btn-ghost btn-s" onClick={onBack} data-testid="pl-back"><IconArrowLeft size={13} />{t('plans.back')}</button>;
  if (!view) return <section className="pl" data-testid="pl-view"><div className="pl-head">{back}</div><div className="pl-empty">{view === null ? t('plans.gone') : t('plans.loading')}</div></section>;
  const { info, history } = view, note = version === null ? (justSeen && info.state === 'archived' ? t('plans.note.finished') : noteOf(info)) : null;
  const live = () => { if (unseen) see(); };
  const d = draft ?? draftOf(view), canEdit = version === null && !info.deleted;
  const start = () => { const b = draftOf(view); setBase(b); setDraft(b); setOps([]); setEdit(true); };
  const stop = () => { setEdit(false); setDraft(null); setBase(null); setOps([]); };
  const save = async () => {
    // what the user started from, not what the plan is now: a change an agent made meanwhile is never undone by this save
    const was = base ?? draftOf(view), set: Record<string, unknown> = {}, add: Record<string, unknown> = {}, remove: Record<string, unknown> = {};
    // a line typed and not yet confirmed with Enter is kept too
    if (d.newConstraint.trim() && !d.constraints.includes(d.newConstraint.trim())) d.constraints = [...d.constraints, d.newConstraint.trim()];
    if (d.newLink.trim() && !d.links.some(l => l.ref === d.newLink.trim())) d.links = [...d.links, { kind: /^https?:\/\//.test(d.newLink) ? 'link' : 'file', ref: d.newLink.trim() }];
    for (const k of ['title', 'goal', 'why', 'project'] as const) if (d[k] !== was[k]) set[k] = d[k].trim() === '' && k !== 'title' ? null : d[k].trim();
    const gone = was.constraints.filter(c => !d.constraints.includes(c)), more = d.constraints.filter(c => !was.constraints.includes(c));
    if (more.length) add.constraints = more;
    if (gone.length) remove.constraints = gone;
    const lgone = was.links.filter(l => !d.links.some(x => x.ref === l.ref)).map(l => l.ref), lmore = d.links.filter(l => !was.links.some(x => x.ref === l.ref));
    if (lmore.length) add.links = lmore;
    if (lgone.length) remove.links = lgone;
    const change = { ...(Object.keys(set).length ? { set } : {}), ...(Object.keys(add).length ? { add } : {}), ...(Object.keys(remove).length ? { remove } : {}), ...(ops.length ? { steps: ops } : {}) };
    if (!Object.keys(change).length) { stop(); return; }
    if (await saveChange(id, change)) stop();
  };
  return <section className="pl" data-testid="pl-view" data-state={info.state} onPointerDownCapture={live} onKeyDownCapture={live}>
    <div className="pl-head">
      {back}
      <h2 data-testid="pl-title">{info.title}</h2>
      <StateChip info={info} />
      {info.project && <span className="pl-project" title={t('plans.project')}>{info.project}</span>}
      {version === null && <LiveLine live={info.live} id="plan" now={now} />}
      <span className="sp" />
      {owner && chat !== undefined && <button type="button" className="btn btn-ghost btn-s" onClick={() => openChatRef(owner)} title={chat} data-testid="pl-open-chat"><IconChat size={13} />{t('plans.openChat')}</button>}
      {canEdit && !edit && <button type="button" className="btn btn-ghost btn-s" onClick={start} data-testid="pl-edit">{t('plans.edit')}</button>}
      {history.length > 1 && <Select value={version === null ? '' : String(version)} onChange={e => { setVersion(e.target.value ? Number(e.target.value) : null); stop(); }} aria-label={t('plans.version')} data-testid="pl-version">
        <option value="">{t('plans.version.now')}</option>
        {earlier(history).map(h => <option key={h.version} value={String(h.version)}>{t('plans.version.item', { n: h.version, at: ago(h.at, now), what: h.summary })}</option>)}
      </Select>}
    </div>
    {info.steps > 0 && <div className="pl-bigbar" data-testid="pl-bigbar"><ProgressBar info={info} testid="pl-progress" />
      {info.next && <span data-testid="pl-next">{t('plans.next', { title: info.next.title })}</span>}
      {info.ready > 1 && <span className="pl-ready">{t('plans.ready', { n: info.ready })}</span>}
      {info.time && <span>{t('plans.time', { row: minutesText(info.time.row), par: minutesText(info.time.parallel) })}</span>}</div>}
    {version !== null && <div className="pl-old" role="status" data-testid="pl-old">{t('plans.old', { n: view.record.version })} <button type="button" className="btn btn-ghost btn-s" onClick={() => setVersion(null)} data-testid="pl-old-back">{t('plans.old.back')}</button></div>}
    {version === null && <div className="pl-do" data-s={info.state}>{note && <p data-testid="pl-note">{note}</p>}<PlanButtons key={info.id} info={info} /></div>}
    <Words view={view} edit={edit} draft={d} set={p => setDraft({ ...d, ...p })} />
    {edit && <div className="pl-actions" data-testid="pl-edit-bar"><button type="button" className="btn btn-primary btn-s" onClick={() => void save()} data-testid="pl-edit-save">{t('plans.edit.save')}</button><button type="button" className="btn btn-ghost btn-s" onClick={stop} data-testid="pl-edit-cancel">{t('plans.cancel')}</button></div>}
    <div className="pl-tabs" role="tablist" aria-label={t('plans.tab.label')}>
      {TABS.map(k => <button key={k} type="button" role="tab" aria-selected={tab === k} className="pl-tab" data-on={tab === k ? '' : undefined} onClick={() => setTab(k)} data-testid={`pl-tab-${k}`}>{t(`plans.tab.${k}`)}</button>)}
    </div>
    {tab === 'steps' && <PlanSteps view={view} now={now} edit={edit} ops={ops} onOp={op => setOps([...ops, op])} />}
    {tab === 'doubts' && <Decisions view={view} now={now} />}
    {tab === 'history' && <History view={view} now={now} onPick={v => { setVersion(v); stop(); }} />}
    {tab === 'chats' && <Chats view={view} />}
  </section>;
}

function Decisions({ view, now }: { view: View; now: number }) {
  const known = view.record.plan?.clarified ?? [];
  if (!(view.record.plan?.doubts?.length || view.questions.length || known.length)) return <p className="pl-muted" data-testid="pl-decisions-empty">{t('plans.decisions.empty')}</p>;
  return <div data-testid="pl-decisions">
    <PlanDoubts view={view} now={now} />
    {known.length > 0 && <section className="pl-doubts"><h4>{t('plans.answers')}</h4><ul className="pl-list">{known.map((c, i) => <li key={i}><b>{c.q}</b> · {c.a}</li>)}</ul></section>}
  </div>;
}

function History({ view, now, onPick }: { view: View; now: number; onPick: (v: number) => void }) {
  const list = earlier(view.history);
  if (!list.length) return <p className="pl-muted" data-testid="pl-history-empty">{t('plans.history.empty')}</p>;
  return <ol className="pl-history" data-testid="pl-history">{[...view.history].sort((a, b) => b.version - a.version).map(h => <li key={h.version}>
    <button type="button" className="pl-row-main" onClick={() => onPick(h.version)} data-testid={`pl-history-${h.version}`}><b>{h.version === view.record.version ? t('plans.version.now') : `v${h.version}`}</b> <span>{h.summary}</span> <small>{ago(h.at, now)} · {h.by}</small></button></li>)}</ol>;
}

function Chats({ view }: { view: View }) {
  const titles = useApp(s => s.chats);
  const rows = [...(view.record.owner ? [{ id: view.record.owner.chatId, n: 0 }] : []), ...view.steps.flatMap(s => s.chatIds.map(id => ({ id, n: s.n })))];
  const seen = new Set<string>(), list = rows.filter(r => !seen.has(r.id) && !!seen.add(r.id));
  if (!list.length) return <p className="pl-muted" data-testid="pl-chats-empty">{t('plans.chats.none')}</p>;
  return <ul className="pl-list" data-testid="pl-chats">{list.map(r => <li key={r.id}><button type="button" className="pl-boxchat" onClick={() => openChatRef(r.id)} data-testid={`pl-chats-${r.id}`}><IconChat size={11} /><span>{titles[r.id]?.title ?? r.id}</span></button>{r.n > 0 && <small> · {t('plans.chats.step', { n: r.n })}</small>}</li>)}</ul>;
}
