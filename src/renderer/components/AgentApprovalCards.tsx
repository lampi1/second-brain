// The "Da approvare" inbox's presentation (no IPC, no window): one card per pending role change (an open trial, a tier
// suggestion, a Battito proposal, ADR 0102) with what changes, why, the numbers before and after (n and coverage), the evidence and the decision
// buttons. Every write asks for an inline confirmation first.
// Used by components/AgentApprovals.tsx (which wires the decisions) and by its unit test (static render).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AgentEvidenceRef, AgentProfile, Metric, VersionMetrics } from '@shared/agents';
import type { AgentLifecycleProposal } from '@shared/agent-lifecycle';
import type { ApprovalDecision, ApprovalItem, ApprovalsState } from '../lib/agent-approvals';
import { locale, t } from '../i18n';
import { AgentAvatar } from './AgentAvatar';
import '../styles/agent-approvals.css';

export interface ApprovalDone { text: string }
export interface AgentApprovalsViewProps {
  state: ApprovalsState | null; error: boolean; busy: string | null; done: ApprovalDone | null; failure: string | null;
  onDecide(item: ApprovalItem, decision: ApprovalDecision): void;
  onDismiss(): void; onRefresh(): void;
}

const when = (at: number) => new Date(at).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' });

function value(m: Metric | undefined, unit: 'pct' | 'usd' | 'dur' | 'num'): string {
  if (!m || m.value === null) return '—';
  const v = m.value;
  if (unit === 'pct') return `${Math.round(v * 100)}%`;
  if (unit === 'usd') return `$${v.toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (unit === 'dur') return v >= 60_000 ? t('approvals.minutes', { n: Math.round(v / 60_000) }) : t('approvals.seconds', { n: Math.max(1, Math.round(v / 1000)) });
  return v.toLocaleString(locale(), { maximumFractionDigits: 1 });
}
const basis = (m: Metric | undefined) => !m || m.value === null ? t('approvals.noData') : t('approvals.basis', { n: m.n, coverage: m.coverage === null ? '—' : `${Math.round(m.coverage * 100)}%` });
const ROWS = [
  ['success', (m: VersionMetrics) => m.successRate, 'pct', 1],
  ['cost', (m: VersionMetrics) => m.costPerRun.median, 'usd', -1],
  ['time', (m: VersionMetrics) => m.timeToDone.elapsed, 'dur', -1],
  ['questions', (m: VersionMetrics) => m.questionsPerRun, 'num', -1],
  ['corrections', (m: VersionMetrics) => m.correctionsPerRun, 'num', -1],
] as const;

/** Before/after table; a single column when there is nothing to compare with. */
export function ApprovalNumbers({ before, after, beforeLabel, afterLabel }: { before: VersionMetrics | null; after: VersionMetrics | null; beforeLabel?: string; afterLabel: string }) {
  if (!before && !after) return <p className="apv-muted">{t('approvals.noRuns')}</p>;
  const two = beforeLabel !== undefined;
  return <div className="apv-numbers"><table>
    <caption className="apv-sr">{t('approvals.numbers')}</caption>
    <thead><tr><th scope="col">{t('approvals.metric')}</th>{two && <th scope="col">{beforeLabel}</th>}<th scope="col">{afterLabel}</th>{two && <th scope="col">{t('approvals.change')}</th>}</tr></thead>
    <tbody>{ROWS.map(([key, pick, unit, better]) => {
      const b = before ? pick(before) : undefined, a = after ? pick(after) : undefined;
      const delta = b?.value != null && a?.value != null && b.value !== a.value ? Math.sign(a.value - b.value) : 0;
      return <tr key={key}><th scope="row">{t(`approvals.m.${key}`)}</th>
        {two && <td><strong>{value(b, unit)}</strong><small>{basis(b)}</small></td>}
        <td><strong>{value(a, unit)}</strong><small>{basis(a)}</small></td>
        {two && <td>{delta === 0 ? <span className="apv-muted">{b?.value != null && a?.value != null ? t('approvals.same') : '—'}</span>
          : <span className="apv-delta" data-good={delta === better}>{delta > 0 ? '▲' : '▼'} {t(delta === better ? 'approvals.better' : 'approvals.worse')}</span>}</td>}
      </tr>;
    })}</tbody></table>
    <p className="apv-muted">{t('approvals.ended', { before: before?.ended ?? 0, after: after?.ended ?? 0 })}</p></div>;
}

function Evidence({ refs, text }: { refs?: AgentEvidenceRef[]; text?: string }) {
  const n = refs?.length ?? (text ? 1 : 0);
  return <details className="apv-evidence"><summary>{t('approvals.evidence', { n })}</summary>
    {text ? <p>{text}</p> : n ? <ul>{refs!.map((e, i) => <li key={i}><span className="apv-tag">{e.kind}</span> <code>{e.ref}</code> <small>{when(e.at)}</small></li>)}</ul> : <p className="apv-muted">{t('approvals.evidenceNone')}</p>}
  </details>;
}

interface Choice { label: string; decision: ApprovalDecision; confirm: string; tone: 'primary' | 'ghost' | 'danger' }
function choices(item: ApprovalItem): Choice[] {
  if (item.type === 'pulse') return [
    { label: t('alive.approval.apply'), decision: { type: 'pulse', decision: 'approve' }, confirm: t('alive.approval.confirmApply'), tone: 'primary' },
    { label: t('alive.approval.discard'), decision: { type: 'pulse', decision: 'discard' }, confirm: t('alive.approval.confirmDiscard'), tone: 'ghost' },
  ];
  if (item.type === 'trial') {
    const keepFirst = item.advice?.kind !== 'revert';
    const keep: Choice = { label: t('approvals.keep'), decision: { type: 'trial', decision: 'keep' }, confirm: t('approvals.confirm.keepTrial', { v: item.agent.trial!.version }), tone: keepFirst ? 'primary' : 'ghost' };
    const back: Choice = { label: t('approvals.rollback', { v: item.agent.trial!.baseline }), decision: { type: 'trial', decision: 'rollback' }, confirm: t('approvals.confirm.rollback', { v: item.agent.trial!.baseline }), tone: keepFirst ? 'ghost' : 'primary' };
    return [...(keepFirst ? [keep, back] : [back, keep]), ...ignore(item.advice, 'approvals.confirm.ignoreTrial')];
  }
  return [{ label: t('approvals.startTrial'), decision: { type: 'queue', decision: 'approve' }, confirm: t('approvals.confirm.tierTrial', { tier: t(`roles.tier.${item.proposal.tier ?? 'mid'}`) }), tone: 'primary' },
    ...ignore(item.proposal, 'approvals.confirm.ignoreSuggestion')];
}
/** Ignora = the queue's dismiss: the advice or suggestion leaves the list for a while; nothing on the role changes. */
function ignore(entry: AgentLifecycleProposal | null, confirm: 'approvals.confirm.ignoreTrial' | 'approvals.confirm.ignoreSuggestion'): Choice[] {
  return entry ? [{ label: t('approvals.ignore'), decision: { type: 'queue', decision: 'dismiss' }, confirm: t(confirm), tone: 'ghost' }] : [];
}
const title = (item: ApprovalItem): string => (item.type === 'lifecycle' ? t('approvals.kind.tier') : item.type === 'pulse' ? t('alive.approval.kind') : t('approvals.kind.trial'));
const subject = (item: ApprovalItem): { name: string; agent: AgentProfile | null } =>
  item.type === 'lifecycle' ? { name: item.agents.map(a => a.name).join(', '), agent: item.agents[0] ?? null }
    : item.type === 'pulse' ? { name: item.agent?.name ?? item.proposal.title, agent: item.agent } : { name: item.agent.name, agent: item.agent };

function Body({ item }: { item: ApprovalItem }) {
  if (item.type === 'pulse') return <>
    <Section label={t('approvals.what')}><p><b>{item.proposal.title}</b></p><p>{item.proposal.text}</p></Section>
    <details className="apv-evidence"><summary>{t('alive.approval.evidence', { n: item.proposal.evidence.length })}</summary><ul>{item.proposal.evidence.map(e => <li key={e}><code>{e}</code></li>)}</ul></details>
  </>;
  if (item.type === 'trial') return <>
    <Section label={t('approvals.what')}><p>{t('approvals.trialWhat', { v: item.agent.trial!.version, base: item.agent.trial!.baseline, since: when(item.agent.trial!.startedAt) })}</p></Section>
    <Section label={t('approvals.why')}>{item.advice ? <p><span className="apv-tag" data-advice={item.advice.kind === 'keep' ? 'keep' : 'revert'}>{t(item.advice.kind === 'keep' ? 'approvals.adviceKeep' : 'approvals.adviceRevert')}</span> {item.reason}</p> : <p className="apv-muted">{item.reason ?? t('approvals.trialWait')}</p>}</Section>
    <Section label={t('approvals.numbers')}><ApprovalNumbers before={item.before} after={item.after} beforeLabel={`v${item.agent.trial!.baseline}`} afterLabel={`v${item.agent.trial!.version}`} /></Section>
    {item.advice && <Evidence refs={item.advice.evidence} />}
  </>;
  const p = item.proposal;
  return <>
    <Section label={t('approvals.why')}><p>{p.reason}</p></Section>
    {p.tier && <Section label={t('approvals.what')}><p>{t('approvals.tierWhat', { tier: t(`roles.tier.${p.tier}`), skills: p.skills?.length ? p.skills.join(', ') : t('approvals.noSkills') })}</p></Section>}
    {p.metrics && <Section label={t('approvals.numbers')}><ApprovalNumbers {...p.metrics} beforeLabel={t('approvals.baseline')} afterLabel={t('approvals.evaluated')} /></Section>}
    <Evidence refs={p.evidence} />
    <p className="apv-muted">{t('approvals.tierNote')}</p>
  </>;
}
function Section({ label, children }: { label: string; children: ReactNode }) {
  return <div className="apv-section"><h5>{label}</h5>{children}</div>;
}

export function ApprovalCard({ item, busy, locked, onDecide }: { item: ApprovalItem; busy: boolean; locked: boolean; onDecide: AgentApprovalsViewProps['onDecide'] }) {
  const [asking, setAsking] = useState<Choice | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (asking) confirmRef.current?.focus(); }, [asking]);
  const { name, agent } = subject(item);
  const list = choices(item);
  const disabled = busy || locked;
  const headId = `apv-${item.key.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  return <article className="apv-card" data-type={item.type} aria-labelledby={headId} aria-busy={busy || undefined} data-testid="approval-card"
    onKeyDown={e => { if (e.key === 'Escape' && asking) { e.stopPropagation(); setAsking(null); } }}>
    <header className="apv-card-head">
      {agent ? <AgentAvatar avatar={agent.avatar} name={agent.name} size={32} /> : <span className="apv-dot" aria-hidden="true" />}
      <div><span className="apv-kind">{title(item)}</span><h4 id={headId}>{name}</h4></div>
      <small className="apv-when">{when(item.at)}</small>
    </header>
    <Body item={item} />
    {asking
      ? <div className="apv-confirm" role="group" aria-label={t('approvals.confirmLabel')}>
        <p>{asking.confirm}</p>
        <div className="apv-actions">
          <button ref={confirmRef} type="button" className={`btn btn-m ${asking.tone === 'primary' ? 'btn-primary' : 'btn-ghost'}`} disabled={disabled} onClick={() => { onDecide(item, asking.decision); setAsking(null); }}>{t('approvals.confirmDo', { action: asking.label })}</button>
          <button type="button" className="btn btn-m btn-ghost" onClick={() => setAsking(null)}>{t('approvals.back')}</button>
        </div></div>
      : <div className="apv-actions">
        {list.map(c => <button key={c.label} type="button" className={`btn btn-m ${c.tone === 'primary' ? 'btn-primary' : 'btn-ghost'}`} disabled={disabled} onClick={() => setAsking(c)}>{c.label}</button>)}
      </div>}
  </article>;
}

export function AgentApprovalsView(p: AgentApprovalsViewProps) {
  const doneRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (p.done) doneRef.current?.focus(); }, [p.done]);
  const items = p.state?.items ?? [];
  // missing numbers alone never open the panel; a source that may hide pending changes does
  const problems = (p.state?.problems ?? []).filter(s => items.length || s === 'lifecycle');
  if (!items.length && !problems.length && !p.state?.lifecycleProblem && !p.done && !p.failure && !p.error) return null;
  return <section className="apv" aria-labelledby="apv-title" data-testid="agent-approvals">
    <header className="apv-head">
      <h3 id="apv-title">{t('approvals.title')}{items.length > 0 && <span className="apv-count" data-testid="approvals-count" aria-label={t('approvals.countLabel', { n: items.length })}>{items.length}</span>}</h3>
      <p>{t('approvals.intro')}</p>
      <button type="button" className="btn btn-s btn-ghost" onClick={p.onRefresh}>{t('approvals.refresh')}</button>
    </header>
    {p.done && <div className="apv-done" role="status" tabIndex={-1} ref={doneRef}>
      <span>{p.done.text}</span>
      <button type="button" className="link-btn" onClick={p.onDismiss} aria-label={t('approvals.dismiss')}>×</button>
    </div>}
    {p.failure && <p className="apv-warn" role="alert">{t('approvals.failed', { detail: p.failure })}</p>}
    {p.error && <p className="apv-warn" role="alert">{t('approvals.unavailable')}</p>}
    {problems.map(s => <p key={s} className="apv-warn" role="alert">{t(`approvals.problem.${s}`)}</p>)}
    {p.state?.lifecycleProblem && <p className="apv-warn" role="alert">{p.state.lifecycleProblem}</p>}
    <div className="apv-list">{items.map(item => <ApprovalCard key={item.key} item={item} busy={p.busy === item.key} locked={!!p.busy} onDecide={p.onDecide} />)}</div>
  </section>;
}
