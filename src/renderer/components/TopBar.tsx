// The top bar: brand, back/forward (Alt+←/→) and the recent places, search/palette trigger (Ctrl+K), view toggle
// Mosaico/Corsie (Ctrl+Shift+V), today's cost and the 5-hour limit meter (when known), CLI status (Claude/Cursor found,
// version, login, "Accedi"), "Prossima cosa per te" (Ctrl+J) with the count, "＋ Nuova chat" (Ctrl+N), "■ Ferma tutto"
// (confirm only with >1 running), the notification bell (Ctrl+Shift+N) and the settings menu. Used by App.tsx.
import { useRef, useState } from 'react';
import type { CliStatus, Harness } from '@shared/contract';
import { formatCost, until } from '../lib/format';
import { useNow } from '../lib/clock';
import { runningCount, todayCost } from '../store/state';
import { cliCheck, cliLogin, setSetting, useApp } from '../store/store';
import { openModal, setPrefs, setView, ui, type Density, type Theme } from '../store/ui';
import { back, forward, go, nextThing, recentPlaces, stopAllAsk, toggleCenter } from '../actions';
import { isUnread } from '../lib/notify';
import { placeLabel } from '../store/ui';
import { HarnessMark, IconArrowLeft, IconArrowRight, IconBell, IconBolt, IconColumns, IconGrid, IconHistory, IconLogin, IconPlus, IconRefresh, IconSearch, IconSettings, IconStop } from './Icons';
import { IconButton, Keys, MenuItem, MenuLabel, MenuSep, Popover, Segmented } from './ui';

