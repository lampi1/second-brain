// The work maps' list (ADR 0342, 0343; the owner, 2026-11-23: «le mappe devono essere ben navigabili perchè ce ne saranno
// tante»): by status, what waits for the user on top, then under way, stopped, planned and ideas; the finished apart, in
// their own tab. Words (main searches titles, ideas and steps in both tabs), a project and an order narrow it, and stay
// when the user comes back from a map. A row opens the map; its other button the owner chat. «Nuova idea» writes one down.
// With an id in the place (`lavori/<id>`) it shows that map instead (PlanFull.tsx). Rendered by brain-model/MapPage.tsx.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { waitsForUser, PLAN_LIMITS, type PlanInfo } from '@shared/plan';
import { openChatRef, openPlan } from '../../actions';
import { Seg } from '../../brain/components/ui';
import { t } from '../../i18n';
import { useNow } from '../../lib/clock';
import { ago } from '../../lib/format';
import { errText } from '../../lib/ipc-error';
import { allProjects, arrange, groupOf, projectsOf, PLAN_SORTS, type PlanFilter, type PlanSort, type PlanTab } from '../../lib/plans';
import { toast } from '../../store/ui';
import { useApp } from '../../store/store';
import { usePlans } from '../../store/plans';
import { IconChat, IconPlus, IconSearch, IconX } from '../Icons';
import { Select } from '../Select';
import { LiveLine, whyOf } from './LiveBits';
import { StateChip, StepDots } from './PlanBits';
import { PlanFull } from './PlanFull';
import './plans.css';

const START: PlanFilter = { tab: 'open', query: '', project: '', sort: 'recent' };
/** what the user was looking for, kept while they open a map and come back */
let last: PlanFilter = START;

export function PlansPage({ id }: { id: string | null }) {
  return id ? <PlanFull key={id} id={id} onBack={() => openPlan(null)} /> : <PlanList />;
}

/** What main finds for the words: it reads the ideas and the steps' titles too. null = no words, or not answered yet. */
function useFound(query: string, rows: PlanInfo[] | null): PlanInfo[] | null {
  const [found, setFound] = useState<{ query: string; rows: PlanInfo[] } | null>(null);
  useEffect(() => {
    const q = query.trim();
    if (!q) { setFound(null); return; }
    let live = true;
    window.sb.invoke('plans:list', { query: q }).then(r => { if (live) setFound({ query: q, rows: r }); }, (e: unknown) => { if (live) toast(t('plans.failed', { why: errText(e) }), 'err'); });
    return () => { live = false; };
  }, [query, rows]);
  return query.trim() ? found?.rows ?? null : null;
}

export function PlanList() {
  const { rows, error, retry } = usePlans();
  const [filter, setFilter] = useState<PlanFilter>(last);
  const [writing, setWriting] = useState(false);
  const now = useNow(30_000);
  const set = (f: Partial<PlanFilter>) => { last = { ...filter, ...f }; setFilter(last); };
  const found = useFound(filter.query, rows);
  const projects = useMemo(() => allProjects(rows ?? []), [rows]);
  // a project whose last map is gone filters nothing more
  const project = projects.includes(filter.project) ? filter.project : '';
  const searching = !!filter.query.trim(), shown = searching ? found : rows;
  const groups = useMemo(() => arrange(shown ?? [], { ...filter, project }), [shown, filter, project]);
  const n = (tab: PlanTab) => (rows ?? []).filter(i => (groupOf(i) === 'finished') === (tab === 'finished')).length;
  const unseen = (rows ?? []).filter(i => i.state === 'finished').length;
  const found0 = groups.length === 0;
  return <section className="pl" data-testid="pl-list" aria-label={t('plans.list.label')}>
    <div className="pl-bar">
      <div className="bx"><Seg items={[{ id: 'open', label: `${t('plans.tab.open')} · ${n('open')}` }, { id: 'finished', label: `${t('plans.tab.finished')} · ${n('finished')}${unseen ? ` (${t('plans.tab.unseen', { n: unseen })})` : ''}` }]} value={filter.tab} onChange={tab => set({ tab })} label={t('plans.tab.label')} /></div>
      <label className="pl-search"><IconSearch size={14} /><input type="search" value={filter.query} placeholder={t('plans.search')} aria-label={t('plans.search')} onChange={e => set({ query: e.target.value })} data-testid="pl-search" />
        {filter.query && <button type="button" className="pl-x" aria-label={t('plans.empty.clear')} onClick={() => set({ query: '' })}><IconX size={12} /></button>}</label>
      <Select value={project} onChange={e => set({ project: e.target.value })} aria-label={t('plans.project.label')} data-testid="pl-project">
        <option value="">{t('plans.project.all')}</option>{projects.map(p => <option key={p} value={p}>{p}</option>)}
      </Select>
      <Select value={filter.sort} onChange={e => set({ sort: e.target.value as PlanSort })} aria-label={t('plans.sort.label')} data-testid="pl-sort">
        {PLAN_SORTS.map(s => <option key={s} value={s}>{t(`plans.sort.${s}`)}</option>)}
      </Select>
      <span className="sp" />
      <button type="button" className="btn btn-ghost btn-s" onClick={() => setWriting(!writing)} aria-expanded={writing} data-testid="pl-idea-new"><IconPlus size={13} />{t('plans.idea.new')}</button>
    </div>
    {writing && <IdeaForm projects={projects} project={project} onClose={() => setWriting(false)} />}
    {error && <div className="pl-empty" role="alert">{t('plans.failed', { why: error })} <button type="button" className="btn btn-ghost btn-s" onClick={retry}>{t('plans.retry')}</button></div>}
    {!shown && !error ? <div className="pl-empty">{t('plans.loading')}</div> : groups.map(g => <section key={g.group} className="pl-group" data-group={g.group} data-testid={`pl-group-${g.group}`}>
      <h3>{t(`plans.group.${g.group}`)} <small>{g.items.length}</small></h3>
      <ul>{g.items.map(i => <PlanRow key={i.id} info={i} now={now} />)}</ul>
    </section>)}
    {shown && found0 && !error && <div className="pl-empty" data-testid="pl-empty">{searching || project ? t('plans.empty.search') : t(`plans.empty.${filter.tab}`)}
      {(searching || project) && <button type="button" className="btn btn-ghost btn-s" onClick={() => set({ query: '', project: '' })}>{t('plans.empty.clear')}</button>}</div>}
  </section>;
}

