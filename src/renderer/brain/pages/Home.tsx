// The Grindhouse (page id 'home') is the one place for the agents, beside the persistent Orchestrator (SPEC 19):
// actionable requests, then the agents' strips (components/AgentStrips.tsx), grouped and ordered by the Orchestrator
// (lib/agent-order.ts: by area, start order inside a group; never by the user); focus mode opens from a strip.
// Requests keep the existing review/answer flow; nothing here sends or approves anything by itself.
import { useApp } from '../../store/store';
import { isBusy, sameList } from '../../store/state';
import { focusRequest } from '../../actions';
import { openModal } from '../../store/ui';
import { IconPlus } from '../../components/Icons';
import { t } from '../../i18n';
import { AgentStrips, AgentStripsActions } from '../../components/AgentStrips';
import { orchestratorIdOf } from '../../lib/regia-route';
import './home.css';

export function Home({ nav }: { nav: (target: string) => void }) {
  const chats = useApp(s => s.order.flatMap(id => { const c = s.chats[id]; return c && !c.closedAt && id !== orchestratorIdOf(s) ? [c] : []; }), sameList);
  const orchestrator = useApp(s => { const id = orchestratorIdOf(s); return id ? s.chats[id]?.title ?? null : null; });
  const byId = new Map(chats.map(c => [c.id, c]));
  const pending = useApp(s => [...s.pending].sort((a, b) => a.at - b.at), sameList);
  const working = chats.filter(isBusy).length;
  return <div className="home-page" data-testid="home">
    <header className="home-heading">
      <span className="home-eyebrow">{t('home.title')}</span>
      <h1>{t('home.greeting', { name: 'Brother' })}</h1>
      <p>{t('home.activityLead')}</p>
      <div className="home-overview"><span><i className={working ? 'home-live-dot' : ''} />{t('home.workingCount', { count: working })}</span><span>{t('home.reviewCount', { count: pending.length })}</span></div>
    </header>
    <section className="home-section home-waiting" aria-labelledby="home-waiting-title">
      <div className="home-section-head"><h2 id="home-waiting-title">{t('home.waiting')}</h2><span className="home-count">{pending.length}</span></div>
      {pending.length ? <div className="home-request-list">{pending.map(req => <button type="button" key={`${req.chatId}/${req.id}`} className="home-request" onClick={() => focusRequest(req)} data-testid={`home-request-${req.id}`}>
        <span className="home-request-icon" aria-hidden="true">{req.type === 'command' ? '›_' : req.type === 'permission' ? '◇' : '?'}</span>
        <span className="home-row-copy"><strong>{req.title}</strong><small>{byId.get(req.chatId)?.title || orchestrator || t('home.orchestrator')} · {req.type === 'command' ? t('home.commandReview') : req.type === 'permission' ? t('home.permissionReview') : t('home.questionReview')}</small></span>
        <span className="home-row-arrow" aria-hidden="true">↗</span>
      </button>)}</div> : <p className="home-calm">{t('home.clear')}</p>}
    </section>
    <section className="home-section" aria-labelledby="home-agents-title">
      <div className="home-section-head"><h2 id="home-agents-title">{t('home.agents')}</h2><span className="home-count">{chats.length}</span><span className="sp" /><AgentStripsActions /><button type="button" className="btn btn-ghost btn-s" onClick={() => openModal('newChat')}><IconPlus size={14} /> {t('home.newAgent')}</button></div>
      <AgentStrips />
    </section>
    <footer className="home-footer"><button type="button" className="btn btn-ghost btn-s" onClick={() => nav('agenti')}>{t('home.manageAgents')}</button><button type="button" className="btn btn-ghost btn-s" onClick={() => nav('mappa')}>{t('home.map')} ↗</button><span className="sp" /><span>{t('home.regiaBeside')}</span></footer>
  </div>;
}
