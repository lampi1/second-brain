// "Stato": the answer to "a che punto siamo / come siamo messi" in one click, with zero tokens: a one-sentence headline,
// then every open chat (state, name, folder and git branch, last line, what it waits for from the user) and the user's
// open PRs from the last DevOps read (who each waits for, build, votes, QA-blocked). A chat row brings that chat on
// screen, a waiting question opens that card; the button opens the Task page. Only data the app already holds (lib/stato.ts) plus
// the folders' branches read from disk ('chat:branches'): no model, no new network call. Opened from the Orchestrator's head
// (OrchestratorTile.tsx), the command palette and Ctrl+Shift+S. Used by App.tsx (modal 'stato').
import { t as auditText } from '../i18n';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../store/store';
import { closeModal, ui } from '../store/ui';
import { useTasks } from '../store/tasks';
import { sameList } from '../store/state';
import { useNow } from '../lib/clock';
import { ago } from '../lib/format';
import { buildStato, headline, type StatoChat, type StatoPr } from '../lib/stato';
import { IconExternal, type Tone } from '../brain/components/ui';
import { focusChat, focusRequest, go } from '../actions';
import { HarnessMark, IconAlert, IconQuestion } from './Icons';
import { HelpTip } from './HelpTip';
import { Keys, Modal } from './ui';
import '../styles/stato.css';

const PILL: Record<Tone, string> = { good: 'done', warn: 'wait', bad: 'err', blue: 'run', violet: 'orchestrator', outline: 'off', neutral: 'off', '': 'off' };

