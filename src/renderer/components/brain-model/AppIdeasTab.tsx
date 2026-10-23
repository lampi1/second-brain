// Memoria → «Idee dell'app» (ADR 0132): the ideas and bugs about the app's own code that the maintenance found (a
// research, or the log step at zero tokens), each with its GitHub issue already written. «Apri issue» hands one to the
// Orchestrator as the user's request, «Apri tutte» every open one in one message; «Scarta» drops one (a bug from a log
// group also marks that group known, so it is not carded again). An issue already asked stays listed, marked. The
// issue's text is shown as it will be opened (title, labels, body). Rendered by MemoryPage.tsx.
import { useMemo, useState } from 'react';
import type { ResearchProposal } from '@shared/maintenance-research';
import { t } from '../../i18n';
import { renderMarkdown } from '../../lib/markdown';
import { openChatRef } from '../../actions';
import { toast } from '../../store/ui';
import { app } from '../../store/store';
import { dismissIdea, openIssues, refreshIdeas, useAppIdeas } from '../../store/maintenance';
import { shortWhen } from './ProposalsDeck';
import '../../styles/app-ideas.css';

const iso = (ms: number) => new Date(ms).toISOString();

function Idea({ p, onOpen, busy }: { p: ResearchProposal; onOpen: (ids: string[]) => void; busy: boolean }) {
  const [show, setShow] = useState(false);
  const html = useMemo(() => (show && p.issue ? renderMarkdown(p.issue.body) : ''), [show, p.issue]);
  const asked = p.state === 'issue-asked';
  const bug = p.kind === 'app-bug';
  const dismiss = async () => { const err = await dismissIdea(p.id); if (err) toast(err, 'err'); };
  return <article className={`ai-card${asked ? ' asked' : ''}`} data-kind={bug ? 'bug' : 'idea'} data-testid="ai-card" data-id={p.id}>
    <header className="ai-head">
      <span className="ai-kind">{bug ? t('ai.kind.bug') : p.kind === 'bold' ? t('ai.kind.bold') : t('ai.kind.idea')}</span>
      <span className="ai-from">{p.chatId ? t('ai.from.research') : t('ai.from.logs')}</span>
      <time dateTime={iso(p.at)}>{shortWhen(iso(p.at))}</time>
      {asked && <span className="ai-asked" data-testid="ai-asked">{t('ai.asked')}</span>}
    </header>
    <h3 className="ai-title">{p.title}</h3>
    <div className="ai-delta">
      {p.adds && <p className="ai-add"><b>{t('proposals.research.adds')}</b>{p.adds}</p>}
      {p.removes && <p className="ai-del"><b>{t('proposals.research.removes')}</b>{p.removes}</p>}
    </div>
    <p className="ai-why"><b>{t('proposals.research.why')}</b>{p.why}</p>
    {p.issue && <section className="ai-issue" aria-label={t('ai.issue')}>
      <div className="ai-issue-head">
        <span className="ai-gh" aria-hidden="true">#</span>
        <b className="ai-issue-title" data-testid="ai-issue-title">{p.issue.title}</b>
        {p.issue.labels?.map(l => <span key={l} className="ai-label">{l}</span>)}
      </div>
      {p.issue.duplicateOf && <p className="ai-dup">{t('ai.dup', { n: p.issue.duplicateOf.number })} <a href={p.issue.duplicateOf.url} target="_blank" rel="noreferrer">↗</a></p>}
      <button type="button" className="ai-show" aria-expanded={show} onClick={() => setShow(s => !s)} data-testid="ai-show">{show ? t('ai.hideIssue') : t('ai.showIssue')}</button>
      {show && <div className="md ai-body" data-testid="ai-body" dangerouslySetInnerHTML={{ __html: html }} />}
    </section>}
    <footer className="ai-foot">
      {p.chatId && <button type="button" className="btn btn-s btn-ghost" onClick={() => openChatRef(p.chatId!)}>{t('ai.openChat')}</button>}
      <span className="sp" />
      <button type="button" className="btn btn-s btn-ghost" onClick={() => void dismiss()} data-testid="ai-dismiss">{t('ai.dismiss')}</button>
      {asked
        ? <button type="button" className="btn btn-s btn-ghost" disabled={busy} onClick={() => onOpen([p.id])} data-tip={t('ai.againTip')} data-testid="ai-again">{t('ai.again')}</button>
        : <button type="button" className="btn btn-s btn-primary" disabled={busy} onClick={() => onOpen([p.id])} data-testid="ai-open">{t('ai.open')}</button>}
    </footer>
  </article>;
}

export function AppIdeasTab() {
  const { ideas, error } = useAppIdeas();
  const [busy, setBusy] = useState(false);
  const live = app.use(s => Object.values(s.chats).some(c => c.isOrchestrator && !c.closedAt));
  const open = (ideas?.items ?? []).filter(p => p.state === 'open' && p.issue);
  const send = async (ids: string[]) => {
    setBusy(true);
    const err = await openIssues(ids);
    setBusy(false);
    if (err === null) {
      toast(ids.length === 1 ? t('ai.sentOne') : t('ai.sentMany', { n: ids.length }), 'ok');
      const o = Object.values(app.get().chats).find(c => c.isOrchestrator && !c.closedAt);
      if (o) openChatRef(o.id);
    } else toast(err || t('ai.notSent'), 'err');
  };
  if (!ideas) return error
    ? <p className="bm-empty" role="alert">{error} <button type="button" className="btn btn-s" onClick={() => void refreshIdeas()}>{t('ai.retry')}</button></p>
    : <p className="bm-empty">{t('bm.loading')}</p>;
  return <section className="ai" data-testid="app-ideas">
    <header className="ai-top">
      <div><h2>{t('ai.title')}</h2><p className="ai-lead">{t('ai.lead')}</p></div>
      <button type="button" className="btn btn-m btn-primary" disabled={busy || !open.length || !(ideas.orchestrator || live)} onClick={() => void send(open.map(p => p.id))}
        data-tip={!(ideas.orchestrator || live) ? t('ai.needOrchestrator') : undefined} data-testid="ai-open-all">{t('ai.openAll', { n: open.length })}</button>
    </header>
    {!(ideas.orchestrator || live) && open.length > 0 && <p className="ai-note" role="note">{t('ai.needOrchestrator')}</p>}
    {ideas.items.length ? <div className="ai-list">{ideas.items.map(p => <Idea key={p.id} p={p} busy={busy || !(ideas.orchestrator || live)} onOpen={ids => void send(ids)} />)}</div>
      : <div className="ai-empty" data-testid="ai-empty"><h3>{t('ai.empty.title')}</h3><p>{t('ai.empty.lead')}</p></div>}
  </section>;
}
