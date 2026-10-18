// The "Da approvare" inbox's presentation (no IPC, no window): one card per pending agent change with what changes,
// why, the numbers before and after (n and coverage), the evidence and the decision buttons. Every write asks for an
// inline confirmation first; the result line offers Annulla when the backend can take the decision back.
// Used by components/AgentApprovals.tsx (which wires the decisions) and by its unit test (static render).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AgentEvidenceRef, AgentProfile, Metric, VersionMetrics } from '@shared/agents';
import { lineDiff, type ApprovalDecision, type ApprovalItem, type ApprovalsState, type ApprovalUndo, type FieldChange } from '../lib/agent-approvals';
import { locale, t } from '../i18n';
import { AgentAvatar } from './AgentAvatar';
import '../styles/agent-approvals.css';

export interface ApprovalDone { text: string; undo: ApprovalUndo | null }
export interface AgentApprovalsViewProps {
  state: ApprovalsState | null; error: boolean; busy: string | null; done: ApprovalDone | null; failure: string | null;
  onDecide(item: ApprovalItem, decision: ApprovalDecision): void;
  /** opens the editor on the proposed definition (definition) or the suggestion's agent (lifecycle); never saves */
  onEdit(item: ApprovalItem): void;
  onUndo(): void; onDismiss(): void; onRefresh(): void;
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

/** Before/after table; a single column when there is nothing to compare with (a new agent in probation). */
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

function Changes({ changes }: { changes: FieldChange[] }) {
  if (!changes.length) return <p className="apv-muted">{t('approvals.noChanges')}</p>;
  return <dl className="apv-changes">{changes.map(c => <div key={c.field} className="apv-change">
    <dt>{t(`approvals.field.${c.field}`)}</dt>
    <dd>{c.field === 'instructions' || c.field === 'manifest'
      ? <pre className="apv-diff" aria-label={t('approvals.diffLabel')}>{lineDiff(c.before ?? '', c.after ?? '').map((l, i) => <span key={i} className={`apv-line ${l.op}`}><span aria-hidden="true">{l.op === 'add' ? '+ ' : l.op === 'del' ? '− ' : '  '}</span><span className="apv-sr">{l.op === 'add' ? t('approvals.added') : l.op === 'del' ? t('approvals.removed') : ''}</span>{l.text || ' '}{'\n'}</span>)}</pre>
      : c.before === null ? <span className="apv-fromto"><ins>{c.after}</ins></span>
        : <span className="apv-fromto"><del>{c.before}</del><span aria-hidden="true"> → </span><span className="apv-sr">{t('approvals.becomes')}</span><ins>{c.after ?? t('approvals.unset')}</ins></span>}</dd>
  </div>)}</dl>;
}

interface Choice { label: string; decision: ApprovalDecision; confirm: string; tone: 'primary' | 'ghost' | 'danger' }
function choices(item: ApprovalItem): Choice[] {
  switch (item.type) {
    case 'definition': {
      const fresh = !item.proposal.agentId;
      return [
        ...(item.stale ? [] : [{ label: t(fresh ? 'approvals.create' : 'approvals.approve'), decision: { type: 'definition', accept: true }, confirm: t(fresh ? 'approvals.confirm.create' : 'approvals.confirm.approve'), tone: 'primary' } as Choice]),
        { label: t(item.stale ? 'approvals.close' : 'approvals.reject'), decision: { type: 'definition', accept: false }, confirm: t('approvals.confirm.reject'), tone: 'ghost' },
      ];
    }
    case 'rule': return [
      { label: t('approvals.approve'), decision: { type: 'rule', decision: 'approve' }, confirm: t('approvals.confirm.rule'), tone: 'primary' },
      { label: t('approvals.discard'), decision: { type: 'rule', decision: 'discard' }, confirm: t('approvals.confirm.discard'), tone: 'ghost' },
    ];
    case 'trial': {
      const keepFirst = item.advice?.kind !== 'revert';
      const keep: Choice = { label: t('approvals.keep'), decision: { type: 'trial', decision: 'keep' }, confirm: t('approvals.confirm.keepTrial', { v: item.agent.trial!.version }), tone: keepFirst ? 'primary' : 'ghost' };
      const back: Choice = { label: t('approvals.rollback', { v: item.agent.trial!.baseline }), decision: { type: 'trial', decision: 'rollback' }, confirm: t('approvals.confirm.rollback', { v: item.agent.trial!.baseline }), tone: keepFirst ? 'ghost' : 'primary' };
      return keepFirst ? [keep, back] : [back, keep];
    }
    case 'probation': return [
      { label: t('approvals.keepAgent'), decision: { type: 'probation', decision: 'keep' }, confirm: t('approvals.confirm.keepAgent'), tone: 'primary' },
      { label: t('approvals.retire'), decision: { type: 'probation', decision: 'retire', reason: t('approvals.retireReason') }, confirm: t('approvals.confirm.retire'), tone: 'ghost' },
    ];
    case 'lifecycle': return [];
  }
}
function title(item: ApprovalItem): string {
  if (item.type === 'definition') return t(item.proposal.agentId ? 'approvals.kind.definition' : 'approvals.kind.new');
  if (item.type === 'lifecycle') return t(`lifecycle.kind.${item.proposal.kind}`);
  return t(`approvals.kind.${item.type}`);
}
const subject = (item: ApprovalItem): { name: string; agent: AgentProfile | null } =>
  item.type === 'definition' ? { name: item.proposal.draft.name, agent: item.agent }
    : item.type === 'lifecycle' ? { name: item.agents.map(a => a.name).join(', ') || t('approvals.toDefine'), agent: item.agents[0] ?? null }
      : { name: item.agent.name, agent: item.agent };

function Body({ item, editing, text, setText }: { item: ApprovalItem; editing: boolean; text: string; setText(v: string): void }) {
  switch (item.type) {
    case 'definition': return <>
      <Section label={t('approvals.why')}><p>{item.proposal.reason}</p></Section>
      {item.proposal.expectedEffect && <Section label={t('approvals.effect')}><p>{item.proposal.expectedEffect}</p></Section>}
      {item.stale && <p className="apv-warn" role="note">{t('approvals.stale')}</p>}
      <Section label={t('approvals.what')}><Changes changes={item.changes} /></Section>
      <Evidence refs={item.proposal.evidence} />
    </>;
    case 'rule': return <>
      <Section label={t('approvals.what')}>{editing
        ? <label className="apv-edit"><span>{t('approvals.ruleText')}</span><textarea value={text} maxLength={2000} rows={3} onChange={e => setText(e.target.value.replace(/[\r\n]+/g, ' '))} autoFocus /></label>
        : <p className="apv-rule"><span aria-hidden="true">+ </span>{item.rule.rule}</p>}
        <p className="apv-muted">{t('approvals.ruleWhere', { name: item.agent.name })}</p></Section>
      <Evidence text={item.rule.evidence} />
    </>;
    case 'trial': return <>
      <Section label={t('approvals.what')}><p>{t('approvals.trialWhat', { v: item.agent.trial!.version, base: item.agent.trial!.baseline, since: when(item.agent.trial!.startedAt) })}</p></Section>
      <Section label={t('approvals.why')}>{item.advice ? <p><span className="apv-tag" data-advice={item.advice.kind}>{t(item.advice.kind === 'keep' ? 'approvals.adviceKeep' : 'approvals.adviceRevert')}</span> {item.reason}</p> : <p className="apv-muted">{item.reason ?? t('approvals.trialWait')}</p>}</Section>
      <Section label={t('approvals.numbers')}><ApprovalNumbers before={item.before} after={item.after} beforeLabel={`v${item.agent.trial!.baseline}`} afterLabel={`v${item.agent.trial!.version}`} /></Section>
      {item.advice && <Evidence refs={item.advice.evidence} />}
    </>;
    case 'probation': {
      const src = item.agent.probation?.source;
      return <>
        <Section label={t('approvals.what')}><p>{src ? t('approvals.imported', { pack: src.packId, rev: src.revision }) : t('approvals.madeForTask')} {t('approvals.since', { at: when(item.agent.probation!.since) })}</p>
          <p className="apv-muted">{item.agent.purpose}</p></Section>
        <Section label={t('approvals.numbers')}><ApprovalNumbers before={null} after={item.metrics} afterLabel={`v${item.agent.activeVersion}`} /></Section>
      </>;
    }
    case 'lifecycle': return <>
      <Section label={t('approvals.why')}><p>{item.proposal.reason}</p></Section>
      {item.proposal.metrics && <Section label={t('approvals.numbers')}><ApprovalNumbers {...item.proposal.metrics} beforeLabel={t('approvals.baseline')} afterLabel={t('approvals.evaluated')} /></Section>}
      <Evidence refs={item.proposal.evidence} />
      <p className="apv-muted">{t('approvals.lifecycleNote')}</p>
    </>;
  }
}
function Section({ label, children }: { label: string; children: ReactNode }) {
  return <div className="apv-section"><h5>{label}</h5>{children}</div>;
}

export function ApprovalCard({ item, busy, locked, onDecide, onEdit }: { item: ApprovalItem; busy: boolean; locked: boolean; onDecide: AgentApprovalsViewProps['onDecide']; onEdit: AgentApprovalsViewProps['onEdit'] }) {
  const [asking, setAsking] = useState<Choice | null>(null), [editing, setEditing] = useState(false), [text, setText] = useState('');
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (asking) confirmRef.current?.focus(); }, [asking]);
  const { name, agent } = subject(item);
  const list = editing && item.type === 'rule'
    ? [{ label: t('approvals.approveEdited'), decision: { type: 'rule', decision: 'edit', text: text.trim() }, confirm: t('approvals.confirm.rule'), tone: 'primary' } as Choice]
    : choices(item);
  const disabled = busy || locked;
  const headId = `apv-${item.key.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  return <article className="apv-card" data-type={item.type} aria-labelledby={headId} aria-busy={busy || undefined} data-testid="approval-card"
    onKeyDown={e => { if (e.key === 'Escape' && asking) { e.stopPropagation(); setAsking(null); } }}>
    <header className="apv-card-head">
      {agent ? <AgentAvatar avatar={agent.avatar} name={agent.name} size={32} /> : item.type === 'definition' ? <AgentAvatar avatar={item.proposal.draft.avatar} name={name} size={32} /> : <span className="apv-dot" aria-hidden="true" />}
      <div><span className="apv-kind">{title(item)}</span><h4 id={headId}>{name}</h4></div>
      <small className="apv-when">{when(item.at)}</small>
    </header>
    <Body item={item} editing={editing} text={text} setText={setText} />
    {asking
      ? <div className="apv-confirm" role="group" aria-label={t('approvals.confirmLabel')}>
        <p>{asking.confirm}</p>
        <div className="apv-actions">
          <button ref={confirmRef} type="button" className={`btn btn-m ${asking.tone === 'primary' ? 'btn-primary' : 'btn-ghost'}`} disabled={disabled} onClick={() => { onDecide(item, asking.decision); setAsking(null); setEditing(false); }}>{t('approvals.confirmDo', { action: asking.label })}</button>
          <button type="button" className="btn btn-m btn-ghost" onClick={() => setAsking(null)}>{t('approvals.back')}</button>
        </div></div>
      : <div className="apv-actions">
        {list.map(c => <button key={c.label} type="button" className={`btn btn-m ${c.tone === 'primary' ? 'btn-primary' : 'btn-ghost'}`} disabled={disabled || (c.decision.type === 'rule' && c.decision.decision === 'edit' && !text.trim())} onClick={() => setAsking(c)}>{c.label}</button>)}
        {item.type === 'rule' && !editing && <button type="button" className="btn btn-m btn-ghost" disabled={disabled} onClick={() => { setText(item.rule.rule); setEditing(true); }}>{t('approvals.editRule')}</button>}
        {item.type === 'definition' && <button type="button" className="btn btn-m btn-ghost" disabled={disabled} onClick={() => onEdit(item)}>{t(item.stale ? 'approvals.openEditor' : 'approvals.editFirst')}</button>}
        {item.type === 'lifecycle' && <button type="button" className="btn btn-m btn-primary" disabled={disabled} onClick={() => onEdit(item)}>{t('approvals.prepare')}</button>}
        {editing && <button type="button" className="btn btn-m btn-ghost" onClick={() => setEditing(false)}>{t('approvals.back')}</button>}
      </div>}
  </article>;
}

export function AgentApprovalsView(p: AgentApprovalsViewProps) {
  const doneRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (p.done) doneRef.current?.focus(); }, [p.done]);
  const items = p.state?.items ?? [];
  // a missing rule list or missing numbers alone never opens the panel; a source that may hide pending changes does
  const problems = (p.state?.problems ?? []).filter(s => items.length || s === 'definitions' || s === 'lifecycle');
  if (!items.length && !problems.length && !p.state?.lifecycleProblem && !p.done && !p.failure && !p.error) return null;
  return <section className="apv" aria-labelledby="apv-title" data-testid="agent-approvals">
    <header className="apv-head">
      <h3 id="apv-title">{t('approvals.title')}{items.length > 0 && <span className="apv-count" data-testid="approvals-count" aria-label={t('approvals.countLabel', { n: items.length })}>{items.length}</span>}</h3>
      <p>{t('approvals.intro')}</p>
      <button type="button" className="btn btn-s btn-ghost" onClick={p.onRefresh}>{t('approvals.refresh')}</button>
    </header>
    {p.done && <div className="apv-done" role="status" tabIndex={-1} ref={doneRef}>
      <span>{p.done.text}</span>
      {p.done.undo && <button type="button" className="btn btn-s btn-ghost" disabled={!!p.busy} onClick={p.onUndo}>{t('approvals.undo')}</button>}
      <button type="button" className="link-btn" onClick={p.onDismiss} aria-label={t('approvals.dismiss')}>×</button>
    </div>}
    {p.failure && <p className="apv-warn" role="alert">{t('approvals.failed', { detail: p.failure })}</p>}
    {p.error && <p className="apv-warn" role="alert">{t('approvals.unavailable')}</p>}
    {problems.map(s => <p key={s} className="apv-warn" role="alert">{t(`approvals.problem.${s}`)}</p>)}
    {p.state?.lifecycleProblem && <p className="apv-warn" role="alert">{p.state.lifecycleProblem}</p>}
    <div className="apv-list">{items.map(item => <ApprovalCard key={item.key} item={item} busy={p.busy === item.key} locked={!!p.busy} onDecide={p.onDecide} onEdit={p.onEdit} />)}</div>
  </section>;
}
