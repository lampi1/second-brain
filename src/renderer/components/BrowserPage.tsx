// The Browser page (ADR 0133): the user's own everyday browser, apart from the agents' ones. A tab strip, a toolbar
// (back, forward, reload, the address bar with suggestions from bookmarks and history, the bookmark star, the key for
// this site's passwords, the side panel), a bookmarks bar and the page itself: a native view main draws above the
// placeholder this page reports (lib/viewports.ts, the same reporter as the agent tiles). A new tab, or no tab, shows
// the start page (search, bookmarks, saved sessions, «Riapri le schede di prima»). The side panel holds Preferiti,
// Sessioni, Cronologia and Password (fill, save, copy, import from Google Password Manager's CSV). Opened from the left
// rail (App group), Ctrl+K or G W; rendered by App.tsx PageFrame. State: store/personal.ts.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { PersonalBookmark, PersonalState, PersonalTab } from '@shared/contract';
import { t, locale } from '../i18n';
import { registerOverlay, registerView } from '../lib/viewports';
import { sameList } from '../store/state';
import {
  addBookmark, clearHistory, closeTab, lendTab, reclaimTab, copyLogin, fillLogin, go, goTab, importLogins, openSession, openTab, removeBookmark, removeLogin, removeSession, restoreTabs, saveLogin, saveSession, selectTab, usePersonal,
} from '../store/personal';
import { IconArrowLeft, IconArrowRight, IconBook, IconCopy, IconGlobe, IconHistory, IconKey, IconLayers, IconPanel, IconPlus, IconRefresh, IconSearch, IconShield, IconSparkle, IconSpinner, IconStar, IconTrash, IconUser, IconX } from './Icons';
import { IconButton } from './ui';
import { askConfirm } from '../store/ui';
import { useApp } from '../store/store';
import { focusChat } from '../actions';
import '../styles/personal-browser.css';

type Panel = 'bookmarks' | 'sessions' | 'history' | 'logins';

const hostOf = (url: string): string => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
const siteOf = (url: string): string | null => {
  try { const u = new URL(url); return u.protocol === 'https:' || u.protocol === 'http:' ? `${u.protocol}//${u.hostname.replace(/^www\./, '')}${u.port ? `:${u.port}` : ''}` : null; } catch { return null; }
};
/** A stable hue per host: the letter tiles of bookmarks and tabs. */
const hue = (s: string): number => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

function Monogram({ url, size = 28 }: { url: string; size?: number }) {
  const host = hostOf(url);
  return <span className="pb-mono" style={{ width: size, height: size, fontSize: Math.round(size * 0.46), ['--h' as string]: hue(host) }} aria-hidden="true">{(host[0] ?? '?').toUpperCase()}</span>;
}

function useLocal<T extends string>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => { try { return (localStorage.getItem(key) as T | null) ?? initial; } catch { return initial; } });
  return [v, (x: T) => { setV(x); try { localStorage.setItem(key, x); } catch { /* storage off */ } }];
}

export function BrowserPage() {
  const ready = usePersonal(s => s !== null);
  const tabs = usePersonal(s => s?.tabs ?? [], sameTabs);
  const active = tabs.find(x => x.active) ?? null;
  const [panel, setPanel] = useLocal<Panel | ''>('sb.pbrowser.panel', '');
  const [lending, setLending] = useState(false);
  // main withholds app_screenshot while this page is on screen: the agents never see the user's browsing
  useEffect(() => {
    try { void window.sb.invoke('personal:onScreen', { on: true }).catch(() => {}); } catch { /* no bridge */ }
    return () => { try { void window.sb.invoke('personal:onScreen', { on: false }).catch(() => {}); } catch { /* no bridge */ } };
  }, []);
  useEffect(() => { if (!active?.url || active.lentTo) setLending(false); }, [active?.id, active?.url, active?.lentTo]);
  if (!ready) return <div className="pb pb-loading" data-testid="personal-browser"><IconSpinner size={18} /></div>;
  return (
    <div className="pb" data-testid="personal-browser">
      <TabStrip tabs={tabs} />
      <Toolbar tab={active} panel={panel} setPanel={setPanel} lending={lending} setLending={setLending} />
      {lending && active && <LendBar tab={active} onDone={() => setLending(false)} />}
      <BookmarksBar tab={active} />
      <div className="pb-body">
        <div className="pb-stage">
          {active?.lentTo ? <LentView tab={active} /> : active && active.url ? <PageView tab={active} key={active.id} /> : <StartPage tabId={active?.id ?? null} />}
        </div>
        {panel && <SidePanel panel={panel} setPanel={setPanel} tab={active} />}
      </div>
    </div>
  );
}

