// An agent's pack actions on its page (AgentStudio): export (profile, skills, the tools they call and the brain's rules,
// never memory: ADR 0077) and the end of an open trial or probation. Lessons from corrections are applied by the
// maintenance job, not here (no approval for agent and skill changes).
import { useState } from 'react';
import { inProbation, type AgentProfile } from '@shared/agents';
import { sb } from '../sb';
import { t } from '../i18n';
import { refreshAgents } from '../store/agents';
import { requestPack } from '../lib/agent-pack-ui';

export function AgentPackDetails({ profile }: { profile: AgentProfile }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const run = async (action: () => Promise<void>) => { if (busy) return; setBusy(true); setError(''); try { await action(); } catch (e) { setError(`${t('pack.error')} ${e instanceof Error ? e.message : ''}`); } finally { setBusy(false); } };
  // A trial (pack update) ends with keep or rollback; a new imported agent ends the shared probation with keep or retire.
  const decideTrial = (decision: 'keep' | 'rollback') => run(async () => { await sb.invoke('agents:trialDecide', { id: profile.id, decision }); await refreshAgents(); });
  const decideProbation = (decision: 'keep' | 'retire') => run(async () => { if (decision === 'keep') await sb.invoke('agents:keep', { id: profile.id }); else await sb.invoke('agents:retire', { id: profile.id, reason: t('pack.retireReason') }); await refreshAgents(); });
  return <div className="pack-details">
    <div className="pack-actions">
      {profile.origin.kind === 'preset' && <small className="pack-badge">{t(profile.userLocked || profile.knowhow ? 'pack.mine' : 'pack.preset')}</small>}
      <button type="button" className="link-btn" onClick={() => requestPack({ kind: 'export', id: profile.id })}>{t('pack.export')}</button>
      {profile.trial
        ? <><strong className="pack-badge">{t('pack.trial')}</strong>{(['keep', 'rollback'] as const).map(decision => <button key={decision} type="button" disabled={busy} onClick={() => void decideTrial(decision)}>{t(decision === 'keep' ? 'pack.keepTrial' : 'pack.rollback')}</button>)}</>
        : inProbation(profile) && <><strong className="pack-badge">{t('pack.probation')}</strong>{(['keep', 'retire'] as const).map(decision => <button key={decision} type="button" disabled={busy} onClick={() => void decideProbation(decision)}>{t(decision === 'keep' ? 'pack.keepTrial' : 'pack.retire')}</button>)}</>}
    </div>
    {error && <p role="alert">{error}</p>}
  </div>;
}
