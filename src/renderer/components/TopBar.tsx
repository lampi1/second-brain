// The app action bar: history, search, observed status, requests, browsers and stop controls.
// Settings owns appearance and connectors; its gear menu only links to settings and shortcuts.
// Used by App.tsx; fit steps keep the final action group reachable at narrow widths. «Manutenzione» sits here for every
// page (ADR 0132). The end group holds the language
// switch (LangSwitch.tsx, ADR 0120), so it is always reachable.
import { useWorkflows, reloadWorkflows, reloadLessons } from '../store/workflows';
import { durableAsks } from '../lib/work-ask';
import { flowAsks } from '../lib/flow-ask';
import { useFlows, reloadFlows } from '../store/flows';
import { planAskKeys } from '../lib/plan-ask';
import { t as auditText } from '../i18n';
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import{t}from'../i18n';
import type { CliStatus, EngineInfo } from '@shared/contract';
import { useNow } from '../lib/clock';
import { useEngines } from '../lib/engines';
import { queuedCount, runningCount } from '../store/state';
import { cliCheck, cliLogin, useApp } from '../store/store';
import { openModal, ui } from '../store/ui';
import { back, focusChat, forward, go, newBrowser, nextThing, recentPlaces, stopAllAsk, toggleCenter } from '../actions';
import { bellCount } from '../lib/notify';
import { placeLabel } from '../store/ui';
import { openQueue } from '../lib/later';
import { HarnessMark, IconArrowLeft, IconArrowRight, IconBell, IconBolt, IconGlobe, IconHistory, IconLogin, IconMore, IconRefresh, IconSearch, IconSettings, IconStop } from './Icons';
import { UsageBar } from './UsageBar';
import { SyncStatus } from './SyncStatus';
import { StatoButton } from './OrchestratorOverlay';
import { LangSwitch } from './LangSwitch';
import { MaintenanceButton } from './brain-model/MaintenanceButton';
import { IconButton, Keys, MenuItem, MenuLabel, Popover } from './ui';

function CliRow({ engine: { id: harness, name }, st }: { engine: EngineInfo; st: CliStatus | undefined }) {
  const ok = !!st?.found && st.loggedIn !== false;
  return (
    <div className="cli-row" data-testid={`cli-${harness}`}>
      <span className={`cli-dot ${!st ? 'unknown' : ok ? 'ok' : 'bad'}`} aria-hidden="true" />
      <span className="cli-text">
        <b>{name}</b>
        <small>{!st ? auditText('auditExpression.TopBar.text175') : !st.found ? auditText('auditExpression.TopBar.text176') : `${st.version ?? auditText('auditExpression.TopBar.text178')} · ${st.loggedIn === true ? (st.account ?? auditText('auditExpression.TopBar.text179')) : st.loggedIn === false ? auditText('auditExpression.TopBar.text180') : auditText('auditExpression.TopBar.text181')}`}</small>
      </span>
      {st?.found && st.loggedIn !== true && (
        <button type="button" className="btn btn-primary btn-s" onClick={() => void cliLogin(harness)} data-testid={`cli-login-${harness}`}><IconLogin size={13} />{' '}{auditText('audit.TopBar.signIn')}</button>
      )}
      <button type="button" className="icon-btn" aria-label={auditText('auditExpression.TopBar.text182', { v0: name })} data-tip={auditText('audit.TopBar.checkAgain')} onClick={() => void cliCheck(harness)} data-testid={`cli-check-${harness}`}><IconRefresh size={13} /></button>
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
  const label = !cli ? t('appText.topBar.cliChecking') : bad ? t('appText.topBar.cliLogin') : t('appText.topBar.cliReady');
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
        <MenuLabel>{auditText('audit.TopBar.theClisUsedByTheApp')}</MenuLabel>
        {engines.map(e => <CliRow key={e.id} engine={e} st={cli?.[e.id]} />)}
        <p className="menu-note">{auditText('audit.TopBar.theAppNeverSeesYourCredentials')}</p>
      </Popover>
    </>
  );
}

