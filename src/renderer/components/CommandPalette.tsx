// Ctrl+K: go anywhere and one search over everything (recent places, chats by title, folder and last line; open
// requests; the closed chats (a pick reopens it); browser tabs; every brain section and the map; feed events) and every app action with its shortcut (the
// engine of each chat in its line; "Credenziali" opens the credentials panel; the Orchestrator: ricomincia da capo, passa all'altro motore, Domande all'Orchestrator). A
// pasted internal link (sb://<page>/<element>) is the first result. Fuzzy filter (lib/fuzzy.ts), ↑↓ + Enter, Esc
// closes. While it is open the browser views are hidden (a modal blocks them all). From two letters on, a full-text
// search in main ('search:query', ADR 0023) adds the messages of the chats of the last 30 days (closed ones too: Enter
// reopens), the chats' git branches and the brain's markdown files, grouped by kind with snippet and date, after the
// quick matches above. Used by App.tsx.
import { t as auditText } from '../i18n';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SearchHit, SearchIndexStatus, SearchResult } from '@shared/contract';
import { sb } from '../sb';
import { locale, t, type TextKey } from '../i18n';
import { chatName } from '@shared/orchestrator';
import { fuzzyScore } from '../lib/fuzzy';
import { closedTime, folderName, sameDay, stateInfo } from '../lib/format';
import { engineName, otherEngine } from '../lib/engines';
import { app } from '../store/store';
import { BRAIN_PAGES, closeModal, openModal, pageLabel, placeLabel, setMaximized, setPrefs, setOrchestratorOpen, ui, type BrainPageId } from '../store/ui';
import { linkOfEvent, parseLink } from '../lib/notify';
import { closedChats } from '../lib/autoclose';
import { now } from '../lib/clock';
import {
  back, copyLink, currentLink, focusChat, reopenChat, focusRequest, focusTile, forward, go, nextThing, openLink, recentPlaces, stopAllAsk, stopFocused, toggleCenter, toggleFocusMode,
  toggleMaximize, toggleOrchestrator, askRenewOrchestrator, askClearOrchestrator, orchestratorId, toggleQuestionsModal, newBrowser, newRequest,
} from '../actions';
import { questionsModalOn } from '../lib/questions';
import {
  HarnessMark, IconArrowLeft, IconArrowRight, IconBell, IconBolt, IconBook, IconBranch, IconFile, IconBrain, IconChart, IconTarget, IconCoins, IconShield, IconFocus, IconGlobe,
  IconHistory, IconKeyboard, IconLayers, IconLightbulb, IconLink, IconList, IconLogin, IconMap, IconMaximize, IconPlus, IconQuestion, IconSearch, IconSettings, IconStop,
  IconSparkle, IconTerminal, IconTicket,
} from './Icons';
import { Keys, Modal } from './ui';
import { ContextPulse } from './ContextPulse';

interface Cmd {
  id: string; group: string; title: string; sub?: string; shortcut?: string; icon: ReactNode; run: () => void; text?: string;
  /** a full-text hit: its excerpt (match marked) and date, shown under a group header */
  snippet?: { text: string; mark: [number, number] | null }; date?: string; found?: boolean;
}

const PAGE_ICON: Record<BrainPageId, ReactNode> = {
  home: <IconBrain />,
  agenti: <IconLayers />,
  fatto: <IconBook />, idee: <IconLightbulb />,
  costi: <IconCoins />, qualita: <IconChart />, apprendimento: <IconTarget />, script: <IconTerminal />, log: <IconList />, confronto: <IconLayers />, file: <IconBrain />, task: <IconTicket />, skill: <IconSparkle />, impostazioni: <IconSettings />,
  dashboard: <IconChart />, guida: <IconQuestion />,
  regole: <IconShield />, memoria: <IconHistory />, classificatori: <IconBranch />, collegamenti: <IconMap />,
};

