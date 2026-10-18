// The app action bar: history, search, observed status, requests, browsers and stop controls.
// Settings owns appearance and connectors; its gear menu only links to settings and shortcuts.
// Used by App.tsx; fit steps keep the final action group reachable at narrow widths.
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import{t}from'../i18n';
import type { CliStatus, EngineInfo } from '@shared/contract';
import { useNow } from '../lib/clock';
import { useEngines } from '../lib/engines';
import { queuedCount, runningCount } from '../store/state';
import { cliCheck, cliLogin, useApp } from '../store/store';
import { openModal, toggleBrowsers, ui } from '../store/ui';
import { back, focusChat, forward, go, newBrowser, nextThing, recentPlaces, stopAllAsk, toggleCenter, toggleQuestionsModal } from '../actions';
import { questionsModalOn } from '../lib/questions';
import { bellCount } from '../lib/notify';
import { placeLabel } from '../store/ui';
import { openQueue } from '../lib/later';
import { HarnessMark, IconArrowLeft, IconArrowRight, IconBell, IconBolt, IconGlobe, IconHistory, IconLogin, IconMore, IconRefresh, IconSearch, IconSettings, IconStop } from './Icons';
import { UsageBar } from './UsageBar';
import { SyncStatus } from './SyncStatus';
import { StatoButton } from './RegiaOverlay';
import { IconButton, Keys, MenuItem, MenuLabel, MenuSep, Popover } from './ui';

function CliRow({ engine: { id: harness, name }, st }: { engine: EngineInfo; st: CliStatus | undefined }) {
  const ok = !!st?.found && st.loggedIn !== false;
  return (
    <div className="cli-row" data-testid={`cli-${harness}`}>
      <span className={`cli-dot ${!st ? 'unknown' : ok ? 'ok' : 'bad'}`} aria-hidden="true" />
      <span className="cli-text">
        <b>{name}</b>
        <small>{!st ? 'controllo in corso…' : !st.found ? 'CLI non trovata' : `${st.version ?? 'versione ?'} · ${st.loggedIn === true ? (st.account ?? 'accesso fatto') : st.loggedIn === false ? 'accesso da fare' : 'accesso non controllato'}`}</small>
      </span>
      {st?.found && st.loggedIn !== true && (
        <button type="button" className="btn btn-primary btn-s" onClick={() => void cliLogin(harness)} data-testid={`cli-login-${harness}`}><IconLogin size={13} /> Accedi</button>
      )}
      <button type="button" className="icon-btn" aria-label={`Ricontrolla ${name}`} data-tip="Ricontrolla" onClick={() => void cliCheck(harness)} data-testid={`cli-check-${harness}`}><IconRefresh size={13} /></button>
    </div>
  );
}

function CliStatusButton() {
  const cli = useApp(s => s.info?.cli ?? null);
  const engines = useEngines();
  const on = useApp(s => s.settings?.engineOn);
  // on the bar only the engines that are on (Kimi and the brain's ship off: they would only widen it); the
  // menu lists every engine
  const shown = engines.filter(e => on?.[e.id] === true && e.trusted);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const bad = shown.some(e => { const c = cli?.[e.id]; return !!c?.found && c.loggedIn === false; });
  const label = !cli ? 'CLI: controllo in corso' : bad ? 'CLI: serve un accesso' : 'CLI pronte';
  return (
    <>
      <button ref={ref} type="button" className={`cli-btn ${bad ? 'bad' : ''}`} onClick={() => setOpen(o => !o)} aria-label={label} data-tip={label} aria-expanded={open} data-testid="cli-status">
        {shown.map(({ id: h }) => {
          const st = cli?.[h];
          return (
            <span key={h} className="cli-mark">
              <HarnessMark harness={h} size={18} />
              <span className={`cli-dot ${!st ? 'unknown' : st.found && st.loggedIn !== false ? 'ok' : 'bad'}`} />
            </span>
          );
        })}
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} testid="cli-pop" width={320}>
        <MenuLabel>Le CLI che l'app usa (ognuna con il tuo accesso)</MenuLabel>
        {engines.map(e => <CliRow key={e.id} engine={e} st={cli?.[e.id]} />)}
        <p className="menu-note">L'app non vede mai le tue credenziali: «Accedi» apre il login ufficiale in un terminale.</p>
      </Popover>
    </>
  );
}

