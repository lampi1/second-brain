// The banner shown under the top bar whenever the app has no usable brain folder (first run, an unreadable
// config.json, a folder without the brain's tools): it says why in one line and opens the native folder chooser with
// one click (invoke 'app:pickBrain'). Live check 2026-10-11: the stable copy started without its brain and every brain
// section showed an error with no way to fix it from the app. Mounted by App.tsx.
import { useState } from 'react';
import { sb } from '../sb';
import { refreshInfo, useApp } from '../store/store';

export function BrainSetupBanner() {
  const problem = useApp(s => s.info?.brainProblem ?? null);
  const loaded = useApp(s => !!s.info);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!loaded || !problem) return null;
  const pick = async () => {
    setBusy(true); setError(null);
    try {
      await sb.invoke('app:pickBrain', undefined);
      // the brain module restarts on brainRoot; give it a moment, then ask again what is missing
      setTimeout(() => { void refreshInfo(); }, 1200);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="brain-setup" role="alert" data-testid="brain-setup">
      <div className="brain-setup-text">
        <b>Il cervello non è collegato.</b> <span>{problem}.</span>
        {error && <span className="brain-setup-err"> {error}</span>}
      </div>
      <button type="button" className="btn btn-primary btn-s" onClick={() => void pick()} disabled={busy} data-testid="brain-setup-pick">
        {busy ? 'Apro…' : 'Scegli la cartella del cervello'}
      </button>
    </div>
  );
}
