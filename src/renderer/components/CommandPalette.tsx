// Ctrl+K: go anywhere and one search over everything (recent places, chats by title, folder and last line; open
// requests; the closed chats (a pick reopens it); browser tabs; every brain section and the map; feed events) and every app action with its shortcut (the
// engine of each chat in its line; "Credenziali" opens the credentials panel; the Regia: ricomincia da capo, passa all'altro motore, Domande alla Regia). A
// pasted internal link (sb://<page>/<element>) is the first result. Fuzzy filter (lib/fuzzy.ts), ↑↓ + Enter, Esc
// closes. While it is open the browser views are hidden (a modal blocks them all). From two letters on, a full-text
// search in main ('search:query', ADR 0023) adds the messages of the chats of the last 30 days (closed ones too: Enter
// reopens), the chats' git branches and the brain's markdown files, grouped by kind with snippet and date, after the
// quick matches above. Used by App.tsx.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SearchHit, SearchResult } from '@shared/contract';
import { sb } from '../sb';
import { t } from '../i18n';
import { chatName } from '@shared/regia';
import { fuzzyScore } from '../lib/fuzzy';
import { closedTime, folderName, sameDay, stateInfo } from '../lib/format';
import { engineName, otherEngine } from '../lib/engines';
import { app } from '../store/store';
import { BRAIN_PAGES, closeModal, openModal, openNewRegia, pageLabel, placeLabel, setMaximized, setPrefs, setRegiaOpen, ui, type BrainPageId } from '../store/ui';
import { linkOfEvent, parseLink } from '../lib/notify';
import { closedChats } from '../lib/autoclose';
import { now } from '../lib/clock';
import {
  back, copyLink, currentLink, focusChat, reopenChat, focusRequest, focusTile, forward, go, nextThing, openLink, recentPlaces, stopAllAsk, stopFocused, toggleCenter, toggleFocusMode,
  toggleMaximize, toggleRegia, askRenewRegia, askClearRegia, regiaId, toggleQuestionsModal, newBrowser,
} from '../actions';
import { questionsModalOn } from '../lib/questions';
import {
  HarnessMark, IconArrowLeft, IconArrowRight, IconBell, IconBolt, IconBook, IconBranch, IconFile, IconBrain, IconChart, IconCoins, IconCompass, IconFocus, IconGlobe,
  IconHistory, IconKeyboard, IconLayers, IconLightbulb, IconLink, IconList, IconLogin, IconMap, IconMaximize, IconPlus, IconQuestion, IconSearch, IconSettings, IconStop,
  IconSparkle, IconTarget, IconTicket,
} from './Icons';
import { Keys, Modal } from './ui';

interface Cmd {
  id: string; group: string; title: string; sub?: string; shortcut?: string; icon: ReactNode; run: () => void; text?: string;
  /** a full-text hit: its excerpt (match marked) and date, shown under a group header */
  snippet?: { text: string; mark: [number, number] | null }; date?: string; found?: boolean;
}

const PAGE_ICON: Record<BrainPageId, ReactNode> = {
  home: <IconBrain />,
  agenti: <IconLayers />,
  fatto: <IconBook />, idee: <IconLightbulb />,
  costi: <IconCoins />, qualita: <IconChart />, procedure: <IconCompass />, confronto: <IconLayers />, miglioramento: <IconTarget />, file: <IconBrain />, devops: <IconTicket />, skill: <IconSparkle />, impostazioni: <IconSettings />, migliora: <IconSparkle />,
  dashboard: <IconChart />, guida: <IconQuestion />,
};