function buildCommands(): Cmd[] {
  const s = app.get();
  const u = ui.get();
  const out: Cmd[] = [];
  for (const r of s.pending) {
    const c = s.chats[r.chatId];
    out.push({ id: `req:${r.chatId}/${r.id}`, group: 'Ti aspettano', title: auditText('cmp.palette.answer', { title: r.title }), sub: c && chatName(c), icon: <IconQuestion />, run: () => focusRequest(r) });
  }
  for (const id of s.order) {
    const c = s.chats[id];
    if (!c || c.quick || u.hidden.includes(id) || c.closedAt) continue; // Lampo lives in its own tab, never in the list
    const st = stateInfo(c);
    out.push({
      id: `chat:${id}`, group: 'Chat', title: chatName(c), sub: `${engineName(c.harness)} · ${st.label} · ${folderName(c.cwd)}${c.lastText ? ` · ${c.lastText}` : ''}`,
      icon: <HarnessMark harness={c.harness} orchestrator={c.isOrchestrator} size={18} />, run: () => focusChat(id), text: `${c.title} ${engineName(c.harness)} ${c.cwd} ${c.lastText}`,
    });
  }
  for (const c of closedChats(s.chats).filter(c => !c.quick)) {
    out.push({
      id: `closed:${c.id}`, group: 'Chiuse', title: c.title, sub: `${auditText('cmp.palette.closedAt', { when: closedTime(c.closedAt!, now()) })}${c.lastText ? ` · ${c.lastText}` : ''}`,
      icon: <HarnessMark harness={c.harness} size={18} />, run: () => { void reopenChat(c.id); }, text: `${c.title} ${c.cwd} ${c.lastText} chiusa riapri`,
    });
  }
  for (const t of s.tabs) {
    if (u.hiddenTabs.includes(t.id)) continue;
    const owner = t.ownerChatId ? s.chats[t.ownerChatId]?.title : null;
    out.push({
      id: `tab:${t.id}`, group: 'Browser', title: t.title || t.url, sub: owner ? `${auditText('cmp.palette.drivenBy', { owner })} · ${t.url}` : t.url, icon: <IconGlobe />, text: `${t.title} ${t.url} ${owner ?? ''}`,
      run: () => setMaximized(`browser:${t.id}`),
    });
  }
  // the Orchestrator of the tab shown in the overlay (ADR 0021)
  const rid = orchestratorId();
  const orchestrator = rid ? s.chats[rid] : undefined;
  const to = orchestrator && otherEngine(orchestrator.harness);
  const actions: Omit<Cmd, 'group'>[] = [
    { id: 'stato', title: auditText('cmp.palette.status'), sub: auditText('cmp.palette.statusSub'), shortcut: 'Ctrl+Shift+S', icon: <IconList />, run: () => openModal('stato'), text: 'stato come siamo messi a che punto siamo pr' },
    { id: 'next', title: auditText('cmp.palette.next'), shortcut: 'Ctrl+J', icon: <IconBolt />, run: () => nextThing() },
    { id: 'new', title: auditText('cmp.palette.newChat'), shortcut: 'Ctrl+N', icon: <IconPlus />, run: () => newRequest() },
    { id: 'new-browser', title: t('ui.newBrowser'), sub: t('ui.browserMine'), icon: <IconGlobe />, run: () => { void newBrowser(); }, text: 'browser tab scheda web' },
    { id: 'stopall', title: auditText('cmp.palette.stopAll'), shortcut: 'Ctrl+Shift+.', icon: <IconStop />, run: stopAllAsk },
    { id: 'stop', title: auditText('cmp.palette.stop'), shortcut: 'Ctrl+.', icon: <IconStop />, run: stopFocused },
    { id: 'focus', title: u.focusMode ? auditText('cmp.palette.focusExit') : auditText('cmp.palette.focusEnter'), shortcut: 'Ctrl+Shift+F', icon: <IconFocus />, run: toggleFocusMode },
    { id: 'max', title: auditText('cmp.palette.maximize'), shortcut: 'F11', icon: <IconMaximize />, run: () => toggleMaximize() },
    { id: 'orchestrator', title: auditText('cmp.palette.goOrchestrator'), sub: orchestrator ? auditText('cmp.palette.onEngine', { engine: engineName(orchestrator.harness) }) : undefined, shortcut: 'Ctrl+0', icon: <HarnessMark harness="claude" orchestrator size={18} />, run: () => focusTile(0) },
    ...(orchestrator ? [
      { id: 'orchestratorclear', title: auditText('cmp.palette.orchestratorClear', { title: orchestrator.title }), sub: auditText('cmp.palette.orchestratorClearSub'), icon: <HarnessMark harness={orchestrator.harness} orchestrator size={18} />, run: () => askClearOrchestrator(orchestrator.id), text: 'pulisci clear azzera orchestrator orchestrator' },
      { id: 'orchestratorrenew', title: auditText('cmp.palette.orchestratorRenew'), sub: auditText('cmp.palette.orchestratorRenewSub', { engine: engineName(orchestrator.harness) }), shortcut: 'Ctrl+Shift+R', icon: <HarnessMark harness={orchestrator.harness} size={18} />, run: () => askRenewOrchestrator(orchestrator.harness) },
      ...(to ? [{ id: 'orchestratorengine', title: auditText('cmp.palette.orchestratorEngine', { engine: engineName(to) }), sub: auditText('cmp.palette.orchestratorEngineSub', { engine: engineName(orchestrator.harness) }), icon: <HarnessMark harness={to} size={18} />, run: () => askRenewOrchestrator(to) }] : []),
    ] : []),
    { id: 'qwin', title: questionsModalOn(s) ? auditText('cmp.palette.questionsOff') : auditText('cmp.palette.questionsOn'),
      sub: questionsModalOn(s) ? auditText('cmp.palette.questionsOffSub') : auditText('cmp.palette.questionsOnSub'),
      icon: <IconQuestion />, run: toggleQuestionsModal, text: 'domande finestra modale popup permessi' },
    { id: 'density', title: u.prefs.density === 'compact' ? auditText('cmp.palette.densityComfortable') : auditText('cmp.palette.densityCompact'), icon: <IconLayers />, run: () => setPrefs({ density: u.prefs.density === 'compact' ? 'comfortable' : 'compact' }) },
    { id: 'theme', title: auditText('cmp.palette.theme'), sub: auditText(u.prefs.theme === 'system' ? 'cmp.palette.themeNowSystem' : u.prefs.theme === 'dark' ? 'cmp.palette.themeNowDark' : 'cmp.palette.themeNowLight'), icon: <IconSettings />,
      run: () => setPrefs({ theme: u.prefs.theme === 'system' ? 'dark' : u.prefs.theme === 'dark' ? 'light' : 'system' }) },
    { id: 'credentials', title: auditText('cmp.palette.credentials'), sub: auditText('cmp.palette.credentialsSub'), icon: <IconLogin />, run: () => openModal('credentials'),
      text: 'credenziali password utente login account ambienti test url pms' },
    { id: 'keys', title: auditText('cmp.palette.shortcuts'), shortcut: 'Ctrl+/', icon: <IconKeyboard />, run: () => openModal('shortcuts') },
    { id: 'center', title: auditText('cmp.palette.notifications'), shortcut: 'Ctrl+Shift+N', icon: <IconBell />, run: toggleCenter },
    { id: 'orchestratordock', title: auditText('cmp.palette.orchestratorDock'), shortcut: 'Ctrl+R', icon: <HarnessMark harness="claude" orchestrator size={18} />, run: toggleOrchestrator },
    { id: 'orchestratorplace', title: auditText('cmp.palette.orchestratorPlace'), sub: auditText('cmp.palette.orchestratorPlaceSub'), icon: <HarnessMark harness="claude" orchestrator size={18} />, run: () => { setPrefs({ orchestratorSize: null }); setOrchestratorOpen(true); }, text: 'misura dimensione reset orchestrator orchestrator' },
    { id: 'back', title: auditText('cmp.palette.back'), shortcut: 'Alt+←', icon: <IconArrowLeft />, run: back },
    { id: 'forward', title: auditText('cmp.palette.forward'), shortcut: 'Alt+→', icon: <IconArrowRight />, run: forward },
    { id: 'copylink', title: auditText('cmp.palette.copyLink'), sub: currentLink(), icon: <IconLink />, run: () => { void copyLink(); } },
  ];
  for (const a of actions) out.push({ ...a, group: 'Azioni' });
  // the Grindhouse holds the agents (SPEC 19): Ctrl+1 and a search for "agenti" or "chat" land there
  for (const p of BRAIN_PAGES) out.push({ id: `page:${p.id}`, group: 'Vai a', title: p.label, shortcut: p.id === 'home' ? 'Ctrl+1' : p.key, icon: PAGE_ICON[p.id], run: () => go({ page: p.id }),
    ...(p.id === 'home' ? { sub: t('home.workspace'), text: `${p.label} ${t('home.agents')} chat agents home` } : p.id === 'guida' ? { sub: t('guide.title'), text: `${p.label} guida guide aiuto help concetti concepts come funziona how it works` } : {}) });
  out.push({ id: 'page:mappa', group: 'Vai a', title: auditText('cmp.palette.map'), sub: auditText('cmp.palette.mapSub'), shortcut: 'Ctrl+Shift+M', icon: <IconMap />, run: () => go({ page: 'mappa' }) });
  recentPlaces(6).forEach((p, i) => {
    if (i === 0) return; // where you are now
    out.push({ id: `recent:${i}`, group: 'Recenti', title: placeLabel(p), icon: <IconHistory />, run: () => go(p) });
  });
  for (const e of s.feed.slice(0, 60)) out.push({ id: `feed:${e.id}`, group: 'Novità', title: e.title, sub: `${e.label} · ${e.detail}`, icon: <IconLightbulb />, run: () => { openLink(linkOfEvent(e)); }, text: `${e.title} ${e.detail} ${e.label}` });
  return out;
}

