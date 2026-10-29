// The Proposte card's before/after (ADR 0195): a candidate version of the brain shows the findings it gathers, its
// zero-token checks and its replay, then one diff per file it changes; a revised role text shows the role's text now
// against the trial one. The diff is the file viewer's own (brain/pages/FileDiff.tsx DiffView: jsdiff in a worker,
// side by side or unified, the layout remembered), so nothing new is drawn here. Only the top card mounts the diffs
// (a worker each). Used by ProposalsDeck.tsx.
import { useMemo } from 'react';
import type { Proposal, ProposalDiff } from '@shared/proposals';
import { isRoleId, roleName } from '@shared/roles';
import { DiffView } from '../../brain/pages/FileDiff';
import { t } from '../../i18n';
import '../../brain/brain.css';

type CandidateAsk = Extract<Proposal['ask'], { kind: 'candidate' }>;

/** The findings a candidate gathers, its checks and its replay, in words. */
export function CandidateBody({ a, top }: { a: CandidateAsk; top: boolean }) {
  const status = a.replay.status ? t(`proposals.candidate.status.${a.replay.status}`) : '';
  return <div className="pd-research pd-candidate" data-testid={top ? 'pd-candidate' : undefined}>
    <div className="pd-rs"><span className="pd-label">{t('proposals.candidate.items')}</span>
      <ul className="pd-cand-items">{a.items.map((x, i) => <li key={i}><span className={`pd-cand-kind pd-g-${x.finding === 'forget' ? 'forget' : x.finding === 'skill' ? 'skill' : 'rule'}`} aria-hidden="true" />{x.title}</li>)}</ul></div>
    <div className="pd-rs"><span className="pd-label">{t('proposals.candidate.checks')}</span>
      <ul className="pd-cand-checks">{a.checks.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
    <div className="pd-rs" data-testid={top ? 'pd-candidate-replay' : undefined}><span className="pd-label">{t('proposals.candidate.replay')}{status && <span className={`pd-cand-status pd-cand-${a.replay.status}`}>{status}</span>}</span>
      <p>{a.replay.note}</p></div>
  </div>;
}

function OneDiff({ d, label }: { d: ProposalDiff; label: string }) {
  const diff = useMemo(() => ({ kind: 'diff' as const, path: d.file, left: { label: t('proposals.diff.before'), text: d.before ?? '' }, right: { label: t('proposals.diff.after'), text: d.after ?? '' } }), [d]);
  return <details className="pd-diff-file" open>
    <summary><code>{label}</code>{d.before === null && <span className="pd-diff-tag pd-diff-new">{t('proposals.diff.new')}</span>}{d.after === null && <span className="pd-diff-tag pd-diff-gone">{t('proposals.diff.removed')}</span>}</summary>
    <div className="pd-scroll pd-diff-body"><DiffView diff={diff} /></div>
  </details>;
}

/** Every file's before and after; `role`: the diff is a role's text (its file is the role id). */
export function ProposalDiffs({ diffs, role }: { diffs: readonly ProposalDiff[]; role?: boolean }) {
  return <section className="pd-diffs" aria-label={t('proposals.diff.title')} data-testid="pd-diffs">
    <span className="pd-label">{t('proposals.diff.title')}</span>
    {diffs.map(d => <OneDiff key={d.file} d={d} label={role && isRoleId(d.file) ? t('proposals.diff.role', { role: roleName(d.file) }) : d.file} />)}
  </section>;
}