function sameTabs(a: PersonalTab[], b: PersonalTab[]): boolean {
  return a.length === b.length && a.every((x, i) => { const y = b[i]!; return x.id === y.id && x.url === y.url && x.title === y.title && x.loading === y.loading && x.active === y.active && x.canBack === y.canBack && x.canForward === y.canForward && x.login === y.login && x.lentTo === y.lentTo; });
}

// ---------- tabs ----------

function TabStrip({ tabs }: { tabs: PersonalTab[] }) {
  return (
    <div className="pb-tabs" role="tablist" aria-label={t('pbrowser.tabs')} data-testid="pb-tabs">
      {tabs.map(tab => (
        <div key={tab.id} className={`pb-tab ${tab.active ? 'on' : ''} ${tab.lentTo ? 'lent' : ''}`} role="tab" aria-selected={tab.active} data-testid={`pb-tab-${tab.id}`}
          onMouseDown={e => { if (e.button === 1) { e.preventDefault(); closeTab(tab.id); } }}>
          <button type="button" className="pb-tab-main" onClick={() => selectTab(tab.id)} title={tab.url || t('pbrowser.untitled')}>
            {tab.lentTo ? <span className="pb-lent-mark" aria-label={t('pbrowser.lentMark')}><IconSparkle size={12} /></span> : tab.loading ? <IconSpinner size={13} /> : tab.url ? <Monogram url={tab.url} size={16} /> : <IconGlobe size={14} />}
            <span className="pb-tab-title">{tab.title || (tab.url ? hostOf(tab.url) : t('pbrowser.untitled'))}</span>
          </button>
          <button type="button" className="pb-tab-x" onClick={() => closeTab(tab.id)} aria-label={t('pbrowser.closeTab')} data-testid={`pb-tab-close-${tab.id}`}><IconX size={12} /></button>
        </div>
      ))}
      <IconButton label={t('pbrowser.newTab')} shortcut="Ctrl+T" onClick={() => void openTab()} testid="pb-new-tab" className="pb-tab-new"><IconPlus size={14} /></IconButton>
      <span className="pb-private" data-tip={t('pbrowser.privateTip')} data-testid="pb-private"><IconShield size={12} /> {t('pbrowser.private')}</span>
    </div>
  );
}

// ---------- toolbar ----------

function Toolbar({ tab, panel, setPanel, lending, setLending }: { tab: PersonalTab | null; panel: Panel | ''; setPanel: (p: Panel | '') => void; lending: boolean; setLending: (v: boolean) => void }) {
  const bookmark = usePersonal(s => (tab?.url ? s?.bookmarks.find(b => b.url === tab.url) ?? null : null));
  const siteLogins = usePersonal(s => { const site = tab?.url ? siteOf(tab.url) : null; return site ? (s?.logins ?? []).filter(l => l.site === site).length : 0; });
  const web = !!tab?.url && /^https?:/i.test(tab.url) && !tab.lentTo;
  const own = !!tab && !tab.lentTo;
  return (
    <div className="pb-bar" data-testid="pb-bar">
      <IconButton label={t('pbrowser.back')} shortcut="Alt+←" disabled={!own || !tab?.canBack} onClick={() => tab && goTab(tab.id, 'back')} testid="pb-back"><IconArrowLeft size={15} /></IconButton>
      <IconButton label={t('pbrowser.forward')} shortcut="Alt+→" disabled={!own || !tab?.canForward} onClick={() => tab && goTab(tab.id, 'forward')} testid="pb-forward"><IconArrowRight size={15} /></IconButton>
      {tab?.loading && own
        ? <IconButton label={t('pbrowser.stop')} onClick={() => goTab(tab.id, 'stop')} testid="pb-stop"><IconX size={15} /></IconButton>
        : <IconButton label={t('pbrowser.reload')} shortcut="F5" disabled={!own || !tab?.url} onClick={() => tab && goTab(tab.id, 'reload')} testid="pb-reload"><IconRefresh size={15} /></IconButton>}
      <AddressBar tab={tab} />
      <IconButton label={bookmark ? t('pbrowser.unbookmark') : t('pbrowser.bookmark')} disabled={!web} className={bookmark ? 'pb-on' : ''} testid="pb-star"
        onClick={() => { if (!tab) return; if (bookmark) removeBookmark(bookmark.id); else addBookmark(tab.url, tab.title); }}>
        <IconStar size={15} filled={!!bookmark} />
      </IconButton>
      <IconButton label={t('pbrowser.keyButton')} disabled={!web} className={`${tab?.login ? 'pb-hint' : ''} ${panel === 'logins' ? 'pb-on' : ''}`} testid="pb-key" onClick={() => setPanel(panel === 'logins' ? '' : 'logins')}>
        <IconKey size={15} />{siteLogins > 0 && <span className="pb-count">{siteLogins}</span>}
      </IconButton>
      <IconButton label={t('pbrowser.lend')} disabled={!web} className={lending ? 'pb-on' : ''} testid="pb-lend" onClick={() => setLending(!lending)}><IconSparkle size={15} /></IconButton>
      <IconButton label={t('pbrowser.panel')} className={panel && panel !== 'logins' ? 'pb-on' : ''} testid="pb-panel" onClick={() => setPanel(panel && panel !== 'logins' ? '' : 'bookmarks')}><IconPanel size={15} /></IconButton>
    </div>
  );
}