function buildCommands(): Cmd[] {
  const s = app.get();
  const u = ui.get();
  const out: Cmd[] = [];
  for (const r of s.pending) {
    const c = s.chats[r.chatId];
    out.push({ id: `req:${r.chatId}/${r.id}`, group: 'Ti aspettano', title: `Rispondi: ${r.title}`, sub: c && chatName(c), icon: <IconQuestion />, run: () => focusRequest(r) });
  }
  for (const id of s.order) {
    const c = s.chats[id];
    if (!c || u.hidden.includes(id) || c.closedAt) continue;
    const st = stateInfo(c);
    out.push({
      id: `chat:${id}`, group: 'Chat', title: chatName(c), sub: `${engineName(c.harness)} · ${st.label} · ${folderName(c.cwd)}${c.lastText ? ` · ${c.lastText}` : ''}`,
      icon: <HarnessMark harness={c.harness} regia={c.isRegia} size={18} />, run: () => focusChat(id), text: `${c.title} ${engineName(c.harness)} ${c.cwd} ${c.lastText}`,
    });
  }
  for (const c of closedChats(s.chats)) {
    out.push({
      id: `closed:${c.id}`, group: 'Chiuse', title: c.title, sub: `chiusa ${closedTime(c.closedAt!, now())}, Invio la riapre${c.lastText ? ` · ${c.lastText}` : ''}`,
      icon: <HarnessMark harness={c.harness} size={18} />, run: () => { void reopenChat(c.id); }, text: `${c.title} ${c.cwd} ${c.lastText} chiusa riapri`,
    });
  }
  for (const t of s.tabs) {
    if (u.hiddenTabs.includes(t.id)) continue;
    const owner = t.ownerChatId ? s.chats[t.ownerChatId]?.title : null;
    out.push({
      id: `tab:${t.id}`, group: 'Browser', title: t.title || t.url, sub: owner ? `guidato da ${owner} · ${t.url}` : t.url, icon: <IconGlobe />, text: `${t.title} ${t.url} ${owner ?? ''}`,
      run: () => setMaximized(`browser:${t.id}`),
    });
  }
  // the Regia of the tab shown in the overlay (ADR 0021)
  const rid = regiaId();
  const regia = rid ? s.chats[rid] : undefined;
  const to = regia && otherEngine(regia.harness);
  const actions: Omit<Cmd, 'group'>[] = [
    { id: 'stato', title: 'Stato: a che punto siamo', sub: 'chat, domande in attesa, rami e le tue PR, senza token', shortcut: 'Ctrl+Shift+S', icon: <IconList />, run: () => openModal('stato'), text: 'stato come siamo messi a che punto siamo pr' },
    { id: 'next', title: 'Prossima cosa che ti aspetta', shortcut: 'Ctrl+J', icon: <IconBolt />, run: () => nextThing() },
    { id: 'new', title: 'Nuova chat', shortcut: 'Ctrl+N', icon: <IconPlus />, run: () => openModal('newChat') },
    { id: 'new-browser', title: t('ui.newBrowser'), sub: t('ui.browserMine'), icon: <IconGlobe />, run: () => { void newBrowser(); }, text: 'browser tab scheda web' },
    { id: 'stopall', title: 'Ferma tutto', shortcut: 'Ctrl+Shift+.', icon: <IconStop />, run: stopAllAsk },
    { id: 'stop', title: 'Ferma la chat selezionata', shortcut: 'Ctrl+.', icon: <IconStop />, run: stopFocused },
    { id: 'focus', title: u.focusMode ? 'Esci dalla modalità focus' : 'Modalità focus sulla chat selezionata', shortcut: 'Ctrl+Shift+F', icon: <IconFocus />, run: toggleFocusMode },
    { id: 'max', title: 'Ingrandisci / ripristina la tessera selezionata', shortcut: 'F11', icon: <IconMaximize />, run: () => toggleMaximize() },
    { id: 'regia', title: 'Vai all’Orchestrator', sub: regia ? `su ${engineName(regia.harness)}` : undefined, shortcut: 'Ctrl+0', icon: <HarnessMark harness="claude" regia size={18} />, run: () => focusTile(0) },
    ...(regia ? [
      { id: 'regiaclear', title: `Orchestrator: pulisci «${regia.title}»`, sub: 'riparte vuoto dalla memoria, la conversazione resta tra le chat chiuse', icon: <HarnessMark harness={regia.harness} regia size={18} />, run: () => askClearRegia(regia.id), text: 'pulisci clear azzera orchestrator regia' },
      { id: 'regianew', title: 'Nuova Regia', sub: 'una tab in più, es. «App»', icon: <IconPlus />, run: openNewRegia },
      { id: 'regiarenew', title: 'Orchestrator: ricomincia da capo', sub: `nuovo Orchestrator su ${engineName(regia.harness)}, il vecchio resta tra le chat`, shortcut: 'Ctrl+Shift+R', icon: <HarnessMark harness={regia.harness} size={18} />, run: () => askRenewRegia(regia.harness) },
      ...(to ? [{ id: 'regiaengine', title: `Orchestrator: passa a ${engineName(to)}`, sub: `cambia motore, l’Orchestrator su ${engineName(regia.harness)} resta tra le chat`, icon: <HarnessMark harness={to} size={18} />, run: () => askRenewRegia(to) }] : []),
    ] : []),
    { id: 'qwin', title: questionsModalOn(s) ? 'Domande in finestra: spegni' : 'Domande in finestra: accendi',
      sub: questionsModalOn(s) ? 'ora le domande compaiono in primo piano, una alla volta' : 'ora le domande restano nelle chat e nell’Orchestrator',
      icon: <IconQuestion />, run: toggleQuestionsModal, text: 'domande finestra modale popup permessi' },
    { id: 'density', title: u.prefs.density === 'compact' ? 'Densità comoda' : 'Densità compatta', icon: <IconLayers />, run: () => setPrefs({ density: u.prefs.density === 'compact' ? 'comfortable' : 'compact' }) },
    { id: 'theme', title: 'Tema: chiaro / scuro / come il sistema', sub: `ora: ${u.prefs.theme === 'system' ? 'come il sistema' : u.prefs.theme === 'dark' ? 'scuro' : 'chiaro'}`, icon: <IconSettings />,
      run: () => setPrefs({ theme: u.prefs.theme === 'system' ? 'dark' : u.prefs.theme === 'dark' ? 'light' : 'system' }) },
    { id: 'credentials', title: 'Credenziali', sub: 'URL, utente e Copia password degli ambienti (test, local, prod)', icon: <IconLogin />, run: () => openModal('credentials'),
      text: 'credenziali password utente login account ambienti test url pms' },
    { id: 'keys', title: 'Scorciatoie da tastiera', shortcut: 'Ctrl+/', icon: <IconKeyboard />, run: () => openModal('shortcuts') },
    { id: 'center', title: 'Notifiche', shortcut: 'Ctrl+Shift+N', icon: <IconBell />, run: toggleCenter },
    { id: 'regiadock', title: 'Espandi o riduci l’Orchestrator', shortcut: 'Ctrl+R', icon: <HarnessMark harness="claude" regia size={18} />, run: toggleRegia },
    { id: 'regiaplace', title: 'Orchestrator: misura di partenza', sub: 'in basso a destra, la misura iniziale', icon: <HarnessMark harness="claude" regia size={18} />, run: () => { setPrefs({ regiaSize: null }); setRegiaOpen(true); }, text: 'misura dimensione reset orchestrator regia' },
    { id: 'back', title: 'Indietro', shortcut: 'Alt+←', icon: <IconArrowLeft />, run: back },
    { id: 'forward', title: 'Avanti', shortcut: 'Alt+→', icon: <IconArrowRight />, run: forward },
    { id: 'copylink', title: 'Copia il link di questo punto', sub: currentLink(), icon: <IconLink />, run: () => { void copyLink(); } },
  ];
  for (const a of actions) out.push({ ...a, group: 'Azioni' });
  // the Grindhouse holds the agents (SPEC 19): Ctrl+1 and a search for "agenti" or "chat" land there
  for (const p of BRAIN_PAGES) out.push({ id: `page:${p.id}`, group: 'Vai a', title: p.label, shortcut: p.id === 'home' ? 'Ctrl+1' : p.key, icon: PAGE_ICON[p.id], run: () => go({ page: p.id }),
    ...(p.id === 'home' ? { sub: t('home.workspace'), text: `${p.label} ${t('home.agents')} chat agents home` } : p.id === 'guida' ? { sub: t('guide.title'), text: `${p.label} guida guide aiuto help concetti concepts come funziona how it works` } : {}) });
  out.push({ id: 'page:mappa', group: 'Vai a', title: 'Mappa 3D', sub: 'a tutto schermo', shortcut: 'Ctrl+Shift+M', icon: <IconMap />, run: () => go({ page: 'mappa' }) });
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
  if (sameDay(at, nowMs)) return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const y = d.getFullYear() !== new Date(nowMs).getFullYear();
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', ...(y ? { year: 'numeric' } : {}) });
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
      out.push({ ...base, title: h.path ?? h.title, sub: h.line && h.line > 1 ? `riga ${h.line}` : undefined, icon: <IconFile />, run: () => go({ page: 'esplora', arg: h.path ?? h.title }) });
    } else if (h.kind === 'branch') {
      out.push({ ...base, title: h.title, sub: h.sub, icon: <IconBranch />, run: () => openChat(h.chatId) });
    } else {
      const title = c ? chatName(c) : h.title;
      const more = h.count && h.count > 1 ? ` · ${h.count} messaggi` : '';
      out.push({
        ...base, title, sub: `${closed ? 'chiusa, Invio la riapre · ' : ''}${h.sub ?? ''}${more}`,
        icon: c ? <HarnessMark harness={c.harness} regia={c.isRegia} size={18} /> : <IconHistory />, run: () => openChat(h.chatId),
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

const GROUP_ORDER = ['Ti aspettano', 'Recenti', 'Chat', 'Chiuse', 'Vai a', 'Azioni', 'Browser'];
const GROUP_BONUS: Record<string, number> = { 'Ti aspettano': 260, Chat: 300, Chiuse: 240, 'Vai a': 220, Recenti: 120, Azioni: 160, Browser: 120, Novità: 0 };

export function CommandPalette() {
  const [q, setQ] = useState('');
  // the highlighted row by id: full-text results arriving reshape the list, the choice stays on its row
  const [activeId, setActiveId] = useState<string | null>(null);
  const all = useMemo(buildCommands, []);
  const found = useFound(q);
  const quick = useMemo(() => {
    const link = parseLink(q);
    if (link) return [{ id: 'link', group: 'Link', title: `Vai a ${q.trim()}`, sub: `${pageLabel(link.page)}${link.element ? ` · ${link.element}` : ''}`, icon: <IconLink />, run: () => { openLink(q); } } as Cmd];
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
    <Modal onClose={closeModal} label="Cerca e comandi" testid="palette" className="modal-palette" top>
      <div className="palette-search">
        <IconSearch size={16} />
        <input autoFocus value={q} placeholder="Cerca chat, browser, pagine, comandi…" aria-label="Cerca" data-testid="palette-input" role="combobox" aria-expanded="true" aria-controls="palette-list"
          aria-activedescendant={list[active] ? `pal-${active}` : undefined}
          onChange={e => { setQ(e.target.value); setActiveId(null); }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
            if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
            if (e.key === 'Enter') { e.preventDefault(); run(list[active]); }
          }} />
        <Keys combo="Esc" />
      </div>
      <div className="palette-list" id="palette-list" role="listbox" ref={listRef} aria-label="Risultati">
        {list.length === 0 && <div className="palette-empty">{found.busy ? 'Cerco nelle chat e nel brain…' : <>Niente per «{q}». Prova con il nome di una chat o di un comando.</>}</div>}
        {list.map((c, i) => {
          const header = (!q.trim() || c.found) && c.group !== lastGroup ? c.group : null;
          lastGroup = c.group;
          return (
            <div key={c.id}>
              {header && <div className="palette-group">{header}</div>}
              <div id={`pal-${i}`} role="option" aria-selected={i === active} data-index={i} className={`palette-item ${i === active ? 'active' : ''}`} data-testid={`palette-item-${c.id}`}
                onMouseMove={() => setActiveId(c.id)} onClick={() => run(c)}>
                <span className="palette-icon">{c.icon}</span>
                {c.snippet ? (
                  <span className="palette-text found">
                    <span className="palette-line"><span className="palette-title">{c.title}</span>{c.sub && <span className="palette-sub">{c.sub}</span>}</span>
                    <span className="palette-snippet" data-testid="palette-snippet">{markText(c.snippet.text, c.snippet.mark)}</span>
                  </span>
                ) : <span className="palette-text"><span className="palette-title">{c.title}</span>{c.sub && <span className="palette-sub">{c.sub}</span>}</span>}
                {c.found ? c.date && <span className="palette-tag">{c.date}</span> : q.trim() && <span className="palette-tag">{c.group}</span>}
                {c.shortcut && <Keys combo={c.shortcut} />}
              </div>
            </div>
          );
        })}
      </div>
      <div className="palette-foot"><span><Keys combo="↑ ↓" /> scegli</span><span><Keys combo="Invio" /> apri</span><span><Keys combo="Esc" /> chiudi</span>
        {found.busy && list.length > 0 && <span className="palette-busy" data-testid="palette-busy">cerco nei messaggi e nel brain…</span>}</div>
    </Modal>
  );
}

function markText(text: string, mark: [number, number] | null): ReactNode {
  if (!mark) return text;
  return <>{text.slice(0, mark[0])}<mark>{text.slice(mark[0], mark[1])}</mark>{text.slice(mark[1])}</>;
}