const FOUND_GROUP: Record<SearchHit['kind'], string> = { chat: 'Chat trovate', message: 'Nei messaggi', branch: 'Branch', brain: 'Nel brain' };

/** The day of a hit: the time today, else the day (and year when not this one). */
export function hitDate(at: number, nowMs: number): string {
  if (!at) return '';
  const d = new Date(at);
  if (sameDay(at, nowMs)) return d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  const y = d.getFullYear() !== new Date(nowMs).getFullYear();
  return d.toLocaleDateString(locale(), { day: 'numeric', month: 'short', ...(y ? { year: 'numeric' } : {}) });
}

/** Full-text hits → palette rows: a chat already listed above comes back only for where its messages matched. */
function foundCommands(hits: SearchHit[], shown: Set<string>): Cmd[] {
  const s = app.get();
  const t = now();
  const openChat = (id: string | undefined) => {
    if (!id) return;
    const c = app.get().chats[id];
    if (c?.closedAt) void reopenChat(id); else focusChat(id);
  };
  const out: Cmd[] = [];
  for (const h of hits) {
    const listed = h.kind === 'chat' && !!h.chatId && (shown.has(`chat:${h.chatId}`) || shown.has(`closed:${h.chatId}`));
    if (listed && !h.snippet) continue;
    const c = h.chatId ? s.chats[h.chatId] : undefined;
    const closed = c ? !!c.closedAt : !!h.closed;
    const base = { id: `found:${h.key}`, group: FOUND_GROUP[listed ? 'message' : h.kind], date: hitDate(h.at, t), found: true, ...(h.snippet ? { snippet: { text: h.snippet, mark: h.mark } } : {}) };
    if (h.kind === 'brain') {
      out.push({ ...base, title: h.path ?? h.title, sub: h.line && h.line > 1 ? auditText('cmp.palette.line', { n: h.line }) : undefined, icon: <IconFile />, run: () => go({ page: 'esplora', arg: h.path ?? h.title }) });
    } else if (h.kind === 'branch') {
      out.push({ ...base, title: h.title, sub: h.sub, icon: <IconBranch />, run: () => openChat(h.chatId) });
    } else {
      const title = c ? chatName(c) : h.title;
      const more = h.count && h.count > 1 ? ` · ${auditText('cmp.palette.messages', { n: h.count })}` : '';
      out.push({
        ...base, title, sub: `${closed ? `${auditText('cmp.palette.closedReopen')} · ` : ''}${h.sub ?? ''}${more}`,
        icon: c ? <HarnessMark harness={c.harness} orchestrator={c.isOrchestrator} size={18} /> : <IconHistory />, run: () => openChat(h.chatId),
      });
    }
  }
  // one block per group (a listed chat joined "Nei messaggi"); sort is stable, so the rank inside a group stays
  const order = Object.values(FOUND_GROUP);
  return out.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
}