interface Suggestion { url: string; title: string; kind: 'bookmark' | 'history' }

function suggest(s: PersonalState | null, q: string): Suggestion[] {
  const needle = q.trim().toLowerCase();
  if (!s || !needle) return [];
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  const add = (url: string, title: string, kind: Suggestion['kind']) => {
    if (seen.has(url) || out.length >= 7) return;
    if (!url.toLowerCase().includes(needle) && !title.toLowerCase().includes(needle)) return;
    seen.add(url); out.push({ url, title, kind });
  };
  for (const b of s.bookmarks) add(b.url, b.title, 'bookmark');
  for (const h of s.history) add(h.url, h.title, 'history');
  return out;
}

function AddressBar({ tab }: { tab: PersonalTab | null }) {
  const [text, setText] = useState(tab?.url ?? '');
  const [editing, setEditing] = useState(false);
  const [pick, setPick] = useState(-1);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const items = usePersonal(s => (editing ? suggest(s, text) : []), (a, b) => sameList(a.map(x => x.url), b.map(x => x.url)));
  useEffect(() => { if (!editing) setText(tab?.url ?? ''); }, [tab?.url, tab?.id, editing]);
  // the suggestions open over the page: the native view hides under them while they show
  useLayoutEffect(() => (items.length && list.current ? registerOverlay(list.current) : undefined), [items.length > 0]);
  const submit = (e?: FormEvent, value = text) => {
    e?.preventDefault();
    if (!value.trim()) return;
    go(tab?.id ?? null, value);
    setEditing(false);
    input.current?.blur();
  };
  return (
    <form className="pb-address" onSubmit={submit} role="search">
      <span className="pb-address-icon" aria-hidden="true">{tab?.url?.startsWith('https:') ? <IconShield size={13} /> : <IconSearch size={13} />}</span>
      <input ref={input} disabled={!!tab?.lentTo} value={editing ? text : tab?.url ?? ''} placeholder={t('pbrowser.address')} aria-label={t('pbrowser.address')} data-testid="pb-address" spellCheck={false}
        onFocus={e => { setEditing(true); setText(tab?.url ?? ''); setPick(-1); requestAnimationFrame(() => e.target.select()); }}
        onBlur={() => setTimeout(() => setEditing(false), 120)}
        onChange={e => { setText(e.target.value); setPick(-1); }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); setPick(p => Math.min(items.length - 1, p + 1)); }
          else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); setPick(p => Math.max(-1, p - 1)); }
          else if (e.key === 'Enter' && pick >= 0 && items[pick]) { e.preventDefault(); submit(undefined, items[pick]!.url); }
          else if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); e.currentTarget.blur(); }
        }} />
      {items.length > 0 && (
        <div className="pb-suggest" ref={list} role="listbox" data-testid="pb-suggest">
          {items.map((it, i) => (
            <button key={it.url} type="button" role="option" aria-selected={i === pick} className={`pb-suggest-row ${i === pick ? 'on' : ''}`} onMouseDown={e => { e.preventDefault(); submit(undefined, it.url); }}>
              {it.kind === 'bookmark' ? <IconStar size={13} filled /> : <IconHistory size={13} />}
              <span className="pb-suggest-title">{it.title}</span>
              <span className="pb-suggest-url">{hostOf(it.url)}</span>
            </button>
          ))}
        </div>
      )}
    </form>
  );
}

