// Ctrl+K: go anywhere and one search over everything (recent places, chats by title, folder and last line; open
// requests; browser tabs; every brain section and the map; feed events) and every app action with its shortcut. A
// pasted internal link (sb://<page>/<element>) is the first result. Fuzzy filter (lib/fuzzy.ts), ↑↓ + Enter, Esc
// closes. While it is open the browser views are hidden (a modal blocks them all). Used by App.tsx.
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { fuzzyScore } from '../lib/fuzzy';
import { folderName, stateInfo } from '../lib/format';
import { app } from '../store/store';
import { BRAIN_PAGES, closeModal, openModal, pageLabel, placeLabel, setMaximized, setPair, setPrefs, toggleView, ui, type BrainPageId } from '../store/ui';
import { linkOfEvent, parseLink } from '../lib/notify';
import {
  back, copyLink, currentLink, focusChat, focusRequest, focusTile, forward, go, nextThing, openLink, recentPlaces, stopAllAsk, stopFocused, toggleCenter, toggleFocusMode,
  toggleMaximize, toggleRegia,
} from '../actions';
import {
  HarnessMark, IconArrowLeft, IconArrowRight, IconBell, IconBolt, IconBook, IconBrain, IconChart, IconCoins, IconColumns, IconCompass, IconFocus, IconGlobe, IconGrid,
  IconHistory, IconKeyboard, IconLayers, IconLightbulb, IconLink, IconList, IconMap, IconMaximize, IconPlus, IconQuestion, IconSearch, IconSettings, IconSparkle, IconStop,
  IconTarget, IconUser,
} from './Icons';
import { Keys, Modal } from './ui';

interface Cmd { id: string; group: string; title: string; sub?: string; shortcut?: string; icon: ReactNode; run: () => void; text?: string }

const PAGE_ICON: Record<BrainPageId, ReactNode> = {
  home: <IconCompass />, adesso: <IconTarget />, fatto: <IconBook />, dafare: <IconList />, idee: <IconLightbulb />, spunti: <IconSparkle />,
  costi: <IconCoins />, qualita: <IconChart />, collabora: <IconUser />, confronto: <IconLayers />, esplora: <IconBrain />,
};

function buildCommands(): Cmd[] {
  const s = app.get();
  const u = ui.get();
  const out: Cmd[] = [];
  for (const r of s.pending) {
    const c = s.chats[r.chatId];
    out.push({ id: `req:${r.chatId}/${r.id}`, group: 'Ti aspettano', title: `Rispondi: ${r.title}`, sub: c?.isRegia ? 'Regia' : c?.title, icon: <IconQuestion />, run: () => focusRequest(r) });
  }
  for (const id of s.order) {
    const c = s.chats[id];
    if (!c || u.hidden.includes(id)) continue;
    const st = stateInfo(c);
    out.push({
      id: `chat:${id}`, group: 'Chat', title: c.isRegia ? 'Regia' : c.title, sub: `${st.label} · ${folderName(c.cwd)}${c.lastText ? ` · ${c.lastText}` : ''}`,
      icon: <HarnessMark harness={c.harness} regia={c.isRegia} size={18} />, run: () => focusChat(id), text: `${c.title} ${c.cwd} ${c.lastText}`,
    });
  }
  for (const t of s.tabs) {
    const owner = t.ownerChatId ? s.chats[t.ownerChatId]?.title : null;
    out.push({
      id: `tab:${t.id}`, group: 'Browser', title: t.title || t.url, sub: owner ? `guidato da ${owner} · ${t.url}` : t.url, icon: <IconGlobe />, text: `${t.title} ${t.url} ${owner ?? ''}`,
      run: () => { if (ui.get().prefs.view === 'corsie') setPair(t.id); else setMaximized(`browser:${t.id}`); },
    });
  }
  const view = u.prefs.view;
  const actions: Omit<Cmd, 'group'>[] = [
    { id: 'next', title: 'Prossima cosa che ti aspetta', shortcut: 'Ctrl+J', icon: <IconBolt />, run: () => nextThing() },
    { id: 'new', title: 'Nuova chat', shortcut: 'Ctrl+N', icon: <IconPlus />, run: () => openModal('newChat') },
    { id: 'stopall', title: 'Ferma tutto', shortcut: 'Ctrl+Shift+.', icon: <IconStop />, run: stopAllAsk },
    { id: 'stop', title: 'Ferma la chat selezionata', shortcut: 'Ctrl+.', icon: <IconStop />, run: stopFocused },
    { id: 'view', title: view === 'mosaico' ? 'Passa alla vista Corsie' : 'Passa alla vista Mosaico', shortcut: 'Ctrl+Shift+V', icon: view === 'mosaico' ? <IconColumns /> : <IconGrid />, run: toggleView },
    { id: 'focus', title: u.focusMode ? 'Esci dalla modalità focus' : 'Modalità focus sulla chat selezionata', shortcut: 'Ctrl+Shift+F', icon: <IconFocus />, run: toggleFocusMode },
    { id: 'max', title: 'Ingrandisci / ripristina la tessera selezionata', shortcut: 'F11', icon: <IconMaximize />, run: () => toggleMaximize() },
    { id: 'regia', title: 'Vai alla Regia', shortcut: 'Ctrl+0', icon: <HarnessMark harness="claude" regia size={18} />, run: () => focusTile(0) },
    { id: 'density', title: u.prefs.density === 'compact' ? 'Densità comoda' : 'Densità compatta', icon: <IconLayers />, run: () => setPrefs({ density: u.prefs.density === 'compact' ? 'comfortable' : 'compact' }) },
    { id: 'theme', title: 'Tema: chiaro / scuro / come Windows', sub: `ora: ${u.prefs.theme === 'system' ? 'come Windows' : u.prefs.theme === 'dark' ? 'scuro' : 'chiaro'}`, icon: <IconSettings />,
      run: () => setPrefs({ theme: u.prefs.theme === 'system' ? 'dark' : u.prefs.theme === 'dark' ? 'light' : 'system' }) },
    { id: 'keys', title: 'Scorciatoie da tastiera', shortcut: 'Ctrl+/', icon: <IconKeyboard />, run: () => openModal('shortcuts') },
    { id: 'center', title: 'Notifiche', shortcut: 'Ctrl+Shift+N', icon: <IconBell />, run: toggleCenter },
    { id: 'regiadock', title: 'Regia qui, senza lasciare la pagina', shortcut: 'Ctrl+R', icon: <HarnessMark harness="claude" regia size={18} />, run: toggleRegia },
    { id: 'back', title: 'Indietro', shortcut: 'Alt+←', icon: <IconArrowLeft />, run: back },
    { id: 'forward', title: 'Avanti', shortcut: 'Alt+→', icon: <IconArrowRight />, run: forward },
    { id: 'copylink', title: 'Copia il link di questo punto', sub: currentLink(), icon: <IconLink />, run: () => { void copyLink(); } },
  ];
  for (const a of actions) out.push({ ...a, group: 'Azioni' });
  out.push({ id: 'page:workspace', group: 'Vai a', title: 'Chat', sub: 'la griglia delle chat', shortcut: 'Ctrl+1', icon: <IconGrid />, run: () => go({ page: 'workspace' }) });
  for (const p of BRAIN_PAGES) out.push({ id: `page:${p.id}`, group: 'Vai a', title: p.label, shortcut: p.key, icon: PAGE_ICON[p.id], run: () => go({ page: p.id }) });
  out.push({ id: 'page:mappa', group: 'Vai a', title: 'Mappa 3D', sub: 'a tutto schermo', shortcut: 'Ctrl+Shift+M', icon: <IconMap />, run: () => go({ page: 'mappa' }) });
  recentPlaces(6).forEach((p, i) => {
    if (i === 0) return; // where you are now
    out.push({ id: `recent:${i}`, group: 'Recenti', title: placeLabel(p), icon: <IconHistory />, run: () => go(p) });
  });
  for (const e of s.feed.slice(0, 60)) out.push({ id: `feed:${e.id}`, group: 'Novità', title: e.title, sub: `${e.label} · ${e.detail}`, icon: <IconLightbulb />, run: () => { openLink(linkOfEvent(e)); }, text: `${e.title} ${e.detail} ${e.label}` });
  return out;
}

