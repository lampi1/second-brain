// A role's pack actions on its page (AgentStudio): export of a work role (the role's text, skills, the tools they call and the brain's
// rules, never memory: ADR 0077) and the end of an open trial (keep or roll back). Lessons from corrections are applied
// by the maintenance job, not here.
import { useState } from 'react';
import type { AgentProfile } from '@shared/agents';
import { isWorkRole } from '@shared/roles';
import { sb } from '../sb';
import { t } from '../i18n';
import { refreshAgents } from '../store/agents';
import { requestPack } from '../lib/agent-pack-ui';

export function AgentPackDetails({ profile }: { profile: AgentProfile }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const run = async (action: () => Promise<void>) => { if (busy) return; setBusy(true); setError(''); try { await action(); } catch (e) { setError(`${t('pack.error')} ${e instanceof Error ? e.message : ''}`); } finally { setBusy(false); } };
  // A trial (a pack's skills, a new tier) ends with keep or rollback.
  const decideTrial = (decision: 'keep' | 'rollback') => run(async () => { await sb.invoke('agents:trialDecide', { id: profile.id, decision }); await refreshAgents(); });
  return <div className="pack-details">
    <div className="pack-actions">
      {isWorkRole(profile.id) && <button type="button" className="link-btn" onClick={() => requestPack({ kind: 'export', id: profile.id })}>{t('pack.export')}</button>}
      {profile.trial && <><strong className="pack-badge">{t('pack.trial')}</strong>{(['keep', 'rollback'] as const).map(decision => <button key={decision} type="button" disabled={busy} onClick={() => void decideTrial(decision)}>{t(decision === 'keep' ? 'pack.keepTrial' : 'pack.rollback')}</button>)}</>}
    </div>
    {error && <p role="alert">{error}</p>}
  </div>;
}
