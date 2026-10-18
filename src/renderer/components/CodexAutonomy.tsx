// Explicit repository-scoped Codex consent in Settings. Uses the protected proposal/confirm IPC, never settings:set.
import { useState } from 'react';
import type { SettingProposal, SettingRequestResult } from '@shared/contract';
import { t } from '../i18n';

export interface AutonomyPort {
  pick(): Promise<string | null>;
  propose(roots: string[]): Promise<SettingRequestResult>;
  confirm(id: string, accept: boolean): Promise<unknown>;
}
const port: AutonomyPort = {
  pick: () => window.sb.invoke('app:pickRepo', undefined),
  propose: roots => window.sb.invoke('settings:propose', { key: 'codexAutonomyRoots', value: roots }),
  confirm: (proposalId, accept) => window.sb.invoke('settings:confirm', { proposalId, accept }),
};
/** Cancellation is a no-op; backend proposal validation canonicalizes and bounds every selected root. */
export async function proposeAutonomy(roots: string[], remove: string | null, bridge: AutonomyPort): Promise<SettingProposal | null> {
  const selected = remove === null ? await bridge.pick() : null;
  if (remove === null && (!selected || roots.includes(selected))) return null;
  const result = await bridge.propose(remove === null ? [...roots, selected!] : roots.filter(root => root !== remove));
  if ('error' in result) throw new Error(result.error);
  if (!('proposal' in result)) throw new Error('Conferma non disponibile');
  return result.proposal;
}
export function CodexAutonomy({ roots, bridge = port }: { roots: string[]; bridge?: AutonomyPort }) {
  const [pending, setPending] = useState<SettingProposal | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const run = async (action: () => Promise<void>) => {
    if (busy) return; setBusy(true); setError('');
    try { await action(); } catch { setError(t('autonomy.error')); } finally { setBusy(false); }
  };
  return <section className="st-autonomy" aria-label={t('autonomy.title')} data-testid="codex-autonomy">
    <h3>{t('autonomy.title')}</h3><p className="st-desc">{t('autonomy.hint')}</p>
    {roots.length ? <ul>{roots.map(root => <li key={root}><code>{root}</code><button type="button" className="btn btn-ghost" disabled={busy || !!pending} aria-label={`${t('autonomy.remove')} ${root}`} onClick={() => void run(async () => setPending(await proposeAutonomy(roots, root, bridge)))}>{t('autonomy.remove')}</button></li>)}</ul> : <p>{t('autonomy.empty')}</p>}
    <button type="button" className="btn" disabled={busy || !!pending || roots.length >= 32} onClick={() => void run(async () => setPending(await proposeAutonomy(roots, null, bridge)))}>{t('autonomy.add')}</button>
    {pending && <div className="st-autonomy-confirm" role="group" aria-label={t('autonomy.confirm')}><p>{t('autonomy.confirmHint')}</p><ul>{(pending.after as string[]).map(root => <li key={root}><code>{root}</code></li>)}</ul>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run(async () => { await bridge.confirm(pending.id, true); setPending(null); })}>{t('autonomy.confirm')}</button>
      <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void run(async () => { await bridge.confirm(pending.id, false); setPending(null); })}>{t('common.cancel')}</button>
    </div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