function BookmarksBar({ tab }: { tab: PersonalTab | null }) {
  const marks = usePersonal(s => s?.bookmarks ?? [], (a, b) => sameList(a.map(x => x.id + x.title), b.map(x => x.id + x.title)));
  if (!marks.length) return null;
  return (
    <div className="pb-marks" data-testid="pb-marks">
      {marks.slice(0, 24).map(b => (
        <button key={b.id} type="button" className="pb-mark" title={b.url} onClick={e => (e.ctrlKey || e.metaKey ? void openTab(b.url) : go(tab?.id ?? null, b.url))}
          onAuxClick={e => { if (e.button === 1) void openTab(b.url); }}>
          <Monogram url={b.url} size={16} /><span>{b.title}</span>
        </button>
      ))}
    </div>
  );
}

// ---------- the page ----------

function PageView({ tab }: { tab: PersonalTab }) {
  const holder = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => (holder.current ? registerView(tab.id, holder.current) : undefined), [tab.id]);
  return (
    <div className="pb-view" ref={holder} data-testid={`pb-view-${tab.id}`}>
      <div className="pb-view-under">{tab.loading ? <><IconSpinner size={16} /> {t('pbrowser.loading')}</> : <><b>{tab.title}</b><span>{tab.url}</span></>}</div>
    </div>
  );
}

/** «Affida a un agente»: pick a chat, say what it should do; the tab goes to it until «Riprendi». */
function LendBar({ tab, onDone }: { tab: PersonalTab; onDone: () => void }) {
  const chats = useApp(s => s.order.flatMap(id => { const c = s.chats[id]; return c && !c.closedAt && !c.quick ? [{ id: c.id, title: c.isOrchestrator ? 'Orchestrator' : c.title || t('pbrowser.untitled') }] : []; }), (a, b) => sameList(a.map(x => x.id + x.title), b.map(x => x.id + x.title)));
  const [pick, setPick] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const chosen = pick && chats.some(c => c.id === pick) ? pick : null;
  return (
    <div className="pb-lendbar" data-testid="pb-lendbar">
      <div className="pb-lend-head"><IconSparkle size={14} /><b>{t('pbrowser.lendTitle')}</b><span>{t('pbrowser.lendLead')}</span></div>
      {!chats.length ? <p className="pb-empty">{t('pbrowser.lendNoChats')}</p> : (
        <>
          <div className="pb-lend-chats" role="radiogroup" aria-label={t('pbrowser.lendPick')}>
            {chats.map(c => <button key={c.id} type="button" role="radio" aria-checked={chosen === c.id} className={`pb-chip ${chosen === c.id ? 'on' : ''}`} onClick={() => setPick(c.id)} data-testid={`pb-lend-chat-${c.id}`}>{c.title}</button>)}
          </div>
          <form className="pb-form" onSubmit={e => { e.preventDefault(); if (chosen) { lendTab(tab.id, chosen, note); onDone(); } }}>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder={t('pbrowser.lendNote')} aria-label={t('pbrowser.lendNote')} data-testid="pb-lend-note" maxLength={4000} />
            <button type="submit" className="btn btn-s btn-primary" disabled={!chosen} data-testid="pb-lend-go">{t('pbrowser.lendGo')}</button>
            <button type="button" className="btn btn-s btn-ghost" onClick={onDone}>{t('pbrowser.lendCancel')}</button>
          </form>
        </>
      )}
    </div>
  );
}

