// "Stato": the answer to "a che punto siamo / come siamo messi" in one click, with zero tokens: a one-sentence headline,
// then every open chat (state, name, folder and git branch, last line, what it waits for from the user) and the user's
// open PRs from the last DevOps read (who each waits for, build, votes, QA-blocked). A chat row brings that chat on
// screen, a waiting question opens that card; a PR opens in DevOps. Only data the app already holds (lib/stato.ts) plus
// the folders' branches read from disk ('chat:branches'): no model, no new network call. Opened from the Regia's head
// (RegiaTile.tsx), the command palette and Ctrl+Shift+S. Used by App.tsx (modal 'stato').
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../store/store';
import { closeModal, ui } from '../store/ui';
import { useDevops } from '../store/devops';
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

const PILL: Record<Tone, string> = { good: 'done', warn: 'wait', bad: 'err', blue: 'run', violet: 'regia', outline: 'off', neutral: 'off', '': 'off' };

function ChatRow({ c, now }: { c: StatoChat; now: number }) {
  const open = () => { closeModal(); focusChat(c.id); };
  return (
    <li className={`stato-chat tone-${c.state.tone}`} data-testid={`stato-chat-${c.id}`}>
      <button type="button" className="stato-row" onClick={open} title="Vai alla chat">
        <HarnessMark harness={c.harness} regia={c.regia} size={18} />
        <span className="stato-main">
          <span className="stato-line1">
            <span className="stato-name">{c.name}</span>
            <span className={`pill pill-${c.state.tone}`}><span className="pill-dot" />{c.state.label}</span>
            {c.app && <span className="pill pill-off">Migliora l’app</span>}
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
                <span className="stato-ask-k">{a.kind === 'permission' ? 'Permesso' : a.kind === 'command' ? 'Comando' : 'Domanda'}</span>
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
        <a className="stato-name" href={p.url} target="_blank" rel="noopener noreferrer" title="Apri la PR in DevOps">{p.name} <IconExternal /></a>
        <span className="sp" />
        <span className="stato-age">{p.repo}</span>
      </div>
      {p.qa && <div className="stato-qa" data-testid={`stato-qa-${p.id}`}><IconAlert size={13} /> Bloccata dalla QA: {p.qa}</div>}
      <div className="stato-pills">
        <span className={`pill pill-${PILL[p.wait.tone]}`}>{p.wait.text}</span>
        {p.build && <a className={`pill pill-${PILL[p.build.tone]}`} href={p.build.url} target="_blank" rel="noopener noreferrer" title="Apri la build in DevOps">{p.build.label}</a>}
        {p.reviewers.map(r => <span key={r.name} className={`pill pill-${PILL[r.tone]}`} data-tip={r.required ? 'Revisore obbligatorio' : 'Revisore facoltativo'}>{r.name}: {r.vote}</span>)}
      </div>
    </li>
  );
}

export function StatoDialog() {
  const chats = useApp(s => s.chats);
  const order = useApp(s => s.order);
  const pending = useApp(s => s.pending);
  const hidden = ui.use(s => s.hidden, sameList);
  const devops = useDevops(s => s);
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
  const s = useMemo(() => buildStato({ chats, order, pending, hidden, branches, devops }), [chats, order, pending, hidden, branches, devops]);
  const toDevops = () => { closeModal(); go({ page: 'devops' }); };
  return (
    <Modal onClose={closeModal} label="Stato" testid="stato" className="modal-stato">
      <div className="modal-head">
        <h2>Stato</h2>
        <span className="stato-headline" data-testid="stato-headline">{headline(s)}</span>
        <span className="sp" />
        <Keys combo="Esc" />
      </div>
      <div className="modal-body stato-body">
        <section aria-label="Chat">
          <h3 className="stato-h">Chat <span className="count">{s.chats.length}</span>{s.counts.asks > 0 && <span className="stato-h-note">{s.counts.asks} {s.counts.asks === 1 ? 'richiesta ti aspetta' : 'richieste ti aspettano'}</span>}</h3>
          {s.chats.length ? <ul className="stato-list">{s.chats.map(c => <ChatRow key={c.id} c={c} now={now} />)}</ul> : <p className="stato-empty">Nessuna chat aperta.</p>}
        </section>
        <section aria-label="Le mie PR">
          <div className="stato-h"><h3 className="stato-h-t">Le mie PR <span className="count">{s.prs.length}</span></h3>
            <HelpTip label="Le mie PR" testid="stato-help-prs">
              Per ogni PR: chi deve muoversi adesso (tu o i revisori), la build e il voto di ogni revisore. «Bloccata dalla QA» = un test collegato è fallito o bloccato: tocca a te.
            </HelpTip>
            <span className="stato-h-note" data-testid="stato-devops-at">{s.devops.read ? `DevOps letto ${ago(s.devops.at!, now) === 'ora' ? 'ora' : `${ago(s.devops.at!, now)} fa`}` : 'DevOps non ancora letto'}</span>
            <span className="sp" />
            <button type="button" className="btn btn-ghost btn-s" onClick={toDevops} data-testid="stato-open-devops">Apri DevOps</button>
          </div>
          {s.devops.error && <p className="stato-qa"><IconAlert size={13} /> {s.devops.error}</p>}
          {s.prs.length ? <ul className="stato-list">{s.prs.map(p => <PrRow key={p.id} p={p} />)}</ul>
            : <p className="stato-empty">{s.devops.read ? 'Nessuna PR aperta.' : 'Apri la pagina DevOps e premi «Aggiorna ora»: le PR compaiono qui.'}</p>}
        </section>
      </div>
    </Modal>
  );
}
