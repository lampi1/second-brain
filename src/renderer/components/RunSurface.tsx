// Run provenance and explicit human verdicts for ChatTile. Automatic observations are labeled unverified proxies.
import { useRef, useState } from 'react';
import type { AgentRun } from '@shared/agents';
import { FACTS_SETTLE_MS, factsVerdict, reworkedWithin } from '@shared/run-verdict';
import { useAgents } from '../store/agents';
import { useApp } from '../store/store';
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
  // the earliest run (among the chats the app still has) that reworks or continues this one: enough for the 7-day check
  const rework = useApp(s => {
    let first: number | null = null;
    for (const c of Object.values(s.chats)) if (c.run && (c.run.reworkOf === run.runId)) first = Math.min(first ?? c.run.startedAt, c.run.startedAt);
    return first;
  });
  const starts = rework === null ? [] : [rework];
  const facts = outcome?.basis === 'human' && outcome.verdict !== 'unknown' ? null : factsVerdict(run, starts, Date.now());
  const mark = async (verdict: 'success' | 'partial' | 'fail') => {
    if (working.current || disabled) return;
    working.current = true; setBusy(true); setError(false);
    try { const chat = await sb.invoke('run:outcome', { chatId: run.chatId, verdict }); setSaved(chat.run?.outcome); }
    catch { setError(true); }
    finally { working.current = false; setBusy(false); }
  };
  return <footer className="run-outcome" data-testid="run-outcome">
    <span>{t('runs.outcome')}<HelpTip title={t('explain.outcome.title')} guide="runs" testid="run-outcome-help"><p>{t('explain.outcome.p1')}</p><p>{t('explain.outcome.p2')}</p><p>{t('explain.outcome.p3')}</p></HelpTip></span>
    {(['success', 'partial', 'fail'] as const).map(verdict => <button type="button" className="btn btn-ghost btn-s" key={verdict}
      disabled={disabled || busy} aria-pressed={outcome?.basis === 'human' && outcome.verdict === verdict}
      onClick={() => void mark(verdict)} data-testid={`run-outcome-${verdict}`}>
      <span aria-hidden="true">{verdict === 'success' ? '👍 ' : verdict === 'fail' ? '👎 ' : ''}</span>{t(`runs.${verdict}`)}</button>)}
    {outcome?.basis === 'human' && <span role="status">{t('runs.saved')}</span>}
    {facts === 'success' && <span className="run-facts" data-testid="run-facts" data-facts="success">{t('runs.facts.success')}</span>}
    {facts === 'provisional' && <span className="run-facts" data-testid="run-facts" data-facts="provisional">{t('runs.facts.provisional', { until: new Date(run.endedAt! + FACTS_SETTLE_MS) })}</span>}
    {facts === 'fail' && <span className="run-facts" data-testid="run-facts" data-facts="fail">{t(reworkedWithin(run, starts) ? 'runs.facts.reworked' : 'runs.facts.blocked')}</span>}
    {error && <span role="alert">{t('runs.error')}</span>}
  </footer>;
}
