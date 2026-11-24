// The work maps' list (ADR 0342, 0343; the owner, 2026-11-23: «le mappe devono essere ben navigabili perchè ce ne saranno
// tante»): by status, what waits for the user on top, then under way, stopped, planned and ideas; the finished apart, in
// their own tab. Words (main searches titles, ideas and steps in both tabs), a project and an order narrow it, and stay
// when the user comes back from a map. A row opens the map; its other button the owner chat. «Nuova idea» writes one down.
// With an id in the place (`lavori/<id>`) it shows that map instead (WorkMapView.tsx). Rendered by brain-model/MapPage.tsx.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { waitsForUser, WORK_MAP_LIMITS, type WorkMapInfo } from '@shared/work-map';
import { openChatRef, openWorkMap } from '../../actions';
import { Seg } from '../../brain/components/ui';
import { t } from '../../i18n';
import { useNow } from '../../lib/clock';
import { ago } from '../../lib/format';
import { errText } from '../../lib/ipc-error';
import { allProjects, arrange, groupOf, projectsOf, WORK_SORTS, type WorkFilter, type WorkSort, type WorkTab } from '../../lib/work-maps';
import { toast } from '../../store/ui';
import { useApp } from '../../store/store';
import { useWorkMaps } from '../../store/work-maps';
import { IconChat, IconPlus, IconSearch, IconX } from '../Icons';
import { Select } from '../Select';
import { LiveLine, whyOf } from './LiveBits';
import { StateChip, StepDots } from './WorkBits';
import { WorkMapView } from './WorkMapView';
import './work-map.css';

const START: WorkFilter = { tab: 'open', query: '', project: '', sort: 'recent' };
/** what the user was looking for, kept while they open a map and come back */
let last: WorkFilter = START;

export function WorksView({ id }: { id: string | null }) {
  return id ? <WorkMapView key={id} id={id} onBack={() => openWorkMap(null)} /> : <WorkList />;
}

/** What main finds for the words: it reads the ideas and the steps' titles too. null = no words, or not answered yet. */
function useFound(query: string, rows: WorkMapInfo[] | null): WorkMapInfo[] | null {
  const [found, setFound] = useState<{ query: string; rows: WorkMapInfo[] } | null>(null);
  useEffect(() => {
    const q = query.trim();
    if (!q) { setFound(null); return; }
    let live = true;
    window.sb.invoke('workmap:list', { query: q }).then(r => { if (live) setFound({ query: q, rows: r }); }, (e: unknown) => { if (live) toast(t('wm.failed', { why: errText(e) }), 'err'); });
    return () => { live = false; };
  }, [query, rows]);
  return query.trim() ? found?.rows ?? null : null;
}

export function WorkList() {
  const { rows, error, retry } = useWorkMaps();
  const [filter, setFilter] = useState<WorkFilter>(last);
  const [writing, setWriting] = useState(false);
  const now = useNow(30_000);
  const set = (f: Partial<WorkFilter>) => { last = { ...filter, ...f }; setFilter(last); };
  const found = useFound(filter.query, rows);
  const projects = useMemo(() => allProjects(rows ?? []), [rows]);
  // a project whose last map is gone filters nothing more
  const project = projects.includes(filter.project) ? filter.project : '';
  const searching = !!filter.query.trim(), shown = searching ? found : rows;
  const groups = useMemo(() => arrange(shown ?? [], { ...filter, project }), [shown, filter, project]);
  const n = (tab: WorkTab) => (rows ?? []).filter(i => (groupOf(i) === 'finished') === (tab === 'finished')).length;
  const unseen = (rows ?? []).filter(i => i.state === 'finished').length;
  const found0 = groups.length === 0;
  return <section className="wm" data-testid="wm-list" aria-label={t('wm.list.label')}>
    <div className="wm-bar">
      <div className="bx"><Seg items={[{ id: 'open', label: `${t('wm.tab.open')} · ${n('open')}` }, { id: 'finished', label: `${t('wm.tab.finished')} · ${n('finished')}${unseen ? ` (${t('wm.tab.unseen', { n: unseen })})` : ''}` }]} value={filter.tab} onChange={tab => set({ tab })} label={t('wm.tab.label')} /></div>
      <label className="wm-search"><IconSearch size={14} /><input type="search" value={filter.query} placeholder={t('wm.search')} aria-label={t('wm.search')} onChange={e => set({ query: e.target.value })} data-testid="wm-search" />
        {filter.query && <button type="button" className="wm-x" aria-label={t('wm.empty.clear')} onClick={() => set({ query: '' })}><IconX size={12} /></button>}</label>
      <Select value={project} onChange={e => set({ project: e.target.value })} aria-label={t('wm.project.label')} data-testid="wm-project">
        <option value="">{t('wm.project.all')}</option>{projects.map(p => <option key={p} value={p}>{p}</option>)}
      </Select>
      <Select value={filter.sort} onChange={e => set({ sort: e.target.value as WorkSort })} aria-label={t('wm.sort.label')} data-testid="wm-sort">
        {WORK_SORTS.map(s => <option key={s} value={s}>{t(`wm.sort.${s}`)}</option>)}
      </Select>
      <span className="sp" />
      <button type="button" className="btn btn-ghost btn-s" onClick={() => setWriting(!writing)} aria-expanded={writing} data-testid="wm-idea-new"><IconPlus size={13} />{t('wm.idea.new')}</button>
    </div>
    {writing && <IdeaForm projects={projects} project={project} onClose={() => setWriting(false)} />}
    {error && <div className="wm-empty" role="alert">{t('wm.failed', { why: error })} <button type="button" className="btn btn-ghost btn-s" onClick={retry}>{t('wm.retry')}</button></div>}
    {!shown && !error ? <div className="wm-empty">{t('wm.loading')}</div> : groups.map(g => <section key={g.group} className="wm-group" data-group={g.group} data-testid={`wm-group-${g.group}`}>
      <h3>{t(`wm.group.${g.group}`)} <small>{g.items.length}</small></h3>
      <ul>{g.items.map(i => <WorkRow key={i.id} info={i} now={now} />)}</ul>
    </section>)}
    {shown && found0 && !error && <div className="wm-empty" data-testid="wm-empty">{searching || project ? t('wm.empty.search') : t(`wm.empty.${filter.tab}`)}
      {(searching || project) && <button type="button" className="btn btn-ghost btn-s" onClick={() => set({ query: '', project: '' })}>{t('wm.empty.clear')}</button>}</div>}
  </section>;
}

