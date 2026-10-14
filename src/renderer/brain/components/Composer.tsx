// Writing to a chat from a brain page, through the app's own chats only ('chat:list' + 'chat:send'): to a chat of the
// app directly, or to a chat the app only reads (Claude desktop, Cursor IDE: it has a mailbox in the brain) through the
// Regia, which forwards it with the brain's mail between chats. Always two steps (Invia… → Sì, invia) because a
// message makes a model work. Used by Adesso.
import { useEffect, useRef, useState } from 'react';
import type { ChatSummary } from '@shared/contract';
import { chatName } from '@shared/regia';
import { toast } from './ui';

/** The app's chats, live (chat:list once, then chat:updated / chat:removed). */
/** The engines' short names by id ("kimi" → "Kimi"), from app:info; an id it does not know shows as itself. */
export function useEngineLabels(): (h: string) => string {
  const [labels, setLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    window.sb.invoke('app:info', undefined).then(i => { if (alive) setLabels(Object.fromEntries(i.engines.map(e => [e.id, e.label]))); }, () => { /* ids as names */ });
    return () => { alive = false; };
  }, []);
  return h => labels[h] ?? h;
}

export function useAppChats(): ChatSummary[] | null {
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => window.sb.invoke('chat:list', undefined).then(c => { if (alive) setChats(c); }, () => { if (alive) setChats([]); });
    load();
    const offs = [window.sb.on('chat:updated', c => setChats(x => (x ? (x.some(y => y.id === c.id) ? x.map(y => (y.id === c.id ? c : y)) : [...x, c]) : x))),
      window.sb.on('chat:removed', ({ chatId }) => setChats(x => x?.filter(y => y.id !== chatId) ?? x))];
    return () => { alive = false; for (const off of offs) off(); };
  }, []);
  return chats;
}
export const regiaOf = (chats: ChatSummary[] | null): ChatSummary | null => chats?.find(c => c.isRegia && c.state !== 'closed') ?? null;

export interface Target { kind: 'app'; chatId: string; name: string }
export interface ViaRegia { kind: 'mailbox'; box: string; name: string }
export type ComposerTarget = Target | ViaRegia;

const PHRASES = ['A che punto sei? Rispondimi in 3 righe.', 'Riprendi da dove eri rimasta.', 'Spiegami in parole semplici cosa stai facendo.', 'Cosa ti serve da me per andare avanti?'];
export const forwardText = (t: ViaRegia, text: string): string =>
  `Gira questo messaggio alla chat «${t.name}» con la posta tra chat (casella ${t.box}), senza cambiarlo, e dimmi quando è consegnato:\n\n${text}`;