/** A lent tab: the page is under its agent's strip in the Grindhouse; here the way back. */
function LentView({ tab }: { tab: PersonalTab }) {
  const chat = useApp(s => (tab.lentTo ? s.chats[tab.lentTo] : undefined));
  const name = chat ? (chat.isOrchestrator ? 'Orchestrator' : chat.title) : t('pbrowser.anAgent');
  return (
    <div className="pb-start pb-lent" data-testid="pb-lent">
      <div className="pb-start-inner">
        <div className="pb-start-orb pb-lent-orb" aria-hidden="true"><IconSparkle size={28} /></div>
        <h1>{t('pbrowser.lentTitle', { name })}</h1>
        <p className="pb-start-lead">{t('pbrowser.lentLead')}</p>
        <div className="pb-lent-url"><Monogram url={tab.url} size={22} /><span>{tab.title || hostOf(tab.url)}</span><em>{hostOf(tab.url)}</em></div>
        <div className="pb-lent-actions">
          <button type="button" className="btn btn-primary btn-m" onClick={() => reclaimTab(tab.id)} data-testid="pb-reclaim">{t('pbrowser.reclaim')}</button>
          {chat && <button type="button" className="btn btn-m" onClick={() => focusChat(chat.id)} data-testid="pb-lent-chat">{t('pbrowser.goToChat')}</button>}
        </div>
      </div>
    </div>
  );
}

function StartPage({ tabId }: { tabId: string | null }) {
  const marks = usePersonal(s => s?.bookmarks ?? []);
  const sessions = usePersonal(s => s?.sessions ?? []);
  const last = usePersonal(s => s?.lastTabs ?? 0);
  const [q, setQ] = useState('');
  return (
    <div className="pb-start" data-testid="pb-start">
      <div className="pb-start-inner">
        <div className="pb-start-orb" aria-hidden="true"><IconGlobe size={30} /></div>
        <h1>{t('pbrowser.startTitle')}</h1>
        <p className="pb-start-lead">{t('pbrowser.startLead')}</p>
        <form className="pb-start-search" onSubmit={e => { e.preventDefault(); go(tabId, q); }}>
          <IconSearch size={16} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('pbrowser.address')} aria-label={t('pbrowser.address')} data-testid="pb-start-search" autoFocus spellCheck={false} />
        </form>
        {last > 0 && <button type="button" className="btn btn-s pb-restore" onClick={restoreTabs} data-testid="pb-restore"><IconHistory size={13} /> {t('pbrowser.restore', { n: last })}</button>}
        {marks.length > 0 && (
          <section className="pb-start-sec">
            <h2>{t('pbrowser.startBookmarks')}</h2>
            <div className="pb-grid">
              {marks.slice(0, 12).map(b => (
                <button key={b.id} type="button" className="pb-tile" onClick={() => go(tabId, b.url)} title={b.url} data-testid={`pb-tile-${b.id}`}>
                  <Monogram url={b.url} size={40} /><span className="pb-tile-title">{b.title}</span><span className="pb-tile-host">{hostOf(b.url)}</span>
                </button>
              ))}
            </div>
          </section>
        )}
        {sessions.length > 0 && (
          <section className="pb-start-sec">
            <h2>{t('pbrowser.startSessions')}</h2>
            <div className="pb-chips">
              {sessions.slice(0, 8).map(s => <button key={s.id} type="button" className="pb-chip" onClick={() => openSession(s.id)}><IconLayers size={13} /> {s.name} <em>{t('pbrowser.sessionTabs', { n: s.tabs.length })}</em></button>)}
            </div>
          </section>
        )}
        <p className="pb-start-note">{t('pbrowser.googleNote')}</p>
      </div>
    </div>
  );
}

// ---------- side panel ----------