// Settings has one destination; appearance controls live on that page.
function SettingsButton() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return <>
    <IconButton ref={ref} label="Impostazioni" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-haspopup="menu" testid="settings"><IconSettings /></IconButton>
    <Popover anchor={ref} open={open} onClose={() => setOpen(false)} testid="settings-pop" width={248}>
      <MenuItem onSelect={() => { setOpen(false); openModal('shortcuts'); }} shortcut="Ctrl+/" testid="settings-shortcuts">Scorciatoie da tastiera</MenuItem>
      <MenuItem onSelect={() => { setOpen(false); go({ page: 'impostazioni' }); }} shortcut="Ctrl+," testid="settings-all">Tutte le impostazioni</MenuItem>
    </Popover>
  </>;
}

function HistoryNav() {
  const hist = ui.use(s => s.hist);
  const len = ui.use(s => s.history.length);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <span className="hist-nav">
      <IconButton label="Indietro" shortcut="Alt+←" onClick={back} disabled={hist <= 0} testid="nav-back"><IconArrowLeft size={14} /></IconButton>
      <IconButton label="Avanti" shortcut="Alt+→" onClick={forward} disabled={hist >= len - 1} testid="nav-forward"><IconArrowRight size={14} /></IconButton>
      <IconButton ref={ref} label="Posti recenti" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="menu" testid="nav-recent"><IconHistory size={14} /></IconButton>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} align="start" testid="nav-recent-pop" width={260}>
        <MenuLabel>Recenti</MenuLabel>
        {recentPlaces().map((p, i) => (
          <MenuItem key={`${p.page}-${p.element ?? ''}-${i}`} onSelect={() => { setOpen(false); go(p); }} testid={`recent-${i}`}>
            {placeLabel(p)}
          </MenuItem>
        ))}
      </Popover>
    </span>
  );
}

function Bell() {
  const feed = useApp(s => s.feed);
  const read = ui.use(s => s.read);
  const open = ui.use(s => s.center);
  const now = useNow(60_000);
  const dnd = useApp(s => !!s.settings && (s.settings.dnd || (!!s.settings.dndUntil && s.settings.dndUntil > now)));
  const pending = useApp(s => s.pending);
  const n = bellCount(feed, read, new Set(pending.map(p => p.chatId)));
  return (
    <button type="button" className={`bell ${open ? 'on' : ''}`} onClick={toggleCenter} aria-label={`Notifiche: ${n} da leggere (Ctrl+Shift+N)`} aria-expanded={open}
      data-tip={dnd ? 'Notifiche · non disturbare attivo|Ctrl+Shift+N' : 'Notifiche|Ctrl+Shift+N'} data-testid="bell">
      <IconBell size={16} />
      {n > 0 && <span className="bell-n" data-testid="bell-count">{n > 99 ? '99+' : n}</span>}
      {dnd && <span className="bell-dnd" aria-hidden="true" />}
    </button>
  );
}

/** The full-screen popups (the questions window, lib/questions.ts) on and off in one click, with its state in sight
 *  (SPEC 21; before, a "…" menu item). The setting is the same one Settings writes. */
function PopupsSwitch() {
  const on = useApp(questionsModalOn);
  const label = t(on ? 'ui.popupsOn' : 'ui.popupsOff');
  return (
    <button type="button" role="switch" aria-checked={on} className={`btn btn-ghost btn-m popups-switch${on ? ' on' : ''}`} onClick={toggleQuestionsModal}
      aria-label={label} data-tip={label} data-testid="topbar-qwin">
      <span className="popups-track" aria-hidden="true"><span className="popups-knob" /></span>
      <span className="popups-label">{t('ui.popups')} <b>{t(on ? 'ui.popupsStateOn' : 'ui.popupsStateOff')}</b></span>
    </button>
  );
}

