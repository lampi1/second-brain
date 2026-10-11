// Adesso: every Claude and Cursor chat of the last 48 hours as the brain reads it (transcripts, zero tokens): the ones
// waiting for you first, then the ones working, the finished or stopped ones folded. Each card: state, harness,
// mailbox, how long ago, the now.md next step and the last message (DevOps numbers become named links), what you last
// said, and "Scrivi". Refreshes by itself every 20 s. At the bottom the message box (components/Composer).
import { useState } from 'react';
import { normBrief, normNow, normTables, type LiveChat } from '../types';
import { useBrain } from '../api';
import { chatAgo, chatName, chatState, groupChats } from '../lib/chats';
import { devopsIndex, firstPerson, linkify, nextText, ownerOf, short, type DevopsRef } from '../lib/text';
import { fmt } from '../lib/format';
import { Async, Empty, PageHead } from '../components/States';
import { Harness, Linked, Pill, Section, type Navigate } from '../components/ui';
import { Composer, type ViaRegia } from '../components/Composer';

function ChatCard({ c, idx, owner, onWrite }: { c: LiveChat; idx: Map<string, DevopsRef>; owner: string; onWrite?: () => void }) {
  const st = chatState(c);
  return (
    <article className={`bx-card bx-chat ${st.tone === 'warn' ? 'wait' : ''}`} data-testid={`bx-chat-${c.id}`}>
      <div className="top">
        <Harness name={c.harness} />
        <Pill tone={st.tone}>{st.label}</Pill>
        {c.box?.listening && <Pill tone="outline" title="Si sveglia appena arriva un messaggio">in ascolto</Pill>}
        {c.box && c.box.unread > 0 && <Pill tone="warn">{c.box.unread} da leggere</Pill>}
        <span className="when" title={c.when}>{chatAgo(c)}{/worktree/.test(c.folder) ? ' · worktree' : ''}</span>
      </div>
      <h3>{chatName(c)}</h3>
      {c.now?.prossimo && <p className="next"><Linked parts={linkify(firstPerson(nextText(c.now.prossimo), owner), idx)} /></p>}
      {c.last && <p className="last bx-clip2"><span className="k">Ultimo messaggio: </span><Linked parts={linkify(c.last, idx)} /></p>}
      {c.lastOwner && <p className="you">Tu: «{short(c.lastOwner, 120)}»</p>}
      {onWrite ? <div className="bx-row"><button type="button" className="bx-btn s" onClick={onWrite}>Scrivi a questa chat</button></div>
        : <p className="small muted">Senza casella di posta: scrivile dalla sua finestra.</p>}
    </article>
  );
}

export function Adesso({ nav }: { nav: Navigate }) {
  const n = useBrain('/api/now', normNow, { pollMs: 20e3, maxAgeMs: 10e3 });
  const br = useBrain('/api/day?kind=brief', normBrief);
  const t = useBrain('/api/tables', normTables);
  const owner = t.data ? ownerOf(t.data.ideas) : '';
  const [target, setTarget] = useState('');
  const [focus, setFocus] = useState(0);
  const idx = devopsIndex(br.data);
  const g = n.data ? groupChats(n.data.chats) : null;
  const mailboxes: ViaRegia[] = (n.data?.chats ?? []).filter(c => c.box && c.box.name !== 'regia').map(c => ({ kind: 'mailbox', box: c.box!.name, name: chatName(c) }));
  const write = (c: LiveChat) => (c.box ? () => { setTarget(c.box!.name === 'regia' ? '' : `box:${c.box!.name}`); setFocus(x => x + 1); } : undefined);
  const listening = n.data?.boxes.filter(b => b.listening).length ?? 0;
  const grid = (rows: LiveChat[]) => <div className="bx-chatgrid">{rows.map(c => <ChatCard key={c.id} c={c} idx={idx} owner={owner} onWrite={write(c)} />)}</div>;

  return (
    <>
      <PageHead title="Adesso" live at={n.at} refreshing={n.refreshing} onRefresh={() => n.reload(true)}
        lead={g ? (g.wait.length || g.live.length ? <><b>{g.wait.length ? `${g.wait.length} ${g.wait.length === 1 ? 'chat ti aspetta' : 'chat ti aspettano'}` : 'Nessuna chat ti aspetta'}</b>, {g.live.length} al lavoro.{g.wait[0] ? <> La prima: <b>{chatName(g.wait[0])}</b>.</> : null}</> : <b>Nessuna chat al lavoro in questo momento.</b>) : undefined}
        what="Le chat di Claude e Cursor delle ultime 48 ore, lette dai loro file: cosa fanno e cosa aspettano da te. Si aggiorna da sola ogni 20 secondi." />
      <Async loading={n.loading && !n.data} error={n.data ? null : n.error} onRetry={() => n.reload()} label="Guardo le chat…" lines={4} block>
        {() => g && (
          <>
            {g.wait.length > 0 && <Section title="Ti aspettano" count={g.wait.length} note="hanno una domanda o un permesso per te" testId="bx-group-wait">{grid(g.wait)}</Section>}
            {g.live.length > 0 && <Section title="Al lavoro" count={g.live.length} note="stanno facendo qualcosa adesso" testId="bx-group-live">{grid(g.live)}</Section>}
            {!g.wait.length && !g.live.length && <Empty title="Nessuna chat al lavoro">Quando una chat lavora o ti fa una domanda compare qui per prima.</Empty>}
            {g.rest.length > 0 && (
              <details className="bx-details" data-testid="bx-group-rest">
                <summary>Finite o ferme nelle ultime 48 ore · {g.rest.length}</summary>
                <div className="body">{grid(g.rest)}</div>
              </details>
            )}
          </>
        )}
      </Async>
      <Section title="Scrivi a una chat" note={`${listening} ${listening === 1 ? 'chat è in ascolto' : 'chat sono in ascolto'} della posta`} id="bx-write"
        actions={<button type="button" className="bx-go" onClick={() => nav('collabora')}>Registro della posta →</button>}>
        <div className="bx-card"><Composer mailboxes={mailboxes} target={target} onTarget={setTarget} focusKey={focus} /></div>
      </Section>
      {n.at && <p className="small muted">Ultima lettura delle chat: {fmt.when(n.at)}.</p>}
    </>
  );
}