function SidePanel({ panel, setPanel, tab }: { panel: Panel; setPanel: (p: Panel | '') => void; tab: PersonalTab | null }) {
  const tabsOf: { id: Panel; label: string; icon: ReactNode }[] = [
    { id: 'bookmarks', label: t('pbrowser.panel.bookmarks'), icon: <IconBook size={13} /> },
    { id: 'sessions', label: t('pbrowser.panel.sessions'), icon: <IconLayers size={13} /> },
    { id: 'history', label: t('pbrowser.panel.history'), icon: <IconHistory size={13} /> },
    { id: 'logins', label: t('pbrowser.panel.logins'), icon: <IconKey size={13} /> },
  ];
  return (
    <aside className="pb-side" data-testid="pb-side" aria-label={t('pbrowser.panel')}>
      <div className="pb-side-tabs" role="tablist">
        {tabsOf.map(x => <button key={x.id} type="button" role="tab" aria-selected={panel === x.id} className={panel === x.id ? 'on' : ''} onClick={() => setPanel(x.id)} data-testid={`pb-side-${x.id}`}
          aria-label={x.label} data-tip={panel === x.id ? undefined : x.label}>{x.icon}{panel === x.id && <span>{x.label}</span>}</button>)}
        <span className="sp" />
        <IconButton label={t('pbrowser.closePanel')} onClick={() => setPanel('')} testid="pb-side-close"><IconX size={13} /></IconButton>
      </div>
      <div className="pb-side-body">
        {panel === 'bookmarks' ? <Bookmarks tab={tab} /> : panel === 'sessions' ? <Sessions /> : panel === 'history' ? <History tab={tab} /> : <Logins tab={tab} />}
      </div>
    </aside>
  );
}

function Row({ url, title, sub, onOpen, actions, testid }: { url: string; title: string; sub: string; onOpen: () => void; actions?: ReactNode; testid?: string }) {
  return (
    <div className="pb-row" data-testid={testid}>
      <button type="button" className="pb-row-main" onClick={onOpen} title={url}><Monogram url={url} size={24} /><span className="pb-row-text"><b>{title}</b><span>{sub}</span></span></button>
      {actions && <span className="pb-row-actions">{actions}</span>}
    </div>
  );
}

function Bookmarks({ tab }: { tab: PersonalTab | null }) {
  const marks = usePersonal(s => s?.bookmarks ?? []);
  if (!marks.length) return <p className="pb-empty">{t('pbrowser.noBookmarks')}</p>;
  return <>{marks.map((b: PersonalBookmark) => <Row key={b.id} url={b.url} title={b.title} sub={hostOf(b.url)} onOpen={() => go(tab?.id ?? null, b.url)} testid={`pb-bookmark-${b.id}`}
    actions={<IconButton label={t('pbrowser.remove')} onClick={() => removeBookmark(b.id)} tone="danger"><IconTrash size={13} /></IconButton>} />)}</>;
}

function Sessions() {
  const sessions = usePersonal(s => s?.sessions ?? []);
  const open = usePersonal(s => (s?.tabs ?? []).filter(x => /^https?:/i.test(x.url)).length);
  const [name, setName] = useState('');
  return (
    <>
      <form className="pb-form" onSubmit={e => { e.preventDefault(); if (name.trim() && open) { saveSession(name); setName(''); } }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder={t('pbrowser.sessionName')} aria-label={t('pbrowser.sessionName')} data-testid="pb-session-name" maxLength={80} />
        <button type="submit" className="btn btn-s btn-primary" disabled={!name.trim() || !open} data-testid="pb-session-save">{t('pbrowser.sessionSave')}</button>
      </form>
      {!open && <p className="pb-empty">{t('pbrowser.noOpenTabs')}</p>}
      {!sessions.length ? <p className="pb-empty">{t('pbrowser.noSessions')}</p> : sessions.map(s => (
        <div key={s.id} className="pb-session" data-testid={`pb-session-${s.id}`}>
          <div className="pb-session-head"><b>{s.name}</b><span>{t('pbrowser.sessionTabs', { n: s.tabs.length })} · {new Date(s.at).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })}</span></div>
          <div className="pb-session-hosts">{s.tabs.slice(0, 6).map((x, i) => <Monogram key={i} url={x.url} size={18} />)}{s.tabs.length > 6 && <em>+{s.tabs.length - 6}</em>}</div>
          <div className="pb-session-actions">
            <button type="button" className="btn btn-s" onClick={() => openSession(s.id)}>{t('pbrowser.sessionOpen')}</button>
            <IconButton label={t('pbrowser.remove')} onClick={() => removeSession(s.id)} tone="danger"><IconTrash size={13} /></IconButton>
          </div>
        </div>
      ))}
    </>
  );
}