/** "…": the actions used now and then, always here (2026-10-15, before they moved in and out with the width): the
 *  browsers on/off (a count badge on "…" while they are hidden), Credenziali, Migliora l'app (the questions window moved
 *  onto the bar, PopupsSwitch). */
function MoreButton() {
  const hide = ui.use(s => s.prefs.browsersHidden);
  const tabs = useApp(s => s.tabs.length);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const run = (f: () => void) => () => { setOpen(false); f(); };
  const toggle = () => setOpen(o => !o);
  return (
    <span className="topbar-more">
      <IconButton ref={ref} className={hide ? 'on' : ''} label={hide ? (tabs > 0 ? `Altre azioni: ${tabs} browser nascosti` : 'Altre azioni: browser nascosti') : 'Altre azioni'} data-tip={hide ? 'Altre azioni|browser nascosti: continuano a lavorare (Ctrl+Shift+B li mostra)' : "Altre azioni|browser, credenziali, Migliora l'app"} onClick={toggle} aria-expanded={open} aria-haspopup="menu" testid="topbar-more"><IconMore /></IconButton>
      {hide && tabs > 0 && <span className="count-badge more-badge" aria-hidden="true" data-testid="topbar-browsers-count">{tabs}</span>}
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} testid="topbar-more-pop" width={300}>
        <MenuItem checked={hide} onSelect={run(toggleBrowsers)} shortcut="Ctrl+Shift+B" testid="more-browsers">{hide ? `Browser nascosti (${tabs}): continuano a lavorare` : 'Nascondi i browser'}</MenuItem>
        <MenuItem onSelect={run(() => openModal('credentials'))} testid="more-credentials">Credenziali degli ambienti…</MenuItem>
        <MenuSep />
        <MenuItem onSelect={run(() => go({ page: 'migliora' }))} shortcut="G U" testid="more-improve">Migliora l'app</MenuItem>
      </Popover>
    </span>
  );
}

/** Fit steps, applied in order while the bar's actions overflow (2026-10-13, settings pushed off at 1920 px): 1 icon-only
 *  buttons, 2 shorter usage strip, 3 icon-only search / next, 4 no Cursor in the strip, 5 icon-only popups switch and
 *  connectors. Read by app.css (data-fit). */
const FIT_STEPS = 5;
function useFit(head: RefObject<HTMLElement | null>, main: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const h = head.current, m = main.current;
    if (!h || !m) return;
    const fit = () => {
      for (let n = 0; n <= FIT_STEPS; n++) {
        if (n) h.dataset.fit = Array.from({ length: n }, (_, i) => i + 1).join(' ');
        else delete h.dataset.fit;
        if (m.scrollWidth <= m.clientWidth + 1) return;
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(h);
    // a label that changes ("Niente ti aspetta" → "Prossima cosa per te", a count) can overflow the bar again
    const mo = new MutationObserver(fit);
    mo.observe(m, { childList: true, subtree: true, characterData: true });
    void document.fonts?.ready.then(fit);
    return () => { ro.disconnect(); mo.disconnect(); };
  }, [head, main]);
}

