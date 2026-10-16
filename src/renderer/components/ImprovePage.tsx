// "Migliora l'app" (ADR 0020; the user, 2026-10-12: "voglio che un punto forte del mio prodotto sia proprio la
// possibilità che gli utenti se lo migliorino e customizzino come vogliono"): the section where the user changes their
// own app. Top: the version in use and the "Aggiorna" button (on only when main holds something new and the code folder
// is clean; why not, in one line), with the promotion's progress. Left: the section's own Regia (one chat, separate
// from the work Regia), or a button to create it. Right: the changes (branches) by stage, In lavoro → Testata →
// Approvata → In uso, and the app chats; one of them opens in a tile below. Rendered by App.tsx (PageFrame).
// Words, not hashes (the user, 2026-10-15: numbers he did not understand): the version in use is a date, "Aggiorna"
// says how many changes it brings and which, each stage says what happens next; hashes and branch names stay in tooltips.
import { useEffect } from 'react';
import type { ImproveBranch, ImproveStage, ImproveState } from '@shared/contract';
import { ago } from '../lib/format';
import { useNow } from '../lib/clock';
import { sameList } from '../store/state';
import { useApp } from '../store/store';
import { ui } from '../store/ui';
import { askPromote, createAppRegia, improveUi, refreshImprove, showAppChat, useImprove } from '../store/improve';
import { go } from '../actions';
import { ChatTile } from './ChatTile';
import { HarnessMark, IconCheck, IconRefresh, IconSparkle, IconX } from './Icons';
import { StatePill } from './ui';
import { HelpTip } from './HelpTip';
import '../styles/improve.css';

const STAGES: { id: ImproveStage; label: string; hint: string }[] = [
  { id: 'work', label: 'In lavoro', hint: 'una chat ci sta lavorando, test non ancora verdi' },
  { id: 'tested', label: 'Pronta da unire', hint: 'test leggeri verdi: la Regia dell’app la unisce' },
  { id: 'approved', label: 'Entra al prossimo «Aggiorna»', hint: 'già unita, non ancora nella versione che usi' },
  { id: 'promoted', label: 'Già nell’app', hint: 'nella versione che stai usando' },
];

const when = (t: number) => new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(t)).replace(', ', ' alle ');
const changes = (n: number) => `${n} ${n === 1 ? 'modifica' : 'modifiche'}`;

/** "del 14/10 alle 18:30" for the version in use; the release id only in its tooltip */
function versionText(s: ImproveState): string {
  if (s.running === 'dev') return 'di sviluppo (dal codice)';
  return s.runningAt ? `del ${when(s.runningAt)}` : 'senza data';
}

/** What "Aggiorna" brings: the merged changes not in use yet (by their last commit's subject), else main's last commit. */
function candidateText(s: ImproveState, approved: ImproveBranch[]): string {
  if (!approved.length) return s.candidate?.subject ?? '';
  const names = approved.slice(0, 2).map(b => b.subject).join(', ');
  return approved.length === 3 ? `${names} e un’altra` : approved.length > 3 ? `${names} e altre ${approved.length - 2}` : names;
}

function PromoteBar({ s }: { s: ImproveState }) {
  const p = s.promote;
  const busy = p?.state === 'running' || p?.state === 'restarting';
  const approved = s.branches.filter(b => b.stage === 'approved');
  const label = s.candidate && approved.length ? `Aggiorna (${changes(approved.length)})` : 'Aggiorna';
  return (
    <div className="imp-top" data-testid="improve-top">
      <div className="imp-ver">
        <span className="imp-line">
          <span className="imp-k">Versione in uso</span>
          <b data-testid="improve-running" data-tip={s.running === 'dev' ? undefined : `Codice della versione: ${s.running}`}>{versionText(s)}</b>
        </span>
        {s.candidate && (
          <span className="imp-cand" data-testid="improve-candidate" data-tip={`Ultima modifica in main: ${s.candidate.sha}`}>
            Pronta una versione nuova{approved.length ? <> con {changes(approved.length)}</> : null}: {candidateText(s, approved)}
            {s.candidate.checkAt ? <span className="imp-ok"> · test completi verdi</span> : <span className="imp-dim"> · i test completi li fa «Aggiorna»</span>}
          </span>
        )}
      </div>
      <span className="sp" />
      <button type="button" className="btn btn-primary btn-m imp-promote" disabled={!s.canPromote || busy} onClick={() => askPromote(s)} data-testid="improve-promote"
        data-tip={s.canPromote ? `Testa, copia e riavvia l’app sulla versione nuova${s.candidate ? ` (${s.candidate.sha})` : ''}` : s.promoteWhy}>
        <IconSparkle size={14} /><span>{busy ? 'Aggiornamento in corso…' : label}</span>
      </button>
      <HelpTip label="Aggiorna" title="Aggiorna" testid="improve-help-promote">
        Fa girare tutti i test su main, copia la versione nuova accanto a quella in uso e riavvia l'app su di essa. La versione di prima resta salvata: si può tornare indietro.
      </HelpTip>
      {!s.canPromote && !busy && !s.repoProblem && <p className="imp-why" data-testid="improve-why">{s.promoteWhy}</p>}
    </div>
  );
}