/** The full-text result for `q` (debounced; two letters at least; not for a pasted link). The last result stays until
 *  the next one arrives, so the list does not jump at every letter. */
function useFound(q: string): { result: SearchResult | null; busy: boolean } {
  const [result, setResult] = useState<SearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const text = q.trim().slice(0, 200);
    if (text.length < 2 || parseLink(q)) { setResult(null); setBusy(false); return; }
    let live = true;
    setBusy(true);
    const timer = setTimeout(() => {
      sb.invoke('search:query', { q: text })
        .then(r => { if (live) setResult(r); })
        .catch(() => { if (live) setResult(null); })
        .finally(() => { if (live) setBusy(false); });
    }, 140);
    return () => { live = false; clearTimeout(timer); };
  }, [q]);
  return { result, busy };
}

/** The brain search's model (hybrid search, SPEC 23): downloaded once in the background; while it is missing or failed
 *  the brain is searched by words only, and the footer says so with a retry. */
function useSearchModel(): SearchIndexStatus['model'] | null {
  const [model, setModel] = useState<SearchIndexStatus['model'] | null>(null);
  useEffect(() => {
    let live = true;
    sb.invoke('search:status', undefined).then(s => { if (live) setModel(s.model); }).catch(() => { /* no search service (demo) */ });
    const off = sb.on('search:status', s => setModel(s.model));
    return () => { live = false; off(); };
  }, []);
  return model;
}

