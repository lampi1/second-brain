// User-opened learned rules and proposal queue; proposals never interrupt the user with a popup.
import { useState } from 'react';
import { inProbation, type AgentProfile } from '@shared/agents';
import type { LearnedRules } from '@shared/agent-pack';
import { sb } from '../sb';
import { t } from '../i18n';
import { refreshAgents } from '../store/agents';
import { requestPack } from '../lib/agent-pack-ui';

export function AgentPackDetails({ profile }: { profile: AgentProfile }) {
  const [rules, setRules] = useState<LearnedRules | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [editing, setEditing] = useState<string | null>(null), [text, setText] = useState('');
  const run = async (action: () => Promise<void>) => { if (busy) return; setBusy(true); setError(''); try { await action(); } catch (e) { setError(`${t('pack.error')} ${e instanceof Error ? e.message : ''}`); } finally { setBusy(false); } };
  const decide = (proposalId: string, decision: 'approve' | 'edit' | 'discard') => run(async () => { setRules(await sb.invoke('agents:learnDecide', { id: profile.id, proposalId, decision, ...(decision === 'edit' ? { text } : {}) })); setEditing(null); await refreshAgents(); });
  // A trial (pack update, approved rule) ends with keep or rollback; a new imported agent ends the shared probation with keep or retire.
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
    <details onToggle={e => { if (e.currentTarget.open) void run(async () => setRules(await sb.invoke('agents:learnList', { id: profile.id }))); }}>
      <summary>{t('pack.learned')}</summary>
      {rules && <><pre>{rules.text}</pre><h4>{t('pack.pending')}</h4>{rules.proposals.length === 0 && <p>{t('pack.none')}</p>}
        {rules.proposals.map(proposal => <section className="pack-proposal" key={proposal.id}><p>{proposal.rule}</p><small>{proposal.evidence}</small>
          {editing === proposal.id ? <><textarea aria-label={t('pack.edit')} maxLength={2000} value={text} onChange={e => setText(e.target.value)} /><button disabled={busy || !text.trim()} type="button" onClick={() => void decide(proposal.id, 'edit')}>{t('pack.applyEdit')}</button></> : <div className="pack-actions"><button disabled={busy} type="button" onClick={() => void decide(proposal.id, 'approve')}>{t('pack.approve')}</button><button disabled={busy} type="button" onClick={() => { setEditing(proposal.id); setText(proposal.rule); }}>{t('pack.edit')}</button><button disabled={busy} type="button" onClick={() => void decide(proposal.id, 'discard')}>{t('pack.discard')}</button></div>}
        </section>)}
      </>}
    </details>
  </div>;
}