export function TopBar() {
  const waiting = useApp(s => s.pending.length);
  const later = ui.use(s => s.later);
  const inQueue = later && waiting > 0; // "Da rispondere" (not the CPU queue below)
  // "Rispondi dopo" on with nothing waiting: say it, a click turns the popups back on (lib/later.ts)
  const paused = later && waiting === 0;
  const running = useApp(s => runningCount(s));
  const queued = useApp(s => queuedCount(s));
  const firstQueued = useApp(s => Object.values(s.chats).filter(c => c.queued && !c.closedAt).sort((a, b) => a.queued!.position - b.queued!.position)[0]?.id ?? null);
  const version = useApp(s => s.info?.version);
  const head = useRef<HTMLElement>(null);
  const main = useRef<HTMLDivElement>(null);
  useFit(head, main);
  return (
    <header ref={head} className="topbar" data-testid="topbar">
      {/* everything but the end group shrinks step by step (useFit); the end group (bell, settings) never leaves the screen */}
      <div ref={main} className="topbar-main">
      {/* the mark only: the name and the version sit in its tooltip, the room went to "Migliora l'app" (the user, 2026-10-12) */}
      <div className="brand" aria-label={version ? `second-brain v${version}` : 'second-brain'} data-tip={version ? `second-brain · v${version}` : 'second-brain'} data-testid="app-version"><span className="brand-mark" aria-hidden="true" /></div>
      <HistoryNav />
      <StatoButton />
      <button type="button" className="search" onClick={() => openModal('palette')} data-testid="topbar-search" aria-label="Cerca chat, pagine e comandi (Ctrl+K)">
        <IconSearch size={14} /><span className="search-text">Cerca chat, idee o un comando</span><Keys combo="Ctrl+K" />
      </button>
      <span className="sp" />
      <UsageBar />
      {queued > 0 && (
        <button type="button" className="btn btn-m btn-ghost topbar-queue" onClick={() => { if (firstQueued) focusChat(firstQueued); }} data-testid="topbar-queue"
          aria-label={`${queued} in coda per il carico del PC: mostra la prima`}
          data-tip="Chat o messaggi degli agenti in coda: il PC è sotto sforzo, partono uno alla volta quando scende. Clic: mostra la prima, con «Avvia ora».">
          <span className="queue-label">In coda</span><span className="count-badge">{queued}</span>
        </button>
      )}
      <CliStatusButton />
      <SyncStatus />
      <button type="button" className={`btn btn-m ${waiting ? 'btn-amber' : 'btn-ghost'} next-btn`} onClick={() => (paused ? openQueue(null) : nextThing())} data-testid="topbar-next" data-queue={inQueue ? '' : undefined} data-paused={paused ? '' : undefined}
        data-tip={inQueue ? 'Da rispondere: le richieste lasciate per dopo, una alla volta; aprirla riaccende i popup|Ctrl+J' : paused ? 'Rispondi dopo è attivo: le nuove richieste vanno in «Da rispondere» senza popup. Clic per riaccendere i popup' : 'La cosa più vecchia che ti aspetta|Ctrl+J'}
        aria-label={inQueue ? `Da rispondere: ${waiting} (Ctrl+J)` : paused ? 'Popup in pausa: clic per riaccenderli' : `Prossima cosa per te: ${waiting} (Ctrl+J)`}>
        <IconBolt size={14} /><span className="next-label">{inQueue ? 'Da rispondere' : paused ? 'Popup in pausa' : waiting ? 'Prossima cosa per te' : 'Niente ti aspetta'}</span>
        {waiting > 0 && <span className="count-badge" data-testid="topbar-next-count">{waiting}</span>}
      </button>
      <PopupsSwitch />
      <button type="button" className="btn btn-ghost btn-m new-browser" onClick={() => void newBrowser()} data-testid="topbar-new-browser" aria-label={t('ui.newBrowser')} data-tip={t('ui.newBrowser')}><IconGlobe size={14}/><span>{t('ui.newBrowser')}</span></button>
      <button type="button" className="btn btn-danger btn-m" onClick={stopAllAsk} disabled={running === 0} data-testid="topbar-stopall" data-tip="Ferma tutte le chat al lavoro|Ctrl+Shift+."
        aria-label={`Ferma tutto: ${running} al lavoro (Ctrl+Shift+.)`}>
        <IconStop size={13} /><span>Ferma tutto</span>{running > 0 && <span className="count-badge red">{running}</span>}
      </button>
      </div>
      <div className="topbar-end">
        <MoreButton />
        <Bell />
        <SettingsButton />
      </div>
    </header>
  );
}
