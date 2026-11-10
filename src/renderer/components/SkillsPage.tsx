// "Skill" (G S; the «Skill» tab of Memoria, ADR 0122): the skill library (ADR 0241, #362). Owner 2026-11-09: with
// skills only, this page is the main way he sees and changes how his agents work; it must be very easy, fast and look
// really good; the app's own skills are visible and editable too. Left, the list: search (name, description, file
// names), filters by origin (brain, app, the user's own), usage, role and area, each row with what the skill is for, who
// loads it and how often it ran. Right, the chosen skill (skills/SkillDetail.tsx): Leggi, File (its package's tree and
// an editor for every text file), Ruoli, Cronologia (diff and Undo per change), plus «Prova» (/name in the Orchestrator).
// «Nuova skill» asks a name and a sentence, then opens the new SKILL.md. Owner 2026-11-10 («facile capire quali vengono
// usate di più e da chi, quante volte»): the list sorts by name, uses, last use or last change, and a strip above it
// names the most used skills (who uses each most in its tooltip); a click opens one. The reload after a change is
// coalesced (one read for a burst of brainmodel:changed), so opening the page does not stutter. The two panes fit the
// window and scroll on their own (a skill picked low in the list shows at once, without scrolling back up). Data: skills:library (main/skills/library.ts),
// read again on brainmodel:changed (an edit by the Orchestrator shows at once). Rendered by brain-model/MemoryPage.tsx;
// styles/skill-library.css. The one-time migration's report stays below while it has items (#367).
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { LibSkill, SkillLibraryState, SkillOrigin } from '@shared/skill-library';
import { SKILL_NAME } from '@shared/skill-library';
import { t } from '../i18n';
import { askConfirm, ui, toast } from '../store/ui';
import { useBrainModel } from '../store/brain-model';
import { parseHubArg } from '../lib/memory-hub';
import { errText } from '../lib/ipc-error';
import { HubIntro } from './brain-model/HubIntro';
import { MigrationReportPanel } from './brain-model/MaintenancePanel';
import { Select } from './Select';
import { HelpTip } from './HelpTip';
import { IconPlus, IconSearch, IconX } from './Icons';
import { SkillDetail, type DetailTab } from './skills/SkillDetail';
import { SORTS, sortSkills, type SortBy } from '../lib/skill-sort';
import '../styles/skill-library.css';

type OriginFilter = 'all' | SkillOrigin;
type UsageFilter = 'all' | 'used' | 'unused';
const ORIGINS: OriginFilter[] = ['all', 'brain', 'app', 'home'];
/** what the search looks in: the name, the description and the package's file paths */
export function matches(s: LibSkill, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = `${s.name} ${s.description} ${s.area ?? ''} ${s.files.map(f => f.path).join(' ')}`.toLowerCase();
  return words.every(w => hay.includes(w));
}

/** The page remembers the chosen skill and tab while the app is open (back from a chat lands where it was). */
let lastPick: { name: string | null; tab: DetailTab; sort: SortBy } = { name: null, tab: 'read', sort: 'name' };

