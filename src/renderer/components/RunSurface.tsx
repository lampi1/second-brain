// Home run provenance and explicit human verdicts; main remains authoritative for the run lifecycle.
import { useRef, useState } from 'react';
import type { AgentRun } from '@shared/agents';
import { useAgents } from '../store/agents';
import { sb } from '../sb';
import { t } from '../i18n';
import { HelpTip } from './HelpTip';
import '../styles/run-surface.css';

export function RunChips({ run }: { run: AgentRun }) {
  const { catalog } = useAgents();
  const profile = catalog?.profiles.find(p => p.id === run.agentId);
  return <span className="run-chips" data-testid="run-chips">
    <span className="th-badge" title={t('runs.version')}>v{run.version}</span>
    {run.startedBy === 'orchestrator' && <span className="th-badge" title={t('runs.auto')}>auto</span>}
    {profile?.trial?.version === run.version && <span className="th-badge">{t('pack.trial')}</span>}
  </span>;
}

export function RunOutcomeControl({ run, disabled }: { run: AgentRun; disabled: boolean }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const [saved, setSaved] = useState<AgentRun['outcome']>();
  const working = useRef(false);
  const outcome = saved ?? run.outcome;
  const mark = async (verdict: 'success' | 'partial' | 'fail') => {
    if (working.current || disabled) return;
    working.current = true; setBusy(true); setError(false);
    try { const chat = await sb.invoke('run:outcome', { chatId: run.chatId, verdict }); setSaved(chat.run?.outcome); }
    catch { setError(true); }
    finally { working.current = false; setBusy(false); }
  };
  return <footer className="run-outcome" data-testid="run-outcome">
    <span>{t('runs.outcome')}<HelpTip title={t('explain.outcome.title')} testid="run-outcome-help"><p>{t('explain.outcome.p1')}</p><p>{t('explain.outcome.p2')}</p></HelpTip></span>
    {(['success', 'partial', 'fail'] as const).map(verdict => <button type="button" className="btn btn-ghost btn-s" key={verdict}
      disabled={disabled || busy} aria-pressed={outcome?.basis === 'human' && outcome.verdict === verdict}
      onClick={() => void mark(verdict)} data-testid={`run-outcome-${verdict}`}>
      <span aria-hidden="true">{verdict === 'success' ? '👍 ' : verdict === 'fail' ? '👎 ' : ''}</span>{t(`runs.${verdict}`)}</button>)}
    {outcome?.basis === 'human' && <span role="status">{t('runs.saved')}</span>}
    {error && <span role="alert">{t('runs.error')}</span>}
  </footer>;
}