function ModelNote({ model }: { model: SearchIndexStatus['model'] | null }) {
  if (model?.state === 'downloading') {
    return <span className="palette-model" data-testid="palette-model">{t('tools.search.modelDownloading', { pct: Math.floor((model.done / Math.max(1, model.total)) * 100) })}</span>;
  }
  if (model?.state === 'failed') {
    return <span className="palette-model" data-testid="palette-model" title={model.error}>{t('tools.search.wordsOnly')}
      <button type="button" className="palette-retry" onClick={() => { void sb.invoke('search:retryModel', undefined).catch(() => undefined); }}>{t('tools.search.retry')}</button></span>;
  }
  return null;
}

/** A group's name on screen: the group is an internal id (order, bonus), its label follows the language. */
const groupLabel = (group: string): string => auditText(`cmp.palette.group.${group}` as TextKey);

const GROUP_ORDER = ['Ti aspettano', 'Recenti', 'Chat', 'Chiuse', 'Vai a', 'Azioni', 'Browser'];
const GROUP_BONUS: Record<string, number> = { 'Ti aspettano': 260, Chat: 300, Chiuse: 240, 'Vai a': 220, Recenti: 120, Azioni: 160, Browser: 120, Novità: 0 };

export function CommandPalette() {
  const [q, setQ] = useState('');
  // the highlighted row by id: full-text results arriving reshape the list, the choice stays on its row
  const [activeId, setActiveId] = useState<string | null>(null);
  const all = useMemo(buildCommands, []);
  const found = useFound(q);
  const model = useSearchModel();
  const quick = useMemo(() => {
    const link = parseLink(q);
    if (link) return [{ id: 'link', group: 'Link', title: auditText('cmp.palette.goTo', { target: q.trim() }), sub: `${pageLabel(link.page)}${link.element ? ` · ${link.element}` : ''}`, icon: <IconLink />, run: () => { openLink(q); } } as Cmd];
    if (!q.trim()) {
      const g = all.filter(c => c.group !== 'Novità');
      return GROUP_ORDER.flatMap(name => g.filter(c => c.group === name));
    }
    // a match in the title beats one in the details; chats and requests come before actions, pages and the feed
    return all
      .map((c, i) => {
        const t = fuzzyScore(q, c.title);
        const full = fuzzyScore(q, `${c.title} ${c.text ?? c.sub ?? ''} ${c.group}`);
        const s = Math.max(t >= 0 ? t + 400 : -1, full);
        return { c, i, s: s < 0 ? -1 : s + (GROUP_BONUS[c.group] ?? 0) };
      })
      .filter(x => x.s >= 0)
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .slice(0, 40)
      .map(x => x.c);
  }, [all, q]);
  // the quick matches first (8 when the full text found something), then the full-text groups
  const list = useMemo(() => {
    if (!found.result?.hits.length) return quick;
    const top = quick.slice(0, 8);
    return [...top, ...foundCommands(found.result.hits, new Set(top.map(c => c.id)))];
  }, [quick, found.result]);
  const active = Math.max(0, activeId ? list.findIndex(c => c.id === activeId) : 0);
  const listRef = useRef<HTMLDivElement>(null);
  const run = (c: Cmd | undefined) => { if (!c) return; closeModal(); c.run(); };
  const move = (d: number) => {
    const n = (active + d + list.length) % Math.max(1, list.length);
    setActiveId(list[n]?.id ?? null);
    requestAnimationFrame(() => listRef.current?.querySelector(`[data-index="${n}"]`)?.scrollIntoView({ block: 'nearest' }));
  };
  let lastGroup = '';
  return (
    <Modal onClose={closeModal} label={auditText('audit.CommandPalette.searchAndCommands')} testid="palette" className="modal-palette" top>
      <div className="palette-search">
        <IconSearch size={16} />
        <input autoFocus value={q} placeholder={auditText('audit.CommandPalette.searchChatsBrowsersPagesCommands')} aria-label={auditText('audit.CommandPalette.search')} data-testid="palette-input" role="combobox" aria-expanded="true" aria-controls="palette-list"
          aria-activedescendant={list[active] ? `pal-${active}` : undefined}
          onChange={e => { setQ(e.target.value); setActiveId(null); }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
            if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
            if (e.key === 'Enter') { e.preventDefault(); run(list[active]); }
          }} />
        <Keys combo="Esc" />
      </div>
      <div className="palette-list" id="palette-list" role="listbox" ref={listRef} aria-label={auditText('audit.CommandPalette.results')}>
        {list.length === 0 && <div className="palette-empty">{found.busy ? auditText('auditExpression.CommandPalette.text28') : <>{auditText('audit.CommandPalette.noResultsFor')}{q}{auditText('audit.CommandPalette.tryTheNameOfAChat')}</>}</div>}
        {list.map((c, i) => {
          const header = (!q.trim() || c.found) && c.group !== lastGroup ? c.group : null;
          lastGroup = c.group;
          return (
            <div key={c.id}>
              {header && <div className="palette-group">{groupLabel(header)}</div>}
              <div id={`pal-${i}`} role="option" aria-selected={i === active} data-index={i} className={`palette-item ${i === active ? 'active' : ''}`} data-testid={`palette-item-${c.id}`}
                onMouseMove={() => setActiveId(c.id)} onClick={() => run(c)}>
                <span className="palette-icon">{c.icon}</span>
                {c.snippet ? (
                  <span className="palette-text found">
                    <span className="palette-line"><span className="palette-title">{c.title}</span>{c.sub && <span className="palette-sub">{c.sub}</span>}</span>
                    <span className="palette-snippet" data-testid="palette-snippet">{markText(c.snippet.text, c.snippet.mark)}</span>
                  </span>
                ) : <span className="palette-text"><span className="palette-title">{c.title}</span>{c.sub && <span className="palette-sub">{c.sub}</span>}</span>}
                {c.found ? c.date && <span className="palette-tag">{c.date}</span> : q.trim() && <span className="palette-tag">{groupLabel(c.group)}</span>}
                {c.shortcut && <Keys combo={c.shortcut} />}
              </div>
            </div>
          );
        })}
      </div>
      {!found.busy && (!q.trim() || list.length === 0) && <ContextPulse place="search" />}
      <div className="palette-foot"><span><Keys combo="↑ ↓" />{' '}{auditText('audit.CommandPalette.select')}</span><span><Keys combo="Invio" />{' '}{auditText('audit.CommandPalette.open')}</span><span><Keys combo="Esc" />{' '}{auditText('audit.CommandPalette.close')}</span>
        {found.busy && list.length > 0 && <span className="palette-busy" data-testid="palette-busy">{auditText('audit.CommandPalette.searchingMessagesAndTheBrain')}</span>}
        <ModelNote model={model} /></div>
    </Modal>
  );
}

function markText(text: string, mark: [number, number] | null): ReactNode {
  if (!mark) return text;
  return <>{text.slice(0, mark[0])}<mark>{text.slice(mark[0], mark[1])}</mark>{text.slice(mark[1])}</>;
}
