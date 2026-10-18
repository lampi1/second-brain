// Review panel for isolated app proposals. The integrator supplies typed renderer-only IPC callbacks.
// The explicit PR button shares an exact, reviewed commit; requesting or refreshing a proposal never publishes.
import { t as auditText } from '../i18n';
import { useRef, useState } from 'react';
import type { AppProposal, ProposalPublication } from '@shared/improve-proposals';

export interface ProposalPanelProps {
  proposals: AppProposal[];
  publishBlocked: string | null;
  createBlocked: string | null;
  onCreate: () => Promise<void>;
  onRefresh: (id: string) => Promise<void>;
  onResume: (id: string) => Promise<void>;
  onPublish: (request: ProposalPublication) => Promise<void>;
}

export function ProposalPanel({ proposals, publishBlocked, createBlocked, onCreate, onRefresh, onResume, onPublish }: ProposalPanelProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const running = useRef(false);
  const perform = async (action: () => Promise<void>) => {
    if (running.current) return;
    running.current=true;
    setBusy(true); setError(false);
    try { await action(); } catch { setError(true); } finally { running.current=false;setBusy(false); }
  };
  return <section className="imp-card" aria-label={auditText('audit.ProposalPanel.prepareAChange')} data-testid="app-proposals">
    <header className="imp-card-head"><h3>{auditText('audit.ProposalPanel.yourAppTheWayYouNeed')}</h3></header>
    <p>{auditText('audit.ProposalPanel.tellTheChatWhatYouWant')}</p>
    <button type="button" className="btn btn-primary" disabled={busy||!!createBlocked} onClick={() => {if(!createBlocked)void perform(onCreate);}} data-testid="proposal-create">{busy ? auditText('auditExpression.ProposalPanel.text78') : auditText('auditExpression.ProposalPanel.text79')}</button>
    {createBlocked&&<p role="status">{createBlocked}</p>}
    {error && <p role="alert">{auditText('audit.ProposalPanel.operationNotCompletedLocalChangesAre')}</p>}
    {publishBlocked && <p role="status">{auditText('audit.ProposalPanel.sharingUnavailable')}{' '}{publishBlocked}</p>}
    {proposals.map(p => <ProposalReview key={p.id} proposal={p} busy={busy} publishBlocked={!!publishBlocked} resume={() => perform(() => onResume(p.id))} refresh={() => perform(() => onRefresh(p.id))} publish={request => perform(() => onPublish(request))} />)}
  </section>;
}

function ProposalReview({ proposal: p, busy, publishBlocked, resume, refresh, publish }: { proposal: AppProposal; busy: boolean; publishBlocked: boolean; resume: () => Promise<void>; refresh: () => Promise<void>; publish: (request: ProposalPublication) => Promise<void> }) {
  const [ack, setAck] = useState<{head:string|null;diff:string|null}|null>(null);
  const read = !!ack && ack.head===p.head && ack.diff===p.diff;
  const working = p.phase === 'checking' || p.phase === 'publishing';
  const labels = { pending: 'Da eseguire', passed: 'Superata', failed: 'Da risolvere' };
  return <article data-testid={`proposal-${p.id}`} aria-busy={working}>
    <h4>{p.url ? auditText('auditExpression.ProposalPanel.text80') : p.phase === 'ready' ? auditText('auditExpression.ProposalPanel.text81') : working ? auditText('auditExpression.ProposalPanel.text82') : auditText('auditExpression.ProposalPanel.text83')}</h4>
    <ul aria-label={auditText('audit.ProposalPanel.checks')}>
      <li>{auditText('audit.ProposalPanel.functionality')}{' '}{labels[p.quality.state]}</li><li>{auditText('audit.ProposalPanel.confidentialData')}{' '}{labels[p.privacy.state]}</li><li>{auditText('audit.ProposalPanel.correctnessSecurityAndUsabilityReviews')}{' '}{labels[p.reviews.state]}</li>
    </ul>
    {p.problem && <p role="status">{p.problem}</p>}
    {p.diff !== null && <details data-testid="proposal-diff"><summary>{auditText('audit.ProposalPanel.whatWouldChange')}{p.files.length}{' '}{auditText('audit.ProposalPanel.files')}</summary><ul>{p.files.map(f => <li key={f}>{f}</li>)}</ul><pre className="imp-log">{p.diff}</pre></details>}
    {!p.url && <>
      <button type="button" className="btn btn-ghost" disabled={busy || working} onClick={() => void resume()}>{auditText('audit.ProposalPanel.openTheChangeChat')}</button>
      <button type="button" className="btn btn-ghost" disabled={busy || working} onClick={() => void refresh()}>{auditText('audit.ProposalPanel.refreshChangesAndChecks')}</button>
      {p.phase === 'ready' && <label className="check"><input type="checkbox" checked={read} onChange={e => setAck(e.target.checked?{head:p.head,diff:p.diff}:null)} />{auditText('audit.ProposalPanel.iHaveReviewedTheDiffI')}</label>}
      <button type="button" className="btn btn-primary" data-testid="proposal-pr" disabled={publishBlocked || busy || working || !read || p.phase !== 'ready' || !p.head} onClick={() => { if (!publishBlocked && p.head) void publish({ id: p.id, reviewedHead: p.head }); }}>{auditText('audit.ProposalPanel.openPrOnGithub')}</button>
      <p>{auditText('audit.ProposalPanel.thisButtonSendsTheChangeTo')}</p>
    </>}
    {p.url && <p role="status">{p.publication === 'closed' ? auditText('auditExpression.ProposalPanel.text84') : p.publication === 'merged' ? auditText('auditExpression.ProposalPanel.text85') : auditText('auditExpression.ProposalPanel.text86')}: <a href={p.url} target="_blank" rel="noreferrer">{auditText('audit.ProposalPanel.reviewTheChangeOnGithub')}</a></p>}
  </article>;
}