function UsageMeter() {
  const cost = useApp(s => todayCost(s));
  const usage = useApp(s => s.usage);
  const now = useNow(60_000);
  const pct = usage?.fiveHourPct;
  const tone = pct == null ? '' : pct >= 90 ? 'red' : pct >= 70 ? 'amber' : 'green';
  const tip = [
    usage?.costKnown === false ? `Spesa di oggi non disponibile${usage.costNote ? `: ${usage.costNote}` : ''}` : 'Spesa di oggi (stima a prezzo di listino sugli abbonamenti)',
    usage?.limitsNote ?? null,
    pct != null ? `limite 5 ore al ${pct}%${usage?.fiveHourResetsAt ? `, si azzera ${until(usage.fiveHourResetsAt, now)}` : ''}` : null,
    usage?.weekPct != null ? `settimana al ${usage.weekPct}%` : null,
  ].filter(Boolean).join(' · ');
  return (
    <div className="usage" data-tip={tip} data-testid="usage" tabIndex={0} aria-label={tip}>
      <span className="usage-k">Oggi</span><b className="usage-v" data-testid="usage-today">{usage?.costKnown === false ? 'n/d' : formatCost(cost)}</b>
      {pct != null && (
        <>
          <span className="usage-sep" />
          <span className="usage-k">5 ore</span>
          <span className={`meter meter-${tone}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Limite 5 ore"><b style={{ width: `${Math.min(100, Math.max(2, pct))}%` }} /></span>
          <span className="usage-v">{pct}%</span>
        </>
      )}
    </div>
  );
}

function CliRow({ harness, st }: { harness: Harness; st: CliStatus | undefined }) {
  const name = harness === 'claude' ? 'Claude Code' : 'Cursor';
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
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const bad = cli ? [cli.claude, cli.cursor].some(c => c.found && c.loggedIn === false) : false;
  const label = !cli ? 'CLI: controllo in corso' : bad ? 'CLI: serve un accesso' : 'CLI pronte';
  return (
    <>
      <button ref={ref} type="button" className={`cli-btn ${bad ? 'bad' : ''}`} onClick={() => setOpen(o => !o)} aria-label={label} data-tip={label} aria-expanded={open} data-testid="cli-status">
        {(['claude', 'cursor'] as Harness[]).map(h => {
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
        <CliRow harness="claude" st={cli?.claude} />
        <CliRow harness="cursor" st={cli?.cursor} />
        <p className="menu-note">L'app non vede mai le tue credenziali: «Accedi» apre il login ufficiale in un terminale.</p>
      </Popover>
    </>
  );
}

function SettingsButton() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const density = ui.use(s => s.prefs.density);
  const theme = ui.use(s => s.prefs.theme);
  const cross = useApp(s => s.settings?.messaging?.crossHarness ?? true);
  const set = (patch: { density?: Density; theme?: Theme }) => { setPrefs(patch); setOpen(false); };
  return (
    <>
      <IconButton ref={ref} label="Impostazioni" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="menu" testid="settings"><IconSettings /></IconButton>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} testid="settings-pop" width={248}>
        <MenuLabel>Densità</MenuLabel>
        {(['comfortable', 'compact'] as Density[]).map(d => <MenuItem key={d} checked={density === d} onSelect={() => set({ density: d })} testid={`density-${d}`}>{d === 'compact' ? 'Compatta' : 'Comoda'}</MenuItem>)}
        <MenuSep />
        <MenuLabel>Tema</MenuLabel>
        {(['system', 'dark', 'light'] as Theme[]).map(t => <MenuItem key={t} checked={theme === t} onSelect={() => set({ theme: t })} testid={`theme-${t}`}>{t === 'system' ? 'Come Windows' : t === 'dark' ? 'Scuro' : 'Chiaro'}</MenuItem>)}
        <MenuSep />
        <MenuSep />
        <MenuLabel>Chat</MenuLabel>
        <MenuItem checked={cross} onSelect={() => { setOpen(false); void setSetting({ messaging: { crossHarness: !cross } }); }} testid="settings-cross-harness">Messaggi tra Claude e Cursor</MenuItem>
        <MenuSep />
        <MenuItem onSelect={() => { setOpen(false); openModal('shortcuts'); }} shortcut="Ctrl+/" testid="settings-shortcuts">Scorciatoie da tastiera</MenuItem>
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
  const n = feed.filter(e => isUnread(e, read)).length;
  return (
    <button type="button" className={`bell ${open ? 'on' : ''}`} onClick={toggleCenter} aria-label={`Notifiche: ${n} da leggere (Ctrl+Shift+N)`} aria-expanded={open}
      data-tip={dnd ? 'Notifiche · non disturbare attivo|Ctrl+Shift+N' : 'Notifiche|Ctrl+Shift+N'} data-testid="bell">
      <IconBell size={16} />
      {n > 0 && <span className="bell-n" data-testid="bell-count">{n > 99 ? '99+' : n}</span>}
      {dnd && <span className="bell-dnd" aria-hidden="true" />}
    </button>
  );
}

export function TopBar() {
  const view = ui.use(s => s.prefs.view);
  const waiting = useApp(s => s.pending.length);
  const running = useApp(s => runningCount(s));
  const version = useApp(s => s.info?.version);
  return (
    <header className="topbar" data-testid="topbar">
      <div className="brand" aria-label="second-brain"><span className="brand-mark" aria-hidden="true" /><span>second-brain</span>{version && <span className="brand-ver" data-testid="app-version">v{version}</span>}</div>
      <HistoryNav />
      <button type="button" className="search" onClick={() => openModal('palette')} data-testid="topbar-search" aria-label="Cerca chat, pagine e comandi (Ctrl+K)">
        <IconSearch size={14} /><span className="search-text">Cerca chat, idee o un comando</span><Keys combo="Ctrl+K" />
      </button>
      <Segmented value={view} onChange={setView} label="Vista" testid="view-toggle" options={[
        { value: 'mosaico', label: 'Mosaico', icon: <IconGrid size={14} />, tip: 'Mosaico|Ctrl+Shift+V' },
        { value: 'corsie', label: 'Corsie', icon: <IconColumns size={14} />, tip: 'Corsie|Ctrl+Shift+V' },
      ]} />
      <span className="sp" />
      <UsageMeter />
      <CliStatusButton />
      <button type="button" className={`btn btn-m ${waiting ? 'btn-amber' : 'btn-ghost'} next-btn`} onClick={() => nextThing()} data-testid="topbar-next" data-tip="La cosa più vecchia che ti aspetta|Ctrl+J"
        aria-label={`Prossima cosa per te: ${waiting} (Ctrl+J)`}>
        <IconBolt size={14} /><span className="next-label">{waiting ? 'Prossima cosa per te' : 'Niente ti aspetta'}</span>
        {waiting > 0 && <span className="count-badge" data-testid="topbar-next-count">{waiting}</span>}
      </button>
      <button type="button" className="btn btn-primary btn-m" onClick={() => openModal('newChat')} data-testid="topbar-new" data-tip="Nuova chat|Ctrl+N"><IconPlus size={14} /><span>Nuova chat</span></button>
      <button type="button" className="btn btn-danger btn-m" onClick={stopAllAsk} disabled={running === 0} data-testid="topbar-stopall" data-tip="Ferma tutte le chat al lavoro|Ctrl+Shift+."
        aria-label={`Ferma tutto: ${running} al lavoro (Ctrl+Shift+.)`}>
        <IconStop size={13} /><span>Ferma tutto</span>{running > 0 && <span className="count-badge red">{running}</span>}
      </button>
      <Bell />
      <SettingsButton />
    </header>
  );
}