export function Composer({ mailboxes, target, onTarget, focusKey }: {
  /** chats the app only reads, that have a mailbox (from /api/now) */
  mailboxes: ViaRegia[];
  target: string;
  onTarget: (key: string) => void;
  /** changes when a "Scrivi" button asks for focus */
  focusKey?: number;
}) {
  const chats = useAppChats();
  const regia = regiaOf(chats);
  const [text, setText] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (focusKey) { ta.current?.focus(); ta.current?.closest('section')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }, [focusKey]);

  const app: Target[] = (chats ?? []).filter(c => c.state !== 'closed' && c.origin === 'app').sort((a, b) => Number(b.isRegia) - Number(a.isRegia)).map(c => ({ kind: 'app', chatId: c.id, name: chatName(c) }));
  const options: ComposerTarget[] = [...app, ...(regia ? mailboxes : [])];
  const keyOf = (t: ComposerTarget) => (t.kind === 'app' ? `app:${t.chatId}` : `box:${t.box}`);
  // the chosen chat, or the first one when none was chosen; a chosen chat that is gone is never swapped for another
  const chosen = target ? options.find(t => keyOf(t) === target) ?? null : null;
  const cur = target ? chosen : options[0] ?? null;
  useEffect(() => { if (target && !chosen) setConfirm(false); }, [target, chosen]);

  const send = async () => {
    if (!cur || !text.trim()) return;
    setBusy(true); setErr(null);
    try {
      if (cur.kind === 'app') await window.sb.invoke('chat:send', { chatId: cur.chatId, text: text.trim() });
      else if (regia) await window.sb.invoke('chat:send', { chatId: regia.id, text: forwardText(cur, text.trim()) });
      toast(cur.kind === 'app' ? `Inviato a ${cur.name}` : `Inviato alla Regia, che lo gira a ${cur.name}`);
      setText(''); setConfirm(false);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  if (chats && !options.length) {
    return (
      <div className="bx-empty" data-testid="bx-composer-off">
        <b>Per scrivere da qui serve la Regia aperta nell'app</b>
        <span>Apri la Regia nel workspace: da questa pagina potrai mandarle messaggi, e lei li girerà alle chat che l'app legge soltanto.</span>
      </div>
    );
  }
  return (
    <div className="bx-composer" data-testid="bx-composer">
      <div className="bx-row">
        <label className="small muted" htmlFor="bx-to">A</label>
        <select id="bx-to" className="bx-select" value={cur ? keyOf(cur) : ''} onChange={e => onTarget(e.target.value)} aria-label="Chat a cui scrivere">
          {!cur && <option value="" disabled>Scegli la chat…</option>}
          {app.length > 0 && <optgroup label="Chat dell'app">{app.map(t => <option key={keyOf(t)} value={keyOf(t)}>{t.name}</option>)}</optgroup>}
          {regia && mailboxes.length > 0 && <optgroup label="Tramite la Regia (posta tra chat)">{mailboxes.map(t => <option key={keyOf(t)} value={keyOf(t)}>{t.name}</option>)}</optgroup>}
        </select>
        {cur?.kind === 'mailbox' && <span className="small muted">la Regia lo gira con la posta tra chat</span>}
        {target && !chosen && <span className="small" style={{ color: 'var(--bx-amber)' }}>la chat scelta non è più tra quelle aperte: scegline un'altra</span>}
      </div>
      <div className="chips">{PHRASES.map(p => <button key={p} type="button" className="bx-chip" onClick={() => { setText(p); ta.current?.focus(); }}>{p}</button>)}</div>
      <textarea ref={ta} className="bx-textarea" placeholder="Scrivi cosa vuoi chiedere…" aria-label="Testo del messaggio" maxLength={2000} value={text} onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim()) { e.preventDefault(); setConfirm(true); } }} />
      {!confirm ? (
        <div className="bx-row"><button type="button" className="bx-btn primary" disabled={!text.trim() || !cur} onClick={() => setConfirm(true)}>Invia…</button><span className="small muted">Ctrl+Invio</span></div>
      ) : (
        <div className="bx-confirm" role="alertdialog" aria-label="Conferma invio">
          <p><b>Invio a {cur?.name}?</b> {cur?.kind === 'mailbox' ? 'Lo mando alla Regia, che lo gira con la posta tra chat.' : 'Arriva nella chat come tuo messaggio e la fa lavorare.'}</p>
          {err && <p className="small" style={{ color: 'var(--bx-red)' }}>{err}</p>}
          <div className="bx-row">
            <button type="button" className="bx-btn primary" disabled={busy} onClick={() => void send()}>Sì, invia</button>
            <button type="button" className="bx-btn" onClick={() => setConfirm(false)}>Annulla</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** "Discutiamone": a ready message to the Regia, confirmed inline. Hidden reasonably when no Regia is open. */
export function DiscussButton({ title, text, regia }: { title: string; text: string; regia: ChatSummary | null }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!regia) return <span className="small muted" title="Apri la Regia nel workspace per discuterne da qui">Discutiamone: apri la Regia</span>;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {!open ? <button type="button" className="bx-btn s" onClick={() => setOpen(true)} style={{ justifySelf: 'start' }}>Discutiamone</button> : (
        <div className="bx-confirm">
          <p className="small"><b>Mando alla Regia?</b> «Discutiamone: {title}»</p>
          {err && <p className="small" style={{ color: 'var(--bx-red)' }}>{err}</p>}
          <div className="bx-row">
            <button type="button" className="bx-btn primary s" disabled={busy} onClick={() => { setBusy(true); setErr(null); window.sb.invoke('chat:send', { chatId: regia.id, text }).then(() => { toast('Mandato alla Regia'); setOpen(false); }, e => setErr(String(e?.message ?? e))).finally(() => setBusy(false)); }}>Sì, manda</button>
            <button type="button" className="bx-btn s" onClick={() => setOpen(false)}>Annulla</button>
          </div>
        </div>
      )}
    </div>
  );
}
