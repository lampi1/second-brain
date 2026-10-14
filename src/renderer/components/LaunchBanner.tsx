// The notice under the top bar after a restart (ADR 0020; 2026-10-12: a promoted release was dropped by the launcher
// overnight and nobody was told): either the promoted version started, or it did not and the launcher went back to
// the previous one, with the reason. Shown until the user closes it; main remembers it was told (improve-seen.json),
// so the same fallback is not announced again at every start. Mounted by App.tsx.
import { dismissLaunch, useImprove } from '../store/improve';
import '../styles/improve.css';
import { go } from '../actions';
import { IconAlert, IconCheck, IconX } from './Icons';

export function LaunchBanner() {
  const l = useImprove(s => s?.launch ?? null);
  if (!l) return null;
  const fallback = l.outcome === 'fallback';
  return (
    <div className={`launch-banner ${fallback ? 'warn' : 'ok'}`} role={fallback ? 'alert' : 'status'} data-testid="launch-banner" data-outcome={l.outcome}>
      {fallback ? <IconAlert size={15} /> : <IconCheck size={15} />}
      <div className="launch-text">
        {fallback ? (
          <><b>La versione nuova non è partita.</b> <span className="mono">{l.wanted}</span> {l.reason}: l’app è tornata a <span className="mono">{l.running}</span>.</>
        ) : (
          <><b>Partita la versione nuova</b> <span className="mono">{l.running}</span>.</>
        )}
      </div>
      <button type="button" className="btn btn-ghost btn-s" onClick={() => go({ page: 'migliora' })} data-testid="launch-open">Migliora l’app</button>
      <button type="button" className="icon-btn" aria-label="Chiudi l'avviso" data-tip="Chiudi" onClick={dismissLaunch} data-testid="launch-dismiss"><IconX size={13} /></button>
    </div>
  );
}