function CreateForm({ onCancel, onCreated, taken }: { onCancel: () => void; onCreated: (name: string) => void; taken: (n: string) => boolean }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const clean = name.trim().toLowerCase().replace(/\s+/g, '-');
  const valid = SKILL_NAME.test(clean) && clean.length <= 64 && desc.trim().length > 0 && !taken(clean);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true); setError(null);
    const text = `---\nname: ${clean}\ndescription: ${JSON.stringify(desc.trim().replace(/\s+/g, ' '))}\n---\n${t('sl.create.body', { name: clean })}`;
    try {
      const r = await window.sb.invoke('skills:write', { skill: clean, path: 'SKILL.md', text });
      if (r.ok) { toast(t('sl.create.done', { name: clean }), 'ok'); onCreated(clean); } else setError(r.error);
    } catch (err) { setError(errText(err)); } finally { setBusy(false); }
  };
  return <form className="sl-create" onSubmit={e => void submit(e)} data-testid="sl-create" onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}>
    <h2>{t('sl.create.title')}</h2>
    <label className="sl-field"><span>{t('sl.create.name')} <em>{t('sl.create.nameHint')}</em></span>
      <input ref={ref} className="sl-input mono" value={name} onChange={e => setName(e.target.value)} placeholder="report-mensile" spellCheck={false} data-testid="sl-create-name" aria-invalid={!!name && (!SKILL_NAME.test(clean) || taken(clean))} /></label>
    <label className="sl-field"><span>{t('sl.create.desc')} <em>{t('sl.create.descHint')}</em></span>
      <textarea className="sl-input" rows={2} value={desc} onChange={e => setDesc(e.target.value.replace(/\r?\n/g, ' '))} data-testid="sl-create-desc" /></label>
    {error && <p className="sl-error" role="alert">{error}</p>}
    <div className="sl-create-actions">
      <button type="button" className="btn btn-subtle btn-s" onClick={onCancel}>{t('sl.create.cancel')}</button>
      <button type="submit" className="btn btn-primary btn-s" disabled={!valid || busy} data-testid="sl-create-go">{t('sl.create.go')}</button>
    </div>
  </form>;
}

function Row({ s, active, roleName, onPick }: { s: LibSkill; active: boolean; roleName: (id: string) => string; onPick: () => void }) {
  return <li>
    <button type="button" className="sl-row" aria-current={active ? 'true' : undefined} onClick={onPick} data-testid={`bm-skill-${s.name}`} data-origin={s.origin} data-unused={!s.totalUses}>
      <span className="sl-row-top">
        <span className="sl-row-name">{s.name}</span>
        <span className="sl-origin" data-origin={s.origin} title={t(`sl.originTip.${s.origin}`)}>{t(`sl.origin.${s.origin}`)}</span>
        {s.errors > 0 && <span className="sl-flag" data-tone="red">{t('sl.errors', { n: s.errors })}</span>}
      </span>
      <span className="sl-row-desc">{s.description || t('sl.noDescription')}</span>
      <span className="sl-row-meta">
        <span className="sl-row-roles">{s.roles.slice(0, 3).map(id => <span key={id} className="sl-role-dot" title={roleName(id)}>{roleName(id).slice(0, 1)}</span>)}{s.roles.length > 3 && <span className="sl-role-more">+{s.roles.length - 3}</span>}</span>
        <span className="sp" />
        <span className={s.totalUses ? 'sl-uses' : 'sl-uses none'}>{s.totalUses ? t('sl.uses', { n: s.totalUses }) : t('sl.noUses')}</span>
      </span>
    </button>
  </li>;
}

