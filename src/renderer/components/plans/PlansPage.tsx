// The plans' page (ADR 0359; the owner, 2026-11-23: «devono essere ben navigabili perché ce ne saranno tante»): groups «Aspettano
// te», «In corso», «Fermi», «Idee» and «Finiti» (closed by default), words and a project narrow it, an order sorts it, and the
// trash is its own list. A row shows the title, the state, the progress bar with its percentage and «2 di 6», the next step,
// who works, the last change, and the buttons Apri, Riprendi, Riprogetta, Archivia and Elimina (in the trash: Ripristina and
// Elimina per sempre, which asks first). «Nuovo piano» writes one down, as an idea or to plan at once. With an id in the place
// (`piani/<id>`) it shows that plan instead (PlanView.tsx). Rendered by App.tsx PageFrame for 'piani'.
import { useEffect, useMemo, useState } from 'react';
import { waitsForUser, type PlanInfo } from '@shared/plan';
import { brainBridge, openChatRef, openPlan } from '../../actions';
import { t } from '../../i18n';
import { useNow } from '../../lib/clock';
import { ago } from '../../lib/format';
import { errText } from '../../lib/ipc-error';
import { allProjects, arrange, PLAN_SORTS, ROW_BUTTONS, buttonsOf, planTimeLabel, type PlanFilter, type PlanGroup, type PlanSort } from '../../lib/plans';
import { toast } from '../../store/ui';
import { useApp } from '../../store/store';
import { usePlans } from '../../store/plans';
import { IconChat, IconSearch, IconX } from '../Icons';
import { Select } from '../Select';
import { LiveLine, whyOf } from './LiveBits';
import { actionLabel, ProgressBar, StateChip, usePlanAction } from './PlanBits';
import { PlanView, wantReplan } from './PlanView';
import './plans.css';

const START: PlanFilter = { trash: false, query: '', project: '', sort: 'recent' };
/** what the user was looking for, kept while they open a plan and come back */
let last: PlanFilter = START;

export function PlansPage({ id }: { id: string | null }) {
  return id ? <PlanView key={id} id={id} onBack={() => openPlan(null)} /> : <PlanList />;
}

/** What main finds for the words: goals, constraints and the steps' titles too, which a row does not carry. Debounced 200ms. */
function useFound(query: string, rows: PlanInfo[] | null): PlanInfo[] | null {
  const [found, setFound] = useState<{ query: string; rows: PlanInfo[] } | null>(null);
  useEffect(() => {
    const q = query.trim();
    if (!q) { setFound(null); return; }
    let live = true;
    const timer = setTimeout(() => {
      window.sb.invoke('plans:list', { query: q }).then(r => { if (live) setFound({ query: q, rows: r }); }, (e: unknown) => { if (live) toast(t('plans.failed', { why: errText(e) }), 'err'); });
    }, 200);
    return () => { live = false; clearTimeout(timer); };
  }, [query, rows]);
  return query.trim() ? found?.rows ?? null : null;
}

export function PlanList() {
  const { rows, error, retry } = usePlans();
  const [filter, setFilter] = useState<PlanFilter>(last), [open, setOpen] = useState(false);
  const now = useNow(30_000);
  const set = (f: Partial<PlanFilter>) => { last = { ...filter, ...f }; setFilter(last); };
  const found = useFound(filter.query, rows);
  const projects = useMemo(() => allProjects(rows ?? []), [rows]);
  const project = projects.includes(filter.project) ? filter.project : '';
  const searching = !!filter.query.trim(), shown = searching ? found : rows;
  const groups = useMemo(() => arrange(shown ?? [], { ...filter, project }), [shown, filter, project]);
  const trashed = (rows ?? []).filter(i => i.deleted).length;
  const askOrchestrator = () => {
    const prefix = project ? `Crea un piano per il progetto ${project}: ` : 'Crea un nuovo piano: ';
    brainBridge.draftToOrchestrator(prefix, () => {});
  };
  return <section className="pl" data-testid="pl-list" aria-label={t('plans.list.label')}>
    <div className="pl-bar">
      <label className="pl-search"><IconSearch size={14} /><input type="search" value={filter.query} placeholder={t('plans.search')} aria-label={t('plans.search')} onChange={e => set({ query: e.target.value })} data-testid="pl-search" />
        {filter.query && <button type="button" className="pl-x" aria-label={t('plans.empty.clear')} onClick={() => set({ query: '' })}><IconX size={12} /></button>}</label>
      <Select value={project} onChange={e => set({ project: e.target.value })} aria-label={t('plans.project.label')} data-testid="pl-project">
        <option value="">{t('plans.project.all')}</option>{projects.map(p => <option key={p} value={p}>{p}</option>)}
      </Select>
      <Select value={filter.sort} onChange={e => set({ sort: e.target.value as PlanSort })} aria-label={t('plans.sort.label')} data-testid="pl-sort">
        {PLAN_SORTS.map(s => <option key={s} value={s}>{t(`plans.sort.${s}`)}</option>)}
      </Select>
      <span className="sp" />
      <button type="button" className="btn btn-ghost btn-s" aria-pressed={filter.trash} onClick={() => set({ trash: !filter.trash })} data-testid="pl-trash-toggle">{filter.trash ? t('plans.trash.back') : `${t('plans.trash')}${trashed ? ` · ${trashed}` : ''}`}</button>
      <button type="button" className="btn btn-ghost btn-s pl-orch-btn" onClick={askOrchestrator} data-testid="pl-ask-orchestrator"><IconChat size={13} />Chiedi all&apos;Orchestrator</button>
    </div>
    {filter.trash && <p className="pl-muted">{t('plans.trash.hint')}</p>}
    {error && <div className="pl-empty" role="alert">{t('plans.failed', { why: error })} <button type="button" className="btn btn-ghost btn-s" onClick={retry}>{t('plans.retry')}</button></div>}
    {!shown && !error ? <div className="pl-empty">{t('plans.loading')}</div> : groups.map(g => <Group key={g.group} group={g.group} items={g.items} now={now} open={open} onOpen={() => setOpen(!open)} trash={filter.trash} />)}
    {shown && !groups.length && !error && <div className="pl-empty" data-testid="pl-empty">{searching || project ? t('plans.empty.search') : t(filter.trash ? 'plans.empty.trash' : 'plans.empty.open')}
      {(searching || project) && <button type="button" className="btn btn-ghost btn-s" onClick={() => set({ query: '', project: '' })}>{t('plans.empty.clear')}</button>}</div>}
  </section>;
}