export function WorkRow({ info, now }: { info: WorkMapInfo; now: number }) {
  const chat = useApp(s => (info.ownerChatId ? s.chats[info.ownerChatId]?.title : undefined));
  const why = whyOf(info);
  return <li className="wm-row" data-s={info.state} data-wait={waitsForUser(info) ? '' : undefined} data-unseen={info.state === 'finished' ? '' : undefined} data-testid={`wm-row-${info.id}`}>
    <button type="button" className="wm-row-main" onClick={() => openWorkMap(info.id)} data-testid={`wm-open-${info.id}`}>
      <span className="wm-row-top"><b>{info.title}</b>{info.state === 'finished' && <em className="wm-new">{t('wm.unseen')}</em>}</span>
      <span className="wm-row-meta">
        <StateChip info={info} />
        {projectsOf(info).map(p => <span key={p} className="wm-project">{p}</span>)}
        {info.steps ? <><StepDots info={info} /><span>{t('wm.steps', { done: info.done, n: info.steps })}</span></> : <span>{t('wm.noPlan')}</span>}
        {info.blocked > 0 && <span className="wm-stuck">{t('wm.row.blocked', { n: info.blocked })}</span>}
        <LiveLine live={info.live} id={info.id} now={now} />
        {!!info.doubts?.open && <span className="wm-doubt-n" data-testid={`wm-row-doubts-${info.id}`}>{t('wm.doubts.open', { n: info.doubts.open })}</span>}
        {why && <span data-testid={`wm-why-${info.id}`}>{why}</span>}
        <span className="wm-at">{t('wm.row.updated', { at: ago(info.updatedAt, now) })}</span>
      </span>
    </button>
    {info.ownerChatId && chat !== undefined && <button type="button" className="btn btn-ghost btn-s" onClick={() => openChatRef(info.ownerChatId!)} title={chat} data-testid={`wm-chat-${info.id}`}><IconChat size={13} />{t('wm.openChat')}</button>}
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
      const m = await window.sb.invoke('workmap:idea', { title: title.trim(), ...(idea.trim() ? { idea: idea.trim() } : {}), ...(label.trim() ? { project: label.trim() } : {}) });
      onClose(); openWorkMap(m.id);
    } catch (e) { toast(t('wm.failedDo', { what: t('wm.idea.new'), why: errText(e) }), 'err'); setBusy(false); }
  };
  return <form className="wm-idea" data-testid="wm-idea" onSubmit={e => { e.preventDefault(); void save(); }} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
    <label className="field">{t('wm.idea.title')}<input ref={first} value={title} maxLength={WORK_MAP_LIMITS.title} onChange={e => setTitle(e.target.value)} data-testid="wm-idea-title" /></label>
    <label className="field"><span>{t('wm.idea.project')} <small>{t('wm.idea.optional')}</small></span><input value={label} list={list} maxLength={WORK_MAP_LIMITS.project} onChange={e => setLabel(e.target.value)} data-testid="wm-idea-project" /></label>
    <datalist id={list}>{projects.map(p => <option key={p} value={p} />)}</datalist>
    <label className="field wm-idea-text"><span>{t('wm.idea.text')} <small>{t('wm.idea.optional')}</small></span><textarea value={idea} rows={3} maxLength={WORK_MAP_LIMITS.idea} onChange={e => setIdea(e.target.value)} data-testid="wm-idea-text" /></label>
    <div className="wm-idea-foot"><button type="submit" className="btn btn-primary btn-s" disabled={busy || !title.trim()} data-testid="wm-idea-save">{t('wm.idea.save')}</button><button type="button" className="btn btn-ghost btn-s" onClick={onClose}>{t('wm.cancel')}</button></div>
  </form>;
}
