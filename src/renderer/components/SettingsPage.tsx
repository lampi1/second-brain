// Settings page (rendered by App.tsx; each section's title, description and search words: lib/settings-sections.ts, which the Orchestrator's app map and the palette read too, ADR 0149, 0207).
// Layout (ADR 0207, after macOS System Settings and VS Code's settings): a sticky left column with the search on top and the sections in labelled groups (an icon tile each, the
// section in view marked while scrolling, and while searching how many rows match), and on the right every section as a header and a card of rows (text and one-line description
// left, the control right: switch, segmented choice, select, value with unit). The search filters sections (title, description, keywords, and the text of their rows), hides the rows
// of a section that does not match by itself, and highlights the words (CSS Custom Highlight API: no DOM rewrite). A change saves at once: a quiet «Salvato» in the page header with
// «Annulla» when the change has an undo (settings history, settings:undo). Protected settings (an agent can only propose them) carry a shield.
// Connettori: ConnectorsHub.tsx (accounts and MCP servers, ADR 0086; the catalog, ADR 0119; the paste-to-add flow, McpAddPanel.tsx, ADR 0207). Avanzate: the technical MCP form and
// import (ConnectorsHub.tsx McpAdvanced). Ruoli e deleghe: DelegationSettings.tsx (ADR 0083). Aggiornamenti: AppUpdateSettings.tsx (ADR 0075; "impostazioni/update" opens on it).
// Scrittura: SuggestSettings.tsx (ADR 0118). Voce: VoiceSettings.tsx (ADR 0152). Stored technical policies and engine denials are preserved, never enabled by rendering.
// Account actions use existing typed login/secure-storage/trust boundaries; no provider routing matrix or policy wall.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Select } from './Select';
import type { CliStatus, EngineInfo, SecretsStatus } from '@shared/contract';
import { isLang, LANGS } from '@shared/contract';
import { IconBell, IconBranch, IconEdit, IconFolder, IconLink, IconMic, IconMoon, IconRefresh, IconSearch, IconSettings, IconShield, IconTerminal, IconUser, IconX } from './Icons';
import { DelegationSettings } from './DelegationSettings';
import { useEngines } from '../lib/engines';
import { hitRanges, matchesSettingsSearch } from '../lib/settings-page';
import { SETTINGS_TONE, navGroups, settingsSections } from '../lib/settings-sections';
import { useApp, setSetting } from '../store/store';
import { ui, setPrefs, openModal, toast } from '../store/ui';
import { t } from '../i18n';
import { AppearancePreview } from './AppearancePreview';
import { HelpTip } from './HelpTip';
import { WorkProfilePreferences } from './WorkProfilePreferences';
import { ProfileSettings } from './ProfileSettings';
import { holdUpdate } from '../lib/update-barrier';
import { ProjectsFolderSetting } from './ProjectsFolderSetting';
import { BrainShareSetting } from './BrainShareSetting';
import { ConnectorsHub, McpAdvanced } from './ConnectorsHub';
import { CodexAutonomy } from './CodexAutonomy';
import { AppUpdateSettings } from './AppUpdateSettings';
import { TaskReadSettings } from './TaskReadSettings';
import { SuggestSettings } from './SuggestSettings';
import { AwaySettings } from './AwayToggle';
import { VoiceSettings } from './VoiceSettings';
import { SavedPill, savedLocally } from './SettingsSaved';
import '../styles/settings.css';