function Group({ group, items, now, open, onOpen, trash }: { group: PlanGroup; items: PlanInfo[]; now: number; open: boolean; onOpen: () => void; trash: boolean }) {
  // the finished are closed by default: a click on the heading opens them
  const closed = group === 'finished' && !trash && !open;
  return <section className="pl-group" data-group={group} data-closed={closed ? '' : undefined} data-testid={`pl-group-${group}`}>
    <h3>{group === 'finished' && !trash
      ? <button type="button" className="pl-group-toggle" aria-expanded={!closed} onClick={onOpen} data-testid="pl-group-finished-toggle">{closed ? '▸' : '▾'} {t(`plans.group.${group}`)} <small>{items.length}</small></button>
      : <>{trash ? t('plans.trash') : t(`plans.group.${group}`)} <small>{items.length}</small></>}</h3>
    {!closed && <ul>{items.map(i => <PlanRow key={i.id} info={i} now={now} />)}</ul>}
  </section>;
}

export function PlanRow({ info, now }: { info: PlanInfo; now: number }) {
  const chat = useApp(s => (info.ownerChatId ? s.chats[info.ownerChatId]?.title : undefined));
  const { busy, run } = usePlanAction(), [sure, setSure] = useState(false);
  const why = whyOf(info), can = new Set(buttonsOf(info));
  const open = () => openPlan(info.id);
  const forget = async () => { try { await window.sb.invoke('plans:forget', { id: info.id }); } catch (e) { toast(errText(e), 'err'); } setSure(false); };
  return <li className="pl-row2" data-s={info.state} data-wait={waitsForUser(info) ? '' : undefined} data-testid={`pl-row-${info.id}`}>
    <button type="button" className="pl-row-main" onClick={open} data-testid={`pl-open-${info.id}`}>
      <span className="pl-row-top"><b>{info.title}</b><StateChip info={info} />{info.project && <span className="pl-project">{info.project}</span>}</span>
      <span className="pl-row-meta">
        {info.steps ? <ProgressBar info={info} testid={`pl-progress-${info.id}`} /> : <span>{t('plans.noPlan')}</span>}
        {info.next ? <span data-testid={`pl-next-${info.id}`}>{t('plans.next', { title: info.next.title })}</span> : info.steps > 0 && info.state === 'running' ? <span>{t('plans.next.none')}</span> : null}
        {info.ready > 1 && <span className="pl-ready" data-testid={`pl-ready-${info.id}`}>{t('plans.ready', { n: info.ready })}</span>}
        {info.time && <span className="pl-time" data-testid={`pl-time-${info.id}`}>{planTimeLabel(info.time)}</span>}
        {info.blocked > 0 && <span className="pl-stuck">{t('plans.row.blocked', { n: info.blocked })}</span>}
        {info.check > 0 && <span className="pl-stuck">{t('plans.row.check', { n: info.check })}</span>}
        <LiveLine live={info.live} id={info.id} now={now} />
        {!!info.doubts?.open && <span className="pl-doubt-n" data-testid={`pl-row-doubts-${info.id}`}>{t('plans.doubts.open', { n: info.doubts.open })}</span>}
        {why && <span data-testid={`pl-why-${info.id}`}>{why}</span>}
        <span className="pl-at">{t('plans.row.updated', { at: ago(info.updatedAt, now) })}</span>
      </span>
    </button>
    <span className="pl-row-actions">
      {ROW_BUTTONS.filter(a => can.has(a)).map(a => <button key={a} type="button" className="btn btn-ghost btn-s" disabled={busy}
        onClick={() => { if (a === 'replan') { wantReplan(info.id); open(); } else void run(info, a); }} data-testid={`pl-do-${a}-${info.id}`}>{actionLabel(a, info.state)}</button>)}
      {info.deleted && (sure
        ? <button type="button" className="btn btn-s pl-danger" onClick={() => void forget()} data-testid={`pl-forget-yes-${info.id}`} title={t('plans.forget.ask')}>{t('plans.forget.yes')}</button>
        : <button type="button" className="btn btn-ghost btn-s" onClick={() => setSure(true)} data-testid={`pl-forget-${info.id}`}>{t('plans.do.forget')}</button>)}
      {info.ownerChatId && chat !== undefined && <button type="button" className="btn btn-ghost btn-s" onClick={() => openChatRef(info.ownerChatId!)} title={chat} aria-label={t('plans.openChat')} data-testid={`pl-chat-${info.id}`}><IconChat size={13} /></button>}
    </span>
  </li>;
}