const GROUP_ORDER = ['Ti aspettano', 'Recenti', 'Chat', 'Vai a', 'Azioni', 'Browser'];
const GROUP_BONUS: Record<string, number> = { 'Ti aspettano': 260, Chat: 300, 'Vai a': 220, Recenti: 120, Azioni: 160, Browser: 120, Novità: 0 };

export function CommandPalette() {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const all = useMemo(buildCommands, []);
  const list = useMemo(() => {
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
  const listRef = useRef<HTMLDivElement>(null);
  const run = (c: Cmd | undefined) => { if (!c) return; closeModal(); c.run(); };
  const move = (d: number) => {
    setActive(a => {
      const n = (a + d + list.length) % Math.max(1, list.length);
      requestAnimationFrame(() => listRef.current?.querySelector(`[data-index="${n}"]`)?.scrollIntoView({ block: 'nearest' }));
      return n;
    });
  };
  let lastGroup = '';
  return (
    <Modal onClose={closeModal} label="Cerca e comandi" testid="palette" className="modal-palette" top>
      <div className="palette-search">
        <IconSearch size={16} />
        <input autoFocus value={q} placeholder="Cerca chat, browser, pagine, comandi…" aria-label="Cerca" data-testid="palette-input" role="combobox" aria-expanded="true" aria-controls="palette-list"
          aria-activedescendant={list[active] ? `pal-${active}` : undefined}
          onChange={e => { setQ(e.target.value); setActive(0); }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
            if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
            if (e.key === 'Enter') { e.preventDefault(); run(list[active]); }
          }} />
        <Keys combo="Esc" />
      </div>
      <div className="palette-list" id="palette-list" role="listbox" ref={listRef} aria-label="Risultati">
        {list.length === 0 && <div className="palette-empty">Niente per «{q}». Prova con il nome di una chat o di un comando.</div>}
        {list.map((c, i) => {
          const header = !q.trim() && c.group !== lastGroup ? c.group : null;
          lastGroup = c.group;
          return (
            <div key={c.id}>
              {header && <div className="palette-group">{header}</div>}
              <div id={`pal-${i}`} role="option" aria-selected={i === active} data-index={i} className={`palette-item ${i === active ? 'active' : ''}`} data-testid={`palette-item-${c.id}`}
                onMouseMove={() => setActive(i)} onClick={() => run(c)}>
                <span className="palette-icon">{c.icon}</span>
                <span className="palette-text"><span className="palette-title">{c.title}</span>{c.sub && <span className="palette-sub">{c.sub}</span>}</span>
                {q.trim() && <span className="palette-tag">{c.group}</span>}
                {c.shortcut && <Keys combo={c.shortcut} />}
              </div>
            </div>
          );
        })}
      </div>
      <div className="palette-foot"><span><Keys combo="↑ ↓" /> scegli</span><span><Keys combo="Invio" /> apri</span><span><Keys combo="Esc" /> chiudi</span></div>
    </Modal>
  );
}
