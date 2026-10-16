// The brain-sync status in the top bar (ADR 0059): shown only when a domain of the brain syncs with a remote. A dot
// (green synced, amber syncing, red stopped) and, on click, each domain: where it lives (all PCs / only this one), last
// sync, commits to send and to receive, and why it stopped. A conflict waits here for the user's choice: «Tieni la mia»,
// «Tieni la loro», «Apri entrambe» (the two versions open, sync still stopped); never resolved by itself. «Sincronizza
// ora» runs a sync at once. Reads sync:get and the sync:state event; acts through sync:now / sync:resolve. Used by
// TopBar.tsx; words in lib/sync.ts.
import { useEffect, useRef, useState } from 'react';
import type { SyncChoice, SyncState } from '@shared/contract';
import { sb } from '../sb';
import { useNow } from '../lib/clock';
import { blockLines, blockTitle, domainLine, scopeLabel, syncSummary } from '../lib/sync';
import { IconRefresh } from './Icons';
import { MenuLabel, Popover } from './ui';

export function SyncStatus() {
  const [st, setSt] = useState<SyncState | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  const now = useNow(30_000);
  useEffect(() => {
    let live = true;
    void sb.invoke('sync:get', undefined).then(s => { if (live) setSt(s); }).catch(() => { /* older main: no sync */ });
    const off = sb.on('sync:state', s => setSt(s));
    return () => { live = false; off(); };
  }, []);
  const sum = syncSummary(st);
  if (!sum.show) return null;
  const act = async (key: string, f: () => Promise<SyncState>) => {
    setBusy(key); setErr(null);
    try { setSt(await f()); } catch (e) { setErr(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)); } finally { setBusy(null); }
  };
  const choose = (domain: string, choice: SyncChoice) => act(`${domain}:${choice}`, () => sb.invoke('sync:resolve', { domain, choice }));
  return (
    <>
      <button ref={ref} type="button" className={`cli-btn sync-btn ${sum.tone}`} onClick={() => setOpen(o => !o)} aria-label={sum.label} data-tip={sum.label} aria-expanded={open} data-testid="sync-status" data-tone={sum.tone}>
        <span className={`sync-dot ${sum.tone}`} aria-hidden="true" />
        <span className="sync-label">{sum.tone === 'bad' ? 'Sync ferma' : sum.tone === 'busy' ? 'Sync…' : 'Sync'}</span>
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} testid="sync-pop" width={360}>
        <MenuLabel>Domini del cervello</MenuLabel>
        {st!.domains.map(d => (
          <div key={d.name} className="sync-domain" data-testid={`sync-domain-${d.name}`} data-state={d.state}>
            <div className="sync-head">
              <span className={`sync-dot ${d.state === 'blocked' ? 'bad' : d.state === 'syncing' ? 'busy' : d.state === 'off' ? 'off' : 'ok'}`} aria-hidden="true" />
              <b>{d.name}</b><small>{scopeLabel(d)}</small>
            </div>
            <small className="sync-line">{domainLine(d, now)}</small>
            {d.blocked && (
              <div className="sync-block" data-testid={`sync-block-${d.name}`} data-kind={d.blocked.kind}>
                <b>{blockTitle(d.blocked)}</b>
                <ul>{blockLines(d.blocked).map((l, i) => <li key={i}>{l}</li>)}</ul>
                {d.blocked.kind === 'conflict' && (
                  <div className="sync-actions">
                    <button type="button" className="btn btn-primary btn-s" disabled={!!busy} onClick={() => void choose(d.name, 'mine')} data-testid={`sync-mine-${d.name}`}>Tieni la mia</button>
                    <button type="button" className="btn btn-ghost btn-s" disabled={!!busy} onClick={() => void choose(d.name, 'theirs')} data-testid={`sync-theirs-${d.name}`}>Tieni la loro</button>
                    <button type="button" className="btn btn-ghost btn-s" disabled={!!busy} onClick={() => void choose(d.name, 'both')} data-testid={`sync-both-${d.name}`}>Apri entrambe</button>
                  </div>
                )}
                {d.blocked.kind === 'conflict' && d.blocked.copies?.length ? <small className="sync-line">Aperte {d.blocked.copies.length} copie: scegli poi quale tenere.</small> : null}
              </div>
            )}
            {d.state !== 'off' && (
              <button type="button" className="btn btn-ghost btn-s sync-now" disabled={!!busy || d.state === 'syncing'} onClick={() => void act(`${d.name}:now`, () => sb.invoke('sync:now', { domain: d.name }))} data-testid={`sync-now-${d.name}`}>
                <IconRefresh size={12} /> Sincronizza ora
              </button>
            )}
          </div>
        ))}
        {err && <p className="menu-note sync-err" role="alert">{err}</p>}
        <p className="menu-note">I domini «su tutti i tuoi PC» si sincronizzano da soli; prima di ogni invio il controllo cerca dati di lavoro e segreti.</p>
      </Popover>
    </>
  );
}
