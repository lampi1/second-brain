// The top bar: brand, back/forward (Alt+←/→) and the recent places, the Stato button, search/palette trigger (Ctrl+K), the
// usage strip (UsageBar: today's spend, Claude 5 h / week, Cursor), CLI status
// (each engine's CLI found, version, login, "Accedi"), the brain-sync status (SyncStatus: only when a domain syncs), "Prossima cosa per te" (Ctrl+J) with the count (while "Rispondi
// dopo" is on, "Da rispondere": the queue's counter, it opens the queue, lib/later.ts), the full-screen popups switch
// (the questions window, lib/questions.ts) and the connectors with their status dots (SPEC 21: one click, no Settings dive;
// new agents start from the Grindhouse, Ctrl+N or the palette, so no "Nuova chat" here), "Nuovo browser", "■ Ferma tutto"
// (confirm only with >1 running), then the end group: "…" (browsers on/off, Credenziali, Migliora l'app: always there, 2026-10-15), the notification bell (Ctrl+Shift+N) and the settings menu (look and
// the way to Settings). Used by App.tsx. On a bar too full for its width (useFit) the labels go first; the end group never
// shrinks, so it stays on screen at any width (2026-10-13).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import{t}from'../i18n';
import type { CliStatus, EngineInfo } from '@shared/contract';
import type { ConnectorState } from '@shared/connectors';
import { sb } from '../sb';
import { AppConnectorScreen } from '../../modules/onboarding/AppScreen';
import { useNow } from '../lib/clock';
import { useEngines } from '../lib/engines';
import { queuedCount, runningCount } from '../store/state';
import { cliCheck, cliLogin, useApp } from '../store/store';
import { openModal, setPrefs, toggleBrowsers, ui, type Density, type Theme } from '../store/ui';
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

/** The gear: only the look of the app and the way to every setting (2026-10-15: the DevOps interval and "chat tra motori
 *  diversi" live on the DevOps page and in Settings → Motori, not in two places). */
function SettingsButton() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const density = ui.use(s => s.prefs.density);
  const theme = ui.use(s => s.prefs.theme);
  const set = (patch: { density?: Density; theme?: Theme }) => { setPrefs(patch); setOpen(false); };
  return (
    <>
      <IconButton ref={ref} label="Impostazioni" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="menu" testid="settings"><IconSettings /></IconButton>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} testid="settings-pop" width={248}>
        <MenuLabel>Tema</MenuLabel>
        {(['system', 'dark', 'light'] as Theme[]).map(t => <MenuItem key={t} checked={theme === t} onSelect={() => set({ theme: t })} testid={`theme-${t}`}>{t === 'system' ? 'Come il sistema' : t === 'dark' ? 'Scuro' : 'Chiaro'}</MenuItem>)}
        <MenuSep />
        <MenuLabel>Densità</MenuLabel>
        {(['comfortable', 'compact'] as Density[]).map(d => <MenuItem key={d} checked={density === d} onSelect={() => set({ density: d })} testid={`density-${d}`}>{d === 'compact' ? 'Compatta' : 'Comoda'}</MenuItem>)}
        <MenuSep />
        <MenuItem onSelect={() => { setOpen(false); openModal('shortcuts'); }} shortcut="Ctrl+/" testid="settings-shortcuts">Scorciatoie da tastiera</MenuItem>
        <MenuItem onSelect={() => { setOpen(false); go({ page: 'impostazioni' }); }} shortcut="Ctrl+," testid="settings-all">Tutte le impostazioni</MenuItem>
      </Popover>
    </>
  );
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

const CONNECTOR_NAME: Record<ConnectorState['provider'], string> = { github: 'GitHub', jira: 'Jira' };
const CONNECTOR_DOT: Record<ConnectorState['status'], string> = { verified: 'ok', pending: 'warn', failed: 'bad' };

/** The connectors (GitHub, Jira) with one status dot each (SPEC 21): green connected, amber to verify, red failed; a
 *  click opens the same panel as Settings → Strumenti e progetti, the dots are read again when it closes. */
function ConnectorsButton() {
  const [list, setList] = useState<ConnectorState[] | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  // stable: Popover re-runs its focus effect when onClose changes, which would pull the focus back to the first button
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (open) return;
    let live = true;
    sb.invoke('connectors:list', undefined).then(value => { if (live) setList(value); }, () => { if (live) setList([]); });
    return () => { live = false; };
  }, [open]);
  const label = !list ? t('ui.connectorsLoading') : list.length ? t('ui.connectorsTip', { list: list.map(c => `${CONNECTOR_NAME[c.provider]} ${t(`ui.connector.${c.status}`)}`).join(', ') }) : t('ui.connectorsNone');
  return (
    <>
      <button ref={ref} type="button" className="btn btn-ghost btn-m connectors-btn" onClick={() => setOpen(o => !o)} aria-label={label} data-tip={label} aria-expanded={open} aria-haspopup="dialog" data-testid="topbar-connectors">
        <span className="connectors-label">{t('ui.connectors')}</span>
        {list?.map(c => <span key={c.provider} className="connector-mark" data-testid={`topbar-connector-${c.provider}`} data-status={c.status}>
          <small aria-hidden="true">{CONNECTOR_NAME[c.provider]}</small><span className={`cli-dot ${CONNECTOR_DOT[c.status]}`} aria-hidden="true" />
        </span>)}
      </button>
      <Popover anchor={ref} open={open} onClose={close} testid="topbar-connectors-pop" width={420} kind="dialog" label={t('ui.connectors')}>
        <AppConnectorScreen />
      </Popover>
    </>
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
      <ConnectorsButton />
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