function History({ tab }: { tab: PersonalTab | null }) {
  const history = usePersonal(s => s?.history ?? []);
  const [q, setQ] = useState('');
  const shown = useMemo(() => { const n = q.trim().toLowerCase(); return (n ? history.filter(h => h.url.toLowerCase().includes(n) || h.title.toLowerCase().includes(n)) : history).slice(0, 150); }, [history, q]);
  return (
    <>
      <div className="pb-form">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('pbrowser.historyFilter')} aria-label={t('pbrowser.historyFilter')} />
        <button type="button" className="btn btn-s" disabled={!history.length} onClick={() => askConfirm({ title: t('pbrowser.historyClear'), body: t('pbrowser.historyClearBody'), confirmLabel: t('pbrowser.historyClear'), danger: true, onConfirm: clearHistory })} data-testid="pb-history-clear">{t('pbrowser.historyClear')}</button>
      </div>
      {!shown.length ? <p className="pb-empty">{t('pbrowser.noHistory')}</p> : shown.map((h, i) => (
        <Row key={`${h.url}-${i}`} url={h.url} title={h.title} sub={`${hostOf(h.url)} · ${new Date(h.at).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`} onOpen={() => go(tab?.id ?? null, h.url)} />
      ))}
    </>
  );
}

function Logins({ tab }: { tab: PersonalTab | null }) {
  const logins = usePersonal(s => s?.logins ?? []);
  const vault = usePersonal(s => s?.vault ?? null);
  const [q, setQ] = useState('');
  const site = tab?.url ? siteOf(tab.url) : null;
  const here = site ? logins.filter(l => l.site === site) : [];
  const shown = useMemo(() => { const n = q.trim().toLowerCase(); return (n ? logins.filter(l => l.site.toLowerCase().includes(n) || l.user.toLowerCase().includes(n)) : logins).slice(0, 300); }, [logins, q]);
  const copy = (id: string) => <>
    <IconButton label={t('pbrowser.copyUser')} onClick={() => copyLogin(id, 'user')}><IconUser size={13} /></IconButton>
    <IconButton label={t('pbrowser.copyPassword')} onClick={() => copyLogin(id, 'password')}><IconCopy size={13} /></IconButton>
  </>;
  return (
    <>
      <p className="pb-lead">{vault ? t('pbrowser.vaultOff', { why: vault }) : t('pbrowser.loginsLead')}</p>
      {site && tab && !vault && (
        <section className="pb-here" data-testid="pb-login-here">
          <h3>{t('pbrowser.forSite')} <span>{hostOf(site)}</span></h3>
          {here.map(l => (
            <div key={l.id} className="pb-login">
              <button type="button" className="btn btn-s btn-primary" onClick={() => fillLogin(tab.id, l.id)} data-testid={`pb-fill-${l.id}`}>{t('pbrowser.fill')}</button>
              <span className="pb-login-user">{l.user || t('pbrowser.noUser')}</span>
              {copy(l.id)}
            </div>
          ))}
          <button type="button" className="btn btn-s" onClick={() => saveLogin(tab.id)} data-testid="pb-login-save"><IconKey size={13} /> {t('pbrowser.saveLogin')}</button>
          <p className="pb-hint-text">{t('pbrowser.saveLoginHelp')}</p>
        </section>
      )}
      {!vault && (
        <div className="pb-import">
          <button type="button" className="btn btn-s" onClick={importLogins} data-testid="pb-login-import">{t('pbrowser.import')}</button>
          <p className="pb-hint-text">{t('pbrowser.importHelp')}</p>
        </div>
      )}
      {logins.length > 8 && <div className="pb-form"><input value={q} onChange={e => setQ(e.target.value)} placeholder={t('pbrowser.loginsFilter')} aria-label={t('pbrowser.loginsFilter')} /></div>}
      {!logins.length ? <p className="pb-empty">{t('pbrowser.noLogins')}</p> : shown.map(l => (
        <Row key={l.id} url={l.site} title={hostOf(l.site)} sub={l.user || t('pbrowser.noUser')} onOpen={() => go(tab?.id ?? null, l.site)} testid={`pb-login-${l.id}`}
          actions={<>{copy(l.id)}<IconButton label={t('pbrowser.remove')} onClick={() => askConfirm({ title: t('pbrowser.removeLoginTitle'), body: t('pbrowser.removeLoginBody', { site: hostOf(l.site), user: l.user || t('pbrowser.noUser') }), confirmLabel: t('pbrowser.remove'), danger: true, onConfirm: () => removeLogin(l.id) })} tone="danger"><IconTrash size={13} /></IconButton></>} />
      ))}
    </>
  );
}