function ChatRow({ c, now }: { c: StatoChat; now: number }) {
  const open = () => { closeModal(); focusChat(c.id); };
  return (
    <li className={`stato-chat tone-${c.state.tone}`} data-testid={`stato-chat-${c.id}`}>
      <button type="button" className="stato-row" onClick={open} title={auditText('audit.StatoDialog.goToChat')}>
        <HarnessMark harness={c.harness} orchestrator={c.orchestrator} size={18} />
        <span className="stato-main">
          <span className="stato-line1">
            <span className="stato-name">{c.name}</span>
            <span className={`pill pill-${c.state.tone}`}><span className="pill-dot" />{c.state.label}</span>
            {c.app && <span className="pill pill-off">{auditText('audit.StatoDialog.appCode')}</span>}
            <span className="sp" />
            <span className="stato-age">{ago(c.updatedAt, now)}</span>
          </span>
          <span className="stato-where" data-testid={`stato-branch-${c.id}`}>{c.folder}{c.branch ? <> · <b>{c.branch}</b></> : null}</span>
          {c.lastLine && <span className="stato-last">{c.lastLine}</span>}
        </span>
      </button>
      {c.asks.length > 0 && (
        <ul className="stato-asks">
          {c.asks.map(a => (
            <li key={a.key}>
              <button type="button" className="stato-ask" onClick={() => { closeModal(); focusRequest(a.req); }} data-testid={`stato-ask-${a.key}`}>
                <IconQuestion size={13} />
                <span className="stato-ask-k">{a.kind === 'permission' ? auditText('auditExpression.StatoDialog.text159') : a.kind === 'command' ? auditText('auditExpression.StatoDialog.text160') : auditText('auditExpression.StatoDialog.text161')}</span>
                <span className="stato-ask-t">{a.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function PrRow({ p }: { p: StatoPr }) {
  return (
    <li className="stato-pr" data-testid={`stato-pr-${p.id}`}>
      <div className="stato-line1">
        <a className="stato-name" href={p.url} target="_blank" rel="noopener noreferrer" title={auditText('audit.StatoDialog.openThePrInDevops')}>{p.name} <IconExternal /></a>
        <span className="sp" />
        <span className="stato-age">{p.repo}</span>
      </div>
      {p.qa && <div className="stato-qa" data-testid={`stato-qa-${p.id}`}><IconAlert size={13} />{' '}{auditText('audit.StatoDialog.blockedByQa')}{' '}{p.qa}</div>}
      <div className="stato-pills">
        <span className={`pill pill-${PILL[p.wait.tone]}`}>{p.wait.text}</span>
        {p.build && <a className={`pill pill-${PILL[p.build.tone]}`} href={p.build.url} target="_blank" rel="noopener noreferrer" title={auditText('audit.StatoDialog.openTheBuildInDevops')}>{p.build.label}</a>}
        {p.reviewers.map(r => <span key={r.name} className={`pill pill-${PILL[r.tone]}`} data-tip={r.required ? auditText('auditExpression.StatoDialog.text162') : auditText('auditExpression.StatoDialog.text163')}>{r.name}: {r.vote}</span>)}
      </div>
    </li>
  );
}

export function StatoDialog() {
  const chats = useApp(s => s.chats);
  const order = useApp(s => s.order);
  const pending = useApp(s => s.pending);
  const hidden = ui.use(s => s.hidden, sameList);
  const tasks = useTasks(s => s);
  const now = useNow(15_000);
  const [branches, setBranches] = useState<Record<string, string | null>>({});
  const cwds = useMemo(() => [...new Set(order.map(id => chats[id]).filter(c => c && !c.closedAt).map(c => c!.cwd))].sort(), [chats, order]);
  const cwdKey = cwds.join('\n');
  // read once per set of folders (git HEAD from disk, in main): cheap, and a branch rarely changes while it is open
  useEffect(() => {
    let live = true;
    void window.sb.invoke('chat:branches', { cwds }).then(b => { if (live) setBranches(b); }, () => {});
    return () => { live = false; };
  }, [cwdKey]);
  const s = useMemo(() => buildStato({ chats, order, pending, hidden, branches, tasks }), [chats, order, pending, hidden, branches, tasks]);
  const toTasks = () => { closeModal(); go({ page: 'task' }); };
  return (
    <Modal onClose={closeModal} label={auditText('audit.StatoDialog.status')} testid="stato" className="modal-stato">
      <div className="modal-head">
        <h2>{auditText('audit.StatoDialog.status')}</h2>
        <span className="stato-headline" data-testid="stato-headline">{headline(s)}</span>
        <span className="sp" />
        <Keys combo="Esc" />
      </div>
      <div className="modal-body stato-body">
        <section aria-label={auditText('audit.StatoDialog.chat')}>
          <h3 className="stato-h">{auditText('audit.StatoDialog.chat')}{' '}<span className="count">{s.chats.length}</span>{s.counts.asks > 0 && <span className="stato-h-note">{s.counts.asks} {s.counts.asks === 1 ? auditText('auditExpression.StatoDialog.text164') : auditText('auditExpression.StatoDialog.text165')}</span>}</h3>
          {s.chats.length ? <ul className="stato-list">{s.chats.map(c => <ChatRow key={c.id} c={c} now={now} />)}</ul> : <p className="stato-empty">{auditText('audit.StatoDialog.noOpenChats')}</p>}
        </section>
        <section aria-label={auditText('audit.StatoDialog.myPrs')}>
          <div className="stato-h"><h3 className="stato-h-t">{auditText('audit.StatoDialog.myPrs')}{' '}<span className="count">{s.prs.length}</span></h3>
            <HelpTip label={auditText('audit.StatoDialog.myPrs')} testid="stato-help-prs">{auditText('audit.StatoDialog.forEachPrWhoNeedsTo')}</HelpTip>
            <span className="stato-h-note" data-testid="stato-tasks-at">{s.tasks.read ? auditText('auditExpression.StatoDialog.text166', { v0: ago(s.tasks.at!, now) === auditText('auditExpression.StatoDialog.text167') ? auditText('auditExpression.StatoDialog.text167') : auditText('auditExpression.StatoDialog.text168', { v0: ago(s.tasks.at!, now) }) }) : auditText('auditExpression.StatoDialog.text169')}</span>
            <span className="sp" />
            <button type="button" className="btn btn-ghost btn-s" onClick={toTasks} data-testid="stato-open-tasks">{auditText('audit.StatoDialog.openTasks')}</button>
          </div>
          {s.tasks.error && <p className="stato-qa"><IconAlert size={13} /> {s.tasks.error}</p>}
          {s.prs.length ? <ul className="stato-list">{s.prs.map(p => <PrRow key={p.id} p={p} />)}</ul>
            : <p className="stato-empty">{s.tasks.read ? auditText('auditExpression.StatoDialog.text170') : auditText('auditExpression.StatoDialog.text171')}</p>}
        </section>
      </div>
    </Modal>
  );
}