export function Switch({ on, onChange, label, busy, testid }: { on: boolean; onChange: (on: boolean) => void; label: string; busy?: boolean; testid?: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={busy} className={`st-switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} data-testid={testid}><span className="st-knob" aria-hidden="true" /></button>;
}

/** A few exclusive choices side by side (theme, density, notifications): the macOS segmented control. */
export function Segmented<V extends string>({ value, options, onChange, label, testid }: { value: V; options: readonly { value: V; label: string }[]; onChange: (v: V) => void; label: string; testid?: string }) {
  // a radio group: one tab stop (the chosen one), the arrows move and choose, like native radios
  const step = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const el = e.currentTarget;
    const i = Math.max(0, options.findIndex(o => o.value === value)), next = options[(i + d + options.length) % options.length]!;
    onChange(next.value);
    requestAnimationFrame(() => el.querySelector<HTMLElement>(`[data-value="${next.value}"]`)?.focus());
  };
  return <div className="st-seg" role="radiogroup" aria-label={label} data-testid={testid} data-value={value} onKeyDown={step}>
    {options.map(o => <button key={o.value} type="button" role="radio" aria-checked={o.value === value} tabIndex={o.value === value ? 0 : -1} className={o.value === value ? 'on' : ''} data-value={o.value} onClick={() => { if (o.value !== value) onChange(o.value); }}>{o.label}</button>)}
  </div>;
}

/** The shield of a protected setting: an agent can only propose it, the user's click (or their own ask to the Orchestrator) changes it. */
export function ProtectedMark() {
  return <span className="st-protected" title={t('stx.protectedTip')} aria-label={t('stx.protected')}><IconShield size={12} /><span>{t('stx.protected')}</span></span>;
}

function Row({ title, children, description, help, guarded }: { title: string; children: ReactNode; description?: string; help?: ReactNode; guarded?: boolean }) {
  return <div className="st-row">
    <div className="st-text">
      <span className="st-title-line"><label className="st-title">{title}</label>{help}{guarded && <ProtectedMark />}</span>
      {description && <p className="st-desc">{description}</p>}
    </div>
    <div className="st-ctl">{children}</div>
  </div>;
}

function ToolConnection({engine}:{engine:EngineInfo}){
 const roots=useApp(s=>s.settings?.codexAutonomyRoots??[]);
 const enabled=useApp(s=>s.settings?.engineOn[engine.id]===true),policy=useApp(s=>s.settings?.engines[engine.id]===true);
 const[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[login,setLogin]=useState<CliStatus|null>(null),[keys,setKeys]=useState<SecretsStatus|null>(null),[key,setKey]=useState('');
 useEffect(()=>key?holdUpdate(t('essential.key')):undefined,[key]);
 const run=async(action:()=>Promise<unknown>)=>{if(busy)return;setBusy(true);try{await action();}catch{toast(t('essential.error'),'err');}finally{setBusy(false);}};
 useEffect(()=>{if(!open||engine.key==='none')return;let live=true;void window.sb.invoke('secrets:status',undefined).then(result=>{if(live)setKeys(result);},()=>{if(live)setKeys(null);});return()=>{live=false;};},[open,engine.id,engine.key]);
 const check=()=>run(async()=>{setLogin(await window.sb.invoke('cli:status',{harness:engine.id,checkLogin:true}));});
 return <article className="st-tool" data-testid={`st-tool-${engine.id}`}>
  <div className="st-row"><div className="st-text"><span className="st-title-line"><b className="st-title">{engine.name}</b><ProtectedMark/></span><span className={`st-state ${enabled&&engine.trusted&&policy?'on':''}`}>{enabled&&engine.trusted&&policy?t('essential.available'):t('essential.off')}</span></div><button type="button" className="btn btn-ghost btn-m st-expand" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>{t('essential.configure')}</button></div>
  {open&&<div className="st-tool-connection">
   {!policy&&<p className="st-desc">{t('essential.policy')}</p>}
   {!engine.trusted?<><p>{t('essential.trustNeeded')}</p><code>{engine.runs}</code><button type="button" className="btn btn-primary btn-m" disabled={busy} onClick={()=>void run(()=>window.sb.invoke('engines:trust',{engine:engine.id}))}>{t('essential.trust')}</button></>:<button type="button" className={`btn btn-m ${enabled?'btn-ghost':'btn-primary'}`} disabled={busy} onClick={()=>void setSetting({engineOn:{[engine.id]:!enabled}})}>{t(enabled?'essential.disable':'essential.enable')}</button>}
   {engine.kind!=='api'&&<div className="st-inline"><button type="button" className="btn btn-ghost btn-m" disabled={busy||!enabled||!engine.trusted} onClick={()=>void check()}>{t('essential.check')}</button><button type="button" className="btn btn-ghost btn-m" disabled={busy||!enabled||!engine.trusted} onClick={()=>void run(()=>window.sb.invoke('cli:login',{harness:engine.id}))}>{t('essential.signIn')}</button>{login&&<span role="status" className="st-desc">{!login.found?t('essential.notInstalled'):login.loggedIn===true?t('essential.signedIn'):login.loggedIn===false?t('essential.signInNeeded'):t('essential.unknown')}</span>}</div>}
   {engine.key!=='none'&&<div className="st-key"><label>{t('essential.key')}<input className="st-input" type="password" autoComplete="off" spellCheck={false} value={key} disabled={!keys?.available||busy} onChange={event=>setKey(event.target.value)}/></label><button type="button" className="btn btn-primary btn-m" disabled={!keys?.available||busy||!key.trim()} onClick={()=>{const value=key.trim();setKey('');void run(async()=>{setKeys(await window.sb.invoke('secrets:set',{engine:engine.id,key:value}));});}}>{t('common.save')}</button>{keys?.keys[engine.id]&&<><small className="st-desc">{t('essential.keySaved')}</small><button type="button" className="btn btn-danger btn-m" disabled={busy} onClick={()=>void run(async()=>{setKeys(await window.sb.invoke('secrets:delete',{engine:engine.id}));})}>{t('essential.deleteKey')}</button></>}{keys&&!keys.available&&<p role="status" className="st-desc">{t('essential.keyUnavailable')}</p>}</div>}
  </div>}
  {engine.id==='codex'&&<CodexAutonomy roots={roots}/>}
 </article>;
}

const HIGHLIGHT = 'st-hit';
type HighlightRegistry = { set(name: string, h: unknown): void; delete(name: string): void };
const highlights = (): HighlightRegistry | null => (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS?.highlights ?? null;
const HighlightCtor = (globalThis as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;

/** Marks the search words in the visible sections and the navigation (no DOM change: a CSS highlight over Ranges). */
function paintHits(roots: readonly Element[], query: string): void {
  const reg = highlights();
  if (!reg || !HighlightCtor) return;
  if (!query.trim()) { reg.delete(HIGHLIGHT); return; }
  const ranges: Range[] = [];
  for (const root of roots) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n && ranges.length < 400; n = walker.nextNode()) {
      const text = n.textContent ?? '';
      if (!text.trim() || (n.parentElement && n.parentElement.closest('[hidden],[data-st-miss],option,script,style'))) continue;
      for (const [a, b] of hitRanges(text, query)) { const r = document.createRange(); r.setStart(n, a); r.setEnd(n, b); ranges.push(r); }
    }
  }
  reg.set(HIGHLIGHT, new HighlightCtor(...ranges));
}

export function SettingsPage() {
  const prefs = ui.use(s => s.prefs), settings = useApp(s => s.settings), engines = useEngines(), [query, setQuery] = useState('');
  const [bodyHits, setBodyHits] = useState<Record<string, number>>({});
  const [current, setCurrent] = useState('profile');
  const results = useRef<HTMLDivElement>(null), nav = useRef<HTMLElement>(null), chosen = useRef({ until: 0 });
  // a link to one section ("impostazioni/update": the restart notice's «Aggiornamenti»; Task's «Impostazioni di lettura» → notifications, ADR 0101) scrolls to it once the
  // page is drawn, and once more when the sections above it have loaded (the connectors and the update panel grow after the first paint)
  const arg = ui.use(s => (s.page === 'impostazioni' ? s.pageArg : null));
  useEffect(() => {
    if (!arg || !settings) return;
    const id = arg.split('/')[0]!;
    setCurrent(id);
    const go = () => document.getElementById(`st-section-${id}`)?.scrollIntoView({ block: 'start' });
    const raf = requestAnimationFrame(go); const again = setTimeout(go, 700);
    return () => { cancelAnimationFrame(raf); clearTimeout(again); };
  }, [arg, !!settings]);
  const meta = settingsSections(engines.map(engine => engine.name));
  const choose = <V extends string>(v: V) => v;
  const groups: { id: string; title: string; description: string; search: string; icon: ReactNode; body: ReactNode }[] = !settings ? [] : [
    { ...meta.profile, icon: <IconUser size={16} />, body: <ProfileSettings /> },
    { ...meta.update, icon: <IconRefresh size={16} />, body: <AppUpdateSettings /> },
    { ...meta.connectors, icon: <IconLink size={16} />, body: <ConnectorsHub /> },
    { ...meta.accounts, icon: <IconTerminal size={16} />, body: <>{engines.map(engine => <ToolConnection key={engine.id} engine={engine} />)}</> },
    { ...meta.roles, icon: <IconBranch size={16} />, body: <><AwaySettings /><DelegationSettings /></> },
    { ...meta.space, icon: <IconFolder size={16} />, body: <>
      <WorkProfilePreferences />
      <Row title={t('essential.memory')} guarded><span className="st-value" title={settings.brainRoot ?? undefined}>{settings.brainRoot || t('essential.memoryEmpty')}</span><button type="button" className="btn btn-ghost btn-m" onClick={() => void window.sb.invoke('app:pickBrain', undefined).catch(() => toast(t('essential.error'), 'err'))}>{t('essential.pickMemory')}</button></Row>
      <BrainShareSetting />
      <ProjectsFolderSetting />
      <Row title={t('essential.archive')} description={t('essential.archiveHint')}><Select aria-label={t('essential.archive')} data-testid="st-archive-select" value={settings.autoCloseMin} onChange={event => void setSetting({ autoCloseMin: Number(event.target.value) })}>{[...new Set([0, 2, 5, 10, 30, settings.autoCloseMin])].sort((a, b) => a - b).map(count => <option key={count} value={count}>{count ? t('essential.minutes', { count }) : t('essential.never')}</option>)}</Select></Row>
      <Row title={t('essential.setupTitle')} description={t('essential.setupHint')}><button type="button" className="btn btn-ghost btn-m" onClick={() => openModal('setup')}>{t('essential.setup')}</button></Row>
    </> },
    { ...meta.writing, icon: <IconEdit size={16} />, body: <SuggestSettings /> },
    { ...meta.voice, icon: <IconMic size={16} />, body: <VoiceSettings /> },
    { ...meta.appearance, icon: <IconMoon size={16} />, body: <>
      <Row title={t('essential.theme')} description={t('stx.themeHint')}><Segmented label={t('essential.theme')} testid="st-theme-select" value={prefs.theme} onChange={theme => { setPrefs({ theme }); savedLocally(); }}
        options={(['system', 'light', 'dark'] as const).map(value => ({ value: choose(value), label: t(`essential.${value}`) }))} /></Row>
      <Row title={t('settings.language')} description={t('stx.languageHint')}><Select aria-label={t('settings.language')} value={settings.language} onChange={event => { const language = event.target.value; if (language === 'system' || isLang(language)) void setSetting({ language }); }} data-testid="st-language-select">{(['system', ...LANGS] as const).map(value => <option key={value} value={value}>{t(`settings.language.${value}`)}</option>)}</Select></Row>
      <Row title={t('essential.density')} description={t('stx.densityHint')}><Segmented label={t('essential.density')} testid="st-density-select" value={prefs.density} onChange={density => { setPrefs({ density }); savedLocally(); }}
        options={(['comfortable', 'compact'] as const).map(value => ({ value: choose(value), label: t(`essential.${value}`) }))} /></Row>
      <div className="st-row st-row-block"><AppearancePreview /></div>
    </> },
    { ...meta.notifications, icon: <IconBell size={16} />, body: <>
      <Row title={t('essential.toasts')} description={t('essential.notificationsHint')} guarded help={<HelpTip title={t('explain.toasts.title')} testid="st-toasts-help"><p>{t('explain.toasts.p1')}</p></HelpTip>}>
        <Segmented label={t('essential.toasts')} testid="st-toasts-select" value={settings.osToasts} onChange={osToasts => void setSetting({ osToasts })}
          options={(['urgent', 'normal', 'off'] as const).map(value => ({ value: choose(value), label: t(value === 'off' ? 'essential.none' : `essential.${value}`) }))} />
      </Row>
      <TaskReadSettings />
    </> },
    { ...meta.advanced, icon: <IconSettings size={16} />, body: <McpAdvanced /> },
  ];
  // the page's order follows the navigation's groups
  const nav2 = navGroups(groups.map(g => g.id));
  const order = nav2.flatMap(g => g.ids);
  const sorted = [...groups].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const searching = query.trim().length > 0;
  const metaHit = useMemo(() => new Set(groups.filter(g => matchesSettingsSearch(query, `${g.title} ${g.description} ${g.search}`)).map(g => g.id)), [query, groups.map(g => g.id + g.search).join('|')]);
  const shown = (id: string) => !searching || metaHit.has(id) || (bodyHits[id] ?? 0) > 0;
  const visible = sorted.filter(g => shown(g.id));

  // the rows that match: a section that matches by itself keeps all its rows; another shows only its matching rows. Read from the DOM (the rows live in many components),
  // again when a section's content changes (connectors and updates load late); hidden by a data attribute, never by changing React's nodes.
  useLayoutEffect(() => {
    const root = results.current;
    if (!root) return;
    let frame = 0;
    const scan = () => {
      frame = 0;
      const next: Record<string, number> = {};
      for (const section of root.querySelectorAll<HTMLElement>('section.st-group')) {
        const id = section.dataset.section!, own = metaHit.has(id);
        let n = 0;
        for (const row of section.querySelectorAll<HTMLElement>(':scope > .st-card > *')) {
          const hit = searching && matchesSettingsSearch(query, row.textContent ?? '');
          if (hit) n++;
          if (searching && !own && !hit) row.setAttribute('data-st-miss', ''); else row.removeAttribute('data-st-miss');
        }
        if (searching && !n && !own && matchesSettingsSearch(query, section.querySelector('.st-card')?.textContent ?? '')) n = 1;
        next[id] = n;
      }
      setBodyHits(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      paintHits([root, ...(nav.current ? [nav.current] : [])], query);
    };
    scan();
    const watch = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(scan); });
    watch.observe(root, { childList: true, subtree: true, characterData: true });
    return () => { watch.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [query, metaHit, searching]);
  useEffect(() => () => highlights()?.delete(HIGHLIGHT), []);

  // the section in view, marked in the navigation (scroll-spy): the last one whose header is above the top fifth of the
  // page's scroll area (any scroll on the page, read once per frame); at the very bottom, the last one
  useEffect(() => {
    const root = results.current;
    if (!root || searching) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      let scroller: HTMLElement | null = root.parentElement;
      while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
      const box = scroller?.getBoundingClientRect() ?? { top: 0, height: window.innerHeight };
      const atEnd = !!scroller && scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
      const line = box.top + Math.min(160, box.height / 5);
      let id: string | null = null;
      for (const sec of root.querySelectorAll<HTMLElement>('section.st-group:not([hidden])')) if (atEnd || sec.getBoundingClientRect().top <= line) id = sec.dataset.section!;
      if (Date.now() < chosen.current.until) return; // a click in the navigation wins while its smooth scroll runs
      setCurrent(id ?? order[0] ?? 'profile');
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(read); };
    read();
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => { document.removeEventListener('scroll', onScroll, { capture: true }); if (frame) cancelAnimationFrame(frame); };
  }, [searching, order.join(',')]);

  if (!settings) return null;
  const jump = (id: string) => { setCurrent(id); chosen.current.until = Date.now() + 900; const target = document.getElementById(`st-section-${id}`); target?.scrollIntoView({ block: 'start', behavior: 'smooth' }); target?.focus({ preventScroll: true }); };
  const byId = new Map(groups.map(g => [g.id, g]));
  return <div className="st-page st-essential st-shell" data-testid="settings-page">
    <aside className="st-side">
      <div role="search" className="st-search">
        <label htmlFor="settings-search" className="sr-only">{t('essential.search')}</label>
        <div className="st-search-line">
          <span className="st-search-icon" aria-hidden="true"><IconSearch /></span>
          <input id="settings-search" type="search" value={query} placeholder={t('stx.searchHint')} className="st-input" data-testid="st-search" aria-controls="settings-results"
            onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setQuery(''); } }} />
          {query && <button type="button" className="st-search-clear" aria-label={t('essential.clear')} data-testid="st-search-clear" onClick={() => { setQuery(''); document.getElementById('settings-search')?.focus(); }}><IconX size={12} /></button>}
        </div>
      </div>
      <nav className="st-nav" aria-label={t('essential.sections')} ref={nav}>
        {nav2.map(g => <div className="st-nav-group" key={g.label}>
          <span className="st-nav-label">{t(`stx.nav.${g.label}`)}</span>
          {g.ids.map(id => { const group = byId.get(id)!, on = shown(id); return <button type="button" key={id} className="st-nav-item" data-testid={`st-nav-${id}`} data-tone={SETTINGS_TONE[id] ?? 'slate'}
            aria-current={!searching && current === id ? 'true' : undefined} disabled={searching && !on} onClick={() => jump(id)}>
            <span className="st-nav-icon" aria-hidden="true">{group.icon}</span><span className="st-nav-text">{group.title}</span>
            {searching && on && (bodyHits[id] ?? 0) > 0 && <span className="st-nav-count" aria-label={t('stx.rows', { n: bodyHits[id]! })}>{bodyHits[id]}</span>}
          </button>; })}
        </div>)}
      </nav>
    </aside>
    <div className="st-main">
      <header className="st-hero">
        <div className="st-hero-text"><h1>{t('essential.title')}</h1><p>{searching ? t('stx.results', { n: visible.length }) : t('stx.lead')}</p></div>
        <SavedPill />
      </header>
      {searching && !visible.length && <p role="status" className="st-empty" data-testid="st-search-empty">{t('essential.empty')}</p>}
      <div id="settings-results" className="st-results" ref={results}>{sorted.map(group => <section className="st-group" key={group.id} data-section={group.id} data-tone={SETTINGS_TONE[group.id] ?? 'slate'} hidden={!shown(group.id)} aria-labelledby={`st-section-${group.id}`} data-testid={`st-group-${group.id}`}>
        <header className="st-group-head"><span className="st-group-icon" aria-hidden="true">{group.icon}</span><div><h2 id={`st-section-${group.id}`} tabIndex={-1}>{group.title}</h2><p>{group.description}</p></div></header>
        <div className="st-card">{group.body}</div>
      </section>)}</div>
    </div>
  </div>;
}