// Settings has one destination; appearance controls live on that page.
function SettingsButton() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return <>
    <IconButton ref={ref} label={auditText('audit.TopBar.settings')} onClick={() => setOpen(value => !value)} aria-expanded={open} aria-haspopup="menu" testid="settings"><IconSettings /></IconButton>
    <Popover anchor={ref} open={open} onClose={() => setOpen(false)} testid="settings-pop" width={248}>
      <MenuItem onSelect={() => { setOpen(false); openModal('shortcuts'); }} shortcut="Ctrl+/" testid="settings-shortcuts">{auditText('audit.TopBar.keyboardShortcuts')}</MenuItem>
      <MenuItem onSelect={() => { setOpen(false); go({ page: 'impostazioni' }); }} shortcut="Ctrl+," testid="settings-all">{auditText('audit.TopBar.allSettings')}</MenuItem>
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
      <IconButton label={auditText('audit.TopBar.back')} shortcut="Alt+←" onClick={back} disabled={hist <= 0} testid="nav-back"><IconArrowLeft size={14} /></IconButton>
      <IconButton label={auditText('audit.TopBar.forward')} shortcut="Alt+→" onClick={forward} disabled={hist >= len - 1} testid="nav-forward"><IconArrowRight size={14} /></IconButton>
      <IconButton ref={ref} label={auditText('audit.TopBar.recentPlaces')} onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="menu" testid="nav-recent"><IconHistory size={14} /></IconButton>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} align="start" testid="nav-recent-pop" width={260}>
        <MenuLabel>{auditText('audit.TopBar.recent')}</MenuLabel>
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
    <button type="button" className={`bell ${open ? 'on' : ''}`} onClick={toggleCenter} aria-label={auditText('auditExpression.TopBar.text183', { v0: n })} aria-expanded={open}
      data-tip={dnd ? auditText('auditExpression.TopBar.text184') : auditText('auditExpression.TopBar.text185')} data-testid="bell">
      <IconBell size={16} />
      {n > 0 && <span className="bell-n" data-testid="bell-count">{n > 99 ? '99+' : n}</span>}
      {dnd && <span className="bell-dnd" aria-hidden="true" />}
    </button>
  );
}

/** "…": the actions used now and then, always here (2026-10-15, before they moved in and out with the width):
 *  Credenziali. */
function MoreButton() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const run = (f: () => void) => () => { setOpen(false); f(); };
  const toggle = () => setOpen(o => !o);
  return (
    <span className="topbar-more">
      <IconButton ref={ref} label={auditText('auditExpression.TopBar.text188')} data-tip={auditText('auditExpression.TopBar.text190')} onClick={toggle} aria-expanded={open} aria-haspopup="menu" testid="topbar-more"><IconMore /></IconButton>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} testid="topbar-more-pop" width={300}>
        <MenuItem onSelect={run(() => openModal('credentials'))} testid="more-credentials">{auditText('audit.TopBar.environmentCredentials')}</MenuItem>
      </Popover>
    </span>
  );
}

/** Fit steps, applied in order while the bar's actions overflow (2026-10-13, settings pushed off at 1920 px): 1 icon-only
 *  buttons, 2 shorter usage strip, 3 icon-only search / next, 4 no Cursor in the strip, 5 icon-only popups switch and
 *  connectors, 6 (the narrowest windows: 1000 px at 110 % zoom) the language switch as its code only (no globe), the
 *  search without its Ctrl+K hint and tighter gaps. Every action stays on the bar. Read by app.css (data-fit). */