function PromoteProgress({ s }: { s: ImproveState }) {
  const p = s.promote;
  if (!p) return null;
  const tone = p.state === 'error' ? 'err' : p.state === 'running' ? 'run' : 'ok';
  return (
    <div className={`imp-run ${tone}`} role="status" data-testid="improve-progress" data-state={p.state}>
      <div className="imp-run-head">
        {p.state === 'error' ? <IconX size={14} /> : p.state === 'running' ? <span className="imp-spin" aria-hidden="true" /> : <IconCheck size={14} />}
        <b>{p.step}</b>
        {p.version && <span className="mono"> · {p.version}</span>}
      </div>
      {p.log && <pre className="imp-log" data-testid="improve-log">{p.log.split(/\r?\n/).slice(-14).join('\n')}</pre>}
    </div>
  );
}

/** "modificata ora" / "modificata 5 min fa" */
const agoText = (t: number, now: number) => { const a = ago(t, now); return a === 'ora' ? 'modificata ora' : `modificata ${a} fa`; };

function BranchRow({ b, now }: { b: ImproveBranch; now: number }) {
  return (
    <li className={`imp-branch st-${b.stage}`} data-testid={`improve-branch-${b.name}`} data-stage={b.stage}>
      <span className="imp-dot" aria-hidden="true" />
      <span className="imp-bsub" data-tip={`Ramo git ${b.name} · ${b.sha}`}>{b.subject}</span>
      {b.chatId
        ? <button type="button" className="link-btn imp-bchat" onClick={() => showAppChat(b.chatId!)} data-testid={`improve-branch-chat-${b.name}`} data-tip="Apri la chat che ci lavora">{b.chatTitle}</button>
        : <span className="imp-bchat" />}
      <span className="imp-age">{agoText(b.at, now)}</span>
    </li>
  );
}

function Changes({ s }: { s: ImproveState }) {
  const now = useNow(30_000);
  return (
    <section className="imp-card" aria-label="Modifiche" data-testid="improve-changes">
      <header className="imp-card-head"><h3>Modifiche</h3>
        <HelpTip label="Modifiche e rami" title="Un ramo per modifica" testid="improve-help-branches">
          Ogni modifica vive su un suo ramo git, lavorato da una chat dell’app. Passa da In lavoro a Pronta da unire (test leggeri verdi), poi Entra al prossimo «Aggiorna» (unita in main) e infine Già nell’app (nella versione che usi). Accanto a ogni modifica: la chat che ci lavora e quando è cambiata l’ultima volta (il nome del ramo è nel suggerimento).
        </HelpTip>
        <span className="sp" />
        <button type="button" className="icon-btn" aria-label="Rileggi i rami" data-tip="Rileggi i rami" onClick={refreshImprove} data-testid="improve-refresh"><IconRefresh size={13} /></button>
      </header>
      {s.branches.length === 0 && <p className="imp-empty">Nessun ramo nelle ultime due settimane: chiedi alla Regia dell’app cosa vuoi cambiare.</p>}
      {STAGES.map(st => {
        const list = s.branches.filter(b => b.stage === st.id);
        if (!list.length) return null;
        return (
          <div key={st.id} className="imp-stage" data-testid={`improve-stage-${st.id}`}>
            <div className="imp-stage-head"><span className={`imp-pill st-${st.id}`}>{st.label} ({list.length})</span><span className="imp-hint">{st.hint}</span>{st.id === 'tested' && (
              <HelpTip label="Test leggeri e test completi" title="Test leggeri e completi" testid="improve-help-tests">
                <p><b>Leggeri</b>, sul ramo: tipi, lint e solo i test dell'area cambiata. Bastano per unire il ramo in main.</p>
                <p><b>Completi</b>, su main dopo l'unione: tutti i test, anche quelli che usano l'app vera. «Aggiorna» li vuole verdi.</p>
              </HelpTip>
            )}</div>
            <ul className="imp-branches">{list.map(b => <BranchRow key={b.name} b={b} now={now} />)}</ul>
          </div>
        );
      })}
    </section>
  );
}