export function PlanRow({ info, now }: { info: PlanInfo; now: number }) {
  const chat = useApp(s => (info.ownerChatId ? s.chats[info.ownerChatId]?.title : undefined));
  const why = whyOf(info);
  return <li className="pl-row" data-s={info.state} data-wait={waitsForUser(info) ? '' : undefined} data-unseen={info.state === 'finished' ? '' : undefined} data-testid={`pl-row-${info.id}`}>
    <button type="button" className="pl-row-main" onClick={() => openPlan(info.id)} data-testid={`pl-open-${info.id}`}>
      <span className="pl-row-top"><b>{info.title}</b>{info.state === 'finished' && <em className="pl-new">{t('plans.unseen')}</em>}</span>
      <span className="pl-row-meta">
        <StateChip info={info} />
        {projectsOf(info).map(p => <span key={p} className="pl-project">{p}</span>)}
        {info.steps ? <><StepDots info={info} /><span>{t('plans.steps', { done: info.done, n: info.steps })}</span></> : <span>{t('plans.noPlan')}</span>}
        {info.blocked > 0 && <span className="pl-stuck">{t('plans.row.blocked', { n: info.blocked })}</span>}
        <LiveLine live={info.live} id={info.id} now={now} />
        {!!info.doubts?.open && <span className="pl-doubt-n" data-testid={`pl-row-doubts-${info.id}`}>{t('plans.doubts.open', { n: info.doubts.open })}</span>}
        {why && <span data-testid={`pl-why-${info.id}`}>{why}</span>}
        <span className="pl-at">{t('plans.row.updated', { at: ago(info.updatedAt, now) })}</span>
      </span>
    </button>
    {info.ownerChatId && chat !== undefined && <button type="button" className="btn btn-ghost btn-s" onClick={() => openChatRef(info.ownerChatId!)} title={chat} data-testid={`pl-chat-${info.id}`}><IconChat size={13} />{t('plans.openChat')}</button>}
  </li>;
}

function IdeaForm({ projects, project, onClose }: { projects: string[]; project: string; onClose: () => void }) {
  const [title, setTitle] = useState(''), [idea, setIdea] = useState(''), [label, setLabel] = useState(project), [busy, setBusy] = useState(false);
  const list = useId(), first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus({ preventScroll: true }); }, []);
  const save = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      const m = await window.sb.invoke('plans:idea', { title: title.trim(), ...(idea.trim() ? { idea: idea.trim() } : {}), ...(label.trim() ? { project: label.trim() } : {}) });
      onClose(); openPlan(m.id);
    } catch (e) { toast(t('plans.failedDo', { what: t('plans.idea.new'), why: errText(e) }), 'err'); setBusy(false); }
  };
  return <form className="pl-idea" data-testid="pl-idea" onSubmit={e => { e.preventDefault(); void save(); }} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
    <label className="field">{t('plans.idea.title')}<input ref={first} value={title} maxLength={PLAN_LIMITS.title} onChange={e => setTitle(e.target.value)} data-testid="pl-idea-title" /></label>
    <label className="field"><span>{t('plans.idea.project')} <small>{t('plans.idea.optional')}</small></span><input value={label} list={list} maxLength={PLAN_LIMITS.project} onChange={e => setLabel(e.target.value)} data-testid="pl-idea-project" /></label>
    <datalist id={list}>{projects.map(p => <option key={p} value={p} />)}</datalist>
    <label className="field pl-idea-text"><span>{t('plans.idea.text')} <small>{t('plans.idea.optional')}</small></span><textarea value={idea} rows={3} maxLength={PLAN_LIMITS.idea} onChange={e => setIdea(e.target.value)} data-testid="pl-idea-text" /></label>
    <div className="pl-idea-foot"><button type="submit" className="btn btn-primary btn-s" disabled={busy || !title.trim()} data-testid="pl-idea-save">{t('plans.idea.save')}</button><button type="button" className="btn btn-ghost btn-s" onClick={onClose}>{t('plans.cancel')}</button></div>
  </form>;
}