const FIT_STEPS = 6;
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
  const { rows, lessons, error, lessonError } = useWorkflows();
  const flows = useFlows();
  const waiting = useApp(s => s.pending.length + planAskKeys(s).length) + durableAsks(rows, lessons).length + flowAsks(flows.snapshot).length;
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
      {/* the mark only: the name and the version sit in its tooltip, the room went to the bar's actions (the user, 2026-10-12) */}
      <div className="brand" aria-label={version ? `second-brain v${version}` : 'second-brain'} data-tip={version ? `second-brain · v${version}` : 'second-brain'} data-testid="app-version"><span className="brand-mark" aria-hidden="true" /></div>
      <HistoryNav />
      <StatoButton />
      <button type="button" className="search" onClick={() => openModal('palette')} data-testid="topbar-search" aria-label={auditText('audit.TopBar.searchChatsPagesAndCommandsCtrl')}>
        <IconSearch size={14} /><span className="search-text">{auditText('audit.TopBar.searchChatsIdeasOrACommand')}</span><Keys combo="Ctrl+K" />
      </button>
      <span className="sp" />
      <UsageBar />
      {queued > 0 && (
        <button type="button" className="btn btn-m btn-ghost topbar-queue" onClick={() => { if (firstQueued) focusChat(firstQueued); }} data-testid="topbar-queue"
          aria-label={auditText('auditExpression.TopBar.text197', { v0: queued })}
          data-tip={auditText('audit.TopBar.queuedAgentChatsOrMessagesThe')}>
          <span className="queue-label">{auditText('audit.TopBar.queued')}</span><span className="count-badge">{queued}</span>
        </button>
      )}
      {(error || lessonError || flows.error) && <button type="button" className="btn btn-amber btn-s" role="status" onClick={() => { void reloadWorkflows(); void reloadLessons(); void reloadFlows(); }} data-testid="work-queue-retry">{t('cmp.durable.queue.retry')}</button>}
      <CliStatusButton />
      <SyncStatus />
      <button type="button" className={`btn btn-m ${waiting ? 'btn-amber' : 'btn-ghost'} next-btn`} onClick={() => (paused ? openQueue(null) : nextThing())} data-testid="topbar-next" data-queue={inQueue ? '' : undefined} data-paused={paused ? '' : undefined}
        data-tip={inQueue ? auditText('auditExpression.TopBar.text198') : paused ? auditText('auditExpression.TopBar.text199') : auditText('auditExpression.TopBar.text200')}
        aria-label={inQueue ? auditText('auditExpression.TopBar.text201', { v0: waiting }) : paused ? auditText('auditExpression.TopBar.text202') : auditText('auditExpression.TopBar.text203', { v0: waiting })}>
        <IconBolt size={14} /><span className="next-label">{inQueue ? auditText('auditExpression.TopBar.text204') : paused ? auditText('auditExpression.TopBar.text205') : waiting ? auditText('auditExpression.TopBar.text206') : auditText('auditExpression.TopBar.text207')}</span>
        {waiting > 0 && <span className="count-badge" data-testid="topbar-next-count">{waiting}</span>}
      </button>
      <button type="button" className="btn btn-ghost btn-m new-browser" onClick={() => void newBrowser()} data-testid="topbar-new-browser" aria-label={t('ui.newBrowser')} data-tip={t('ui.newBrowser')}><IconGlobe size={14}/><span>{t('ui.newBrowser')}</span></button>
      {/* the one «Manutenzione», always here (owner, 2026-10-23, ADR 0132): its dialog picks the free cleanup or a research */}
      <MaintenanceButton bar testId="topbar-maint" />
      <button type="button" className="btn btn-danger btn-m" onClick={stopAllAsk} disabled={running === 0} data-testid="topbar-stopall" data-tip={auditText('audit.TopBar.stopAllWorkingChatsCtrlShift')}
        aria-label={auditText('auditExpression.TopBar.text208', { v0: running })}>
        <IconStop size={13} /><span>{auditText('audit.TopBar.stopAll')}</span>{running > 0 && <span className="count-badge red">{running}</span>}
      </button>
      </div>
      <div className="topbar-end">
        <LangSwitch />
        <MoreButton />
        <Bell />
        <SettingsButton />
      </div>
    </header>
  );
}