export function SkillsPage() {
  const arg = parseHubArg(ui.use(s => s.pageArg)).rest;
  const { state: model } = useBrainModel();
  const [lib, setLib] = useState<SkillLibraryState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState(() => arg ?? '');
  const [origin, setOrigin] = useState<OriginFilter>('all');
  const [usage, setUsage] = useState<UsageFilter>('all');
  const [role, setRole] = useState<string>('');
  const [area, setArea] = useState<string>('');
  const [pick, setPick] = useState<string | null>(() => lastPick.name);
  const [tab, setTab] = useState<DetailTab>(() => lastPick.tab);
  const [sort, setSort] = useState<SortBy>(() => lastPick.sort);
  const [creating, setCreating] = useState(false);
  const dirtyRef = useRef(false);
  useEffect(() => { lastPick = { name: pick, tab, sort }; }, [pick, tab, sort]);
  useEffect(() => { if (arg) setQ(arg); }, [arg]);

  const load = useCallback(async () => {
    try { setLib(await window.sb.invoke('skills:library', undefined)); setErr(null); } catch (e) { setErr(errText(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  // a burst of changes (a maintenance pass, an agent writing) is one read, a moment after the last one
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = window.sb.on('brainmodel:changed', () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { timer = null; void load(); }, 300); });
    return () => { off(); if (timer) clearTimeout(timer); };
  }, [load]);

  const skills = lib?.skills ?? [];
  const areas = useMemo(() => [...new Set(skills.map(s => s.area).filter((a): a is string => !!a))].sort(), [skills]);
  const shown = useMemo(() => skills.filter(s => (origin === 'all' || s.origin === origin)
    && (usage === 'all' || (usage === 'used' ? s.totalUses > 0 : !s.totalUses))
    && (!role || (role === '-' ? !s.roles.length : s.roles.includes(role)))
    && (!area || s.area === area) && matches(s, q)), [skills, origin, usage, role, area, q]);
  const sorted = useMemo(() => sortSkills(shown, sort), [shown, sort]);
  const top = useMemo(() => sortSkills(skills.filter(s => s.totalUses > 0), 'uses').slice(0, 5), [skills]);
  const filtered = origin !== 'all' || usage !== 'all' || !!role || !!area || !!q;
  const current = skills.find(s => s.name === pick) ?? null;
  // the first skill is open from the start: the right side is never an empty frame
  useEffect(() => { if (lib && !creating && (!pick || !current) && sorted[0]) setPick(sorted[0].name); }, [lib, pick, current, sorted, creating]);
  const roleName = useCallback((id: string) => lib?.roles.find(r => r.id === id)?.name ?? id, [lib]);
  const appCount = skills.filter(s => s.origin === 'app').length;

  /** leaving a file with unsaved edits asks first */
  const guard = (go: () => void) => {
    if (!dirtyRef.current) { go(); return; }
    askConfirm({ title: t('sl.files.unsavedTitle'), body: t('sl.files.unsavedBody'), confirmLabel: t('sl.files.leave'), danger: true, onConfirm: () => { dirtyRef.current = false; go(); } });
  };
  const main = useRef<HTMLElement>(null);
  // a skill picked by the user opens at its top with the whole shell in view: no scroll back up to read it
  const choose = (name: string) => guard(() => {
    setCreating(false); setPick(name);
    requestAnimationFrame(() => { const el = main.current; if (el) { el.scrollTop = 0; el.closest('.sl-shell')?.scrollIntoView({ block: 'nearest' }); } });
  });
  const list = useRef<HTMLUListElement>(null);
  /** ↑ ↓ move through the list, as in a file explorer */
  const onListKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = sorted.findIndex(s => s.name === pick), next = sorted[Math.max(0, Math.min(sorted.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next) { choose(next.name); requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-testid="bm-skill-${next.name}"]`)?.focus()); }
  };
  const clear = () => { setQ(''); setOrigin('all'); setUsage('all'); setRole(''); setArea(''); };

  return (
    <div className="sl-page" data-testid="skills-page">
      <HubIntro lead={lib ? t('sl.lead', { n: skills.length, app: appCount }) : '…'}
        actions={<button type="button" className="btn btn-primary btn-s" onClick={() => guard(() => setCreating(true))} disabled={!lib} data-testid="sk-new-skill"><IconPlus size={13} /> {t('sl.new')}</button>} />
      {err && <p className="sl-error" role="alert">{t('sl.loadError')} {err}</p>}
      {top.length > 0 && <div className="sl-top" data-testid="sl-top"><span className="sl-top-label">{t('sl.top')}</span>
        {top.map(s => { const who = s.uses[0] ? roleName(s.uses[0].role) : '';
          return <button key={s.name} type="button" className="sl-top-chip" aria-current={s.name === pick ? 'true' : undefined} title={t('sl.topTip', { name: s.name, n: s.totalUses, who })} onClick={() => choose(s.name)} data-testid={`sl-top-${s.name}`}>
            <span className="mono">{s.name}</span><span className="sl-n">{s.totalUses}</span></button>; })}
      </div>}
      <div className="sl-shell sl-fit">
        <aside className="sl-rail" aria-label={t('sl.searchLabel')}>
          <div className="sl-search">
            <IconSearch size={14} />
            <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={t('sl.search')} aria-label={t('sl.searchLabel')} data-testid="sk-search" spellCheck={false} />
            {q && <button type="button" className="sl-clear" onClick={() => setQ('')} aria-label={t('sl.clearFilters')}><IconX size={12} /></button>}
          </div>
          <div className="sl-origins" role="group" aria-label={t('sl.origin')}>
            {ORIGINS.map(o => <button key={o} type="button" aria-pressed={origin === o} onClick={() => setOrigin(o)} data-testid={`sl-origin-${o}`}>
              {t(`sl.origin.${o}`)}<span className="sl-n">{o === 'all' ? skills.length : skills.filter(s => s.origin === o).length}</span></button>)}
          </div>
          <div className="sl-filters">
            <Select className="st-select" value={usage} onChange={e => setUsage(e.target.value as UsageFilter)} aria-label={t('sl.usage')} data-testid="sl-usage">
              {(['all', 'used', 'unused'] as const).map(u => <option key={u} value={u}>{t(`sl.usage.${u}`)}</option>)}
            </Select>
            <Select className="st-select" value={role} onChange={e => setRole(e.target.value)} aria-label={t('sl.role')} data-testid="sl-role">
              <option value="">{t('sl.role.any')}</option>
              {lib?.roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              <option value="-">{t('sl.role.none')}</option>
            </Select>
            <Select className="st-select" value={sort} onChange={e => setSort(e.target.value as SortBy)} aria-label={t('sl.sort')} data-testid="sl-sort">
              {SORTS.map(o => <option key={o} value={o}>{t(`sl.sort.${o}`)}</option>)}
            </Select>
            {areas.length > 0 && <Select className="st-select" value={area} onChange={e => setArea(e.target.value)} aria-label={t('sl.area')} data-testid="sl-area">
              <option value="">{t('sl.area.any')}</option>
              {areas.map(a => <option key={a} value={a}>{a}</option>)}
            </Select>}
          </div>
          <div className="sl-count small" aria-live="polite">{t('sl.count', { shown: shown.length, n: skills.length })}{filtered && <button type="button" className="sl-link" onClick={clear}>{t('sl.clearFilters')}</button>}
            <HelpTip title={t('explain.skills.title')} wide guide="skills" testid="sk-help"><p>{t('explain.skills.p1')}</p><p>{t('explain.skills.p2')}</p></HelpTip></div>
          {!skills.length && lib ? <p className="sl-empty" data-testid="sk-empty">{t('sl.empty')}</p>
            : !shown.length && lib ? <p className="sl-empty" data-testid="sk-empty">{t('sl.emptySearch')}</p>
              : <ul className="sl-list" ref={list} onKeyDown={onListKey} data-testid="bm-skill-grid">
                {sorted.map(s => <Row key={s.name} s={s} active={!creating && s.name === pick} roleName={roleName} onPick={() => choose(s.name)} />)}
              </ul>}
        </aside>
        <section className="sl-main" ref={main}>
          {creating ? <CreateForm onCancel={() => setCreating(false)} taken={n => skills.some(s => s.name === n)} onCreated={name => { void load().then(() => { setPick(name); setTab('files'); setCreating(false); }); }} />
            : current ? <SkillDetail key={current.name} skill={current} roles={lib?.roles ?? []} hasBrain={!!lib?.root} tab={tab} onTab={next => { if (next !== tab) guard(() => setTab(next)); }}
              onDirty={d => { dirtyRef.current = d; }} onChanged={() => void load()} onGone={() => { setPick(null); void load(); }} />
              : <p className="sl-empty">{t('sl.pick')}</p>}
        </section>
      </div>
      {model?.migration && model.migration.items.length > 0 && <MigrationReportPanel report={model.migration} />}
    </div>
  );
}