function AppChats() {
  const hidden = ui.use(s => s.hidden);
  const ids = useApp(s => s.order.filter(id => s.chats[id]?.space === 'app' && !s.chats[id]?.appRegia && !s.chats[id]?.closedAt && !hidden.includes(id)), sameList);
  const selected = improveUi.use(s => s.selected);
  return (
    <section className="imp-card" aria-label="Chat dell’app" data-testid="improve-chats">
      <header className="imp-card-head"><h3>Chat dell’app</h3></header>
      {ids.length === 0 ? <p className="imp-empty">Le apre la Regia dell’app, una per modifica.</p> : (
        <ul className="imp-chats">{ids.map(id => <AppChatRow key={id} id={id} on={id === selected} />)}</ul>
      )}
    </section>
  );
}

function AppChatRow({ id, on }: { id: string; on: boolean }) {
  const c = useApp(s => s.chats[id]);
  if (!c) return null;
  return (
    <li>
      <button type="button" className={`imp-chat ${on ? 'on' : ''}`} onClick={() => showAppChat(on ? null : id)} aria-pressed={on} data-testid={`improve-chat-${id}`}>
        <HarnessMark harness={c.harness} size={16} /><span className="imp-chat-t">{c.title}</span><StatePill chat={c} />
      </button>
    </li>
  );
}

function RegiaColumn({ s }: { s: ImproveState }) {
  const hidden = ui.use(st => st.hidden);
  const id = useApp(st => st.order.find(x => st.chats[x]?.appRegia && !st.chats[x]?.closedAt && !hidden.includes(x)) ?? null);
  if (id) return <div className="imp-regia" data-testid="improve-regia"><ChatTile chatId={id} /></div>;
  return (
    <section className="imp-regia empty tile" data-testid="improve-regia-empty">
      <div className="empty-state">
        <p className="empty-title">Regia dell’app</p>
        <p className="empty-text">Le dici cosa vuoi cambiare dell’app: apre una chat per modifica, le fa testare e unisce quelle verdi. Poi tu premi «Aggiorna».</p>
        {s.repo && !s.repoProblem ? (
          <div className="imp-create">
            <button type="button" className="btn btn-regia btn-m" onClick={() => void createAppRegia('claude')} data-testid="improve-regia-create"><HarnessMark harness="claude" size={14} /> Crea con Claude</button>
            <button type="button" className="btn btn-ghost btn-m" onClick={() => void createAppRegia('cursor')} data-testid="improve-regia-create-cursor"><HarnessMark harness="cursor" size={14} /> Con Cursor</button>
          </div>
        ) : <p className="imp-why">Prima serve la cartella del codice dell’app (sopra).</p>}
      </div>
    </section>
  );
}

export function ImprovePage() {
  const s = useImprove(x => x);
  const selected = improveUi.use(x => x.selected);
  const selectedOk = useApp(st => (selected ? !!st.chats[selected] && !st.chats[selected]?.closedAt : false));
  // git is read on open and every 10 s while the section is on screen (a few git commands, no tokens)
  useEffect(() => {
    refreshImprove();
    const t = setInterval(refreshImprove, 10_000);
    return () => clearInterval(t);
  }, []);
  if (!s) return <div className="imp" data-testid="improve"><div className="skeleton"><i /><i /><i className="short" /></div></div>;
  return (
    <div className="imp" data-testid="improve">
      <PromoteBar s={s} />
      <PromoteProgress s={s} />
      {s.repoProblem && (
        <div className="imp-problem" role="alert" data-testid="improve-problem">
          <span>{s.repoProblem}</span>
          <button type="button" className="btn btn-ghost btn-s" onClick={() => go({ page: 'impostazioni' })}>Impostazioni</button>
        </div>
      )}
      <div className="imp-body">
        <RegiaColumn s={s} />
        <div className="imp-side">
          <Changes s={s} />
          <AppChats />
          {selected && selectedOk && <div className="imp-open" data-testid="improve-open-chat"><ChatTile chatId={selected} /></div>}
        </div>
      </div>
    </div>
  );
}
