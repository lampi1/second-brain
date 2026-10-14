// The questions window ("Domande in finestra", settings questionsModal; the user, 2026-10-12): with the switch on,
// every open question, permission and command shows here, in front of everything (the Regia overlay too, under the dialogs),
// one at a time with its context open (AskContext.tsx), a question with the shell blocks its chat gave in the same turn
// (each with "Esegui", run as that chat's block: lib/regia-route.ts commandsOfTurn), and the queue under it; the
// chats' tiles and the Regia keep one line each. It never takes the user's text (lib/questions.ts): while they type a request waits as a pill, and
// when it shows it takes the keyboard only if no other field has it (Ctrl+J or a click moves it here). Esc or "Rispondi
// dopo" turns "Rispondi dopo" on (lib/later.ts): the window closes and stays closed, new requests wait silently in "Da
// rispondere". The same window is that queue's view: Ctrl+J or the top bar's counter call it with every open request,
// switch on or off (off: it closes once the queue is empty).
// While the keyboard stays in the user's field the window is not modal: no backdrop, on the half of the screen away
// from that field; a click in it or Ctrl+J makes it modal. Answered with the keyboard, the next one takes the keyboard;
// when it closes, the keyboard goes back to the field it came from. Mounted by App.tsx; pinned by test/e2e/questions.spec.ts.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PendingRequest } from '@shared/contract';
import { focusChat, reqKey, toggleQuestionsModal } from '../actions';
import { isEditable, questionsModalOn, typingLeft, writingElsewhere } from '../lib/questions';
import { commandsOfTurn } from '../lib/regia-route';
import { sameList } from '../store/state';
import { useApp } from '../store/store';
import { callQuestions, parkQuestions, setQuestionsShown, ui } from '../store/ui';
import { answerLater, openQueue } from '../lib/later';
import { HarnessMark, IconArrowRight, IconQuestion } from './Icons';
import { CodeBlock } from './CodeBlock';
import { RequestPanel } from './RequestPanel';
import { Keys } from './ui';

const EMPTY: readonly PendingRequest[] = [];

export function QuestionsWindow() {
  const setting = useApp(questionsModalOn);
  const hidden = ui.use(s => s.hidden, sameList);
  const q = ui.use(s => s.qwin);
  const later = ui.use(s => s.later);
  const dialog = ui.use(s => s.modal !== null);
  // "Rispondi dopo" on: closed whatever the switch; called as the queue: open whatever the switch
  const on = !later && (setting || q.open);
  const pending = useApp(s => (on ? s.pending.filter(p => !hidden.includes(p.chatId)) : EMPTY), sameList);
  const queue = [...pending];
  if (q.first) { const i = queue.findIndex(p => reqKey(p) === q.first); if (i > 0) queue.unshift(...queue.splice(i, 1)); }
  const cur = queue[0];
  // the typing guard: shown once the user stops typing, or at once when they call it (Ctrl+J, "Apri")
  const [calm, setCalm] = useState(false);
  const calledAt = useRef(q.call);
  const curKey = cur ? reqKey(cur) : null;
  useEffect(() => {
    if (!curKey) { setCalm(false); return; }
    if (calledAt.current !== q.call) { calledAt.current = q.call; setCalm(true); return; }
    if (calm) return;
    let t: ReturnType<typeof setTimeout>;
    const check = () => { const left = typingLeft(); if (left <= 0) setCalm(true); else t = setTimeout(check, left + 50); };
    check();
    return () => clearTimeout(t);
  }, [curKey, q.call, calm]);
  // under a dialog (Ctrl+K) the window stays mounted but hidden: a free answer being typed in it survives
  const up = on && !!cur && calm;
  const shown = up && !dialog;
  useEffect(() => { setQuestionsShown(shown); }, [shown]);
  useEffect(() => () => setQuestionsShown(false), []);
  // the field the keyboard came from (Ctrl+J, a click in the window): it gets the keyboard back when the window closes
  const back = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const f = (e: FocusEvent) => {
      const to = e.target as Element | null;
      const from = e.relatedTarget as HTMLElement | null;
      if (to?.closest?.('.qwin') && from && isEditable(from) && !from.closest('.qwin')) back.current = from;
    };
    document.addEventListener('focusin', f, true);
    return () => document.removeEventListener('focusin', f, true);
  }, []);
  useEffect(() => {
    if (shown) return;
    const el = back.current;
    back.current = null;
    const a = document.activeElement;
    if (el?.isConnected && (!a || a === document.body)) el.focus({ preventScroll: true });
  }, [shown]);

  // the keyboard: to the card when it shows (unless the user is in another field) and to the next one after an answer
  const box = useRef<HTMLDivElement>(null);
  const wasCalled = useRef(q.call);
  useLayoutEffect(() => {
    if (!shown || !curKey) return;
    const called = wasCalled.current !== q.call;
    wasCalled.current = q.call;
    const el = box.current?.querySelector<HTMLElement>('[data-request-key]');
    if (!el) return;
    if (called || !writingElsewhere()) el.focus({ preventScroll: true });
  }, [shown, curKey, q.call]);

  // the queue called with the switch off: done once it is empty (a later request goes back to the tiles)
  const empty = q.open && !later && !pending.length;
  useEffect(() => { if (empty) parkQuestions(); }, [empty]);

  if (!on || !pending.length) return null;
  if (dialog && !up) return null;
  if (!up || !cur) {
    return (
      <button type="button" className="qwin-pill" onClick={() => callQuestions(null)} data-testid="qwin-pill" data-tip="Apri le domande|Ctrl+J">
        <IconQuestion size={13} />
        <span>{`${queue.length === 1 ? 'Una domanda' : `${queue.length} domande`}: compare quando smetti di scrivere`}</span>
        <Keys combo="Ctrl+J" />
      </button>
    );
  }
  return <Window cur={cur} queue={queue} boxRef={box} hidden={dialog} setting={setting} />;
}

function Window({ cur, queue, boxRef, hidden, setting }: { cur: PendingRequest; queue: readonly PendingRequest[]; boxRef: React.RefObject<HTMLDivElement | null>; hidden: boolean; setting: boolean }) {
  const chat = useApp(s => s.chats[cur.chatId]);
  const titles = useApp(s => queue.slice(1, 6).map(p => (s.chats[p.chatId]?.isRegia ? 'Regia' : (s.chats[p.chatId]?.title ?? 'Chat'))), sameList);
  const name = chat?.isRegia ? 'Regia' : (chat?.title ?? 'Chat');
  // a question brings the commands its chat gave in the same turn; a permission's command is the agent's own (never run twice)
  const items = useApp(s => (cur.type === 'question' ? s.items[cur.chatId] : undefined));
  const cmds = useMemo(() => commandsOfTurn(items), [items]);
  const commands = cmds.length ? (
    <div className="decision-cmds" data-testid="qwin-card-cmds">
      {cmds.map((c, i) => <CodeBlock key={`${c.itemId}.${i}`} chatId={cur.chatId} itemId={c.itemId} lang={c.lang} code={c.code} />)}
    </div>
  ) : null;
  const later = answerLater;
  // the user's field still has the keyboard: not modal, on the half of the screen away from that field
  const fieldSide = (): 'top' | 'bottom' => {
    const r = writingElsewhere() ? document.activeElement!.getBoundingClientRect() : null;
    return r && r.top + r.height / 2 > window.innerHeight / 2 ? 'top' : 'bottom';
  };
  const [elsewhere, setElsewhere] = useState(() => writingElsewhere());
  const [side, setSide] = useState(fieldSide);
  useEffect(() => {
    const f = () => { setElsewhere(writingElsewhere()); setSide(fieldSide()); };
    const later = () => setTimeout(f, 0); // after a focusout the new focus is known only on the next task
    document.addEventListener('focusin', f);
    document.addEventListener('focusout', later);
    // the card may have taken the keyboard before these listeners (the layout effect on open): else the window stays
    // "free" over a field it no longer has, and leaves it under the pointer on the first click (the button missed)
    f();
    return () => { document.removeEventListener('focusin', f); document.removeEventListener('focusout', later); };
  }, []);
  const card = () => boxRef.current?.querySelector<HTMLElement>('[data-request-key]');
  // a click on the window's own surface (not a button, link or field) gives the card the keyboard
  const onMouseDown = (e: React.MouseEvent) => {
    if ((e.target as Element).closest('button, a, input, textarea, select, [tabindex]')) return;
    e.preventDefault();
    card()?.focus({ preventScroll: true });
  };
  // Tab stays inside the window once the keyboard is there
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const all = [...(boxRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input, textarea, select, [tabindex]:not([tabindex="-1"])') ?? [])].filter(x => x.offsetParent !== null);
    if (!all.length) return;
    const i = all.indexOf(document.activeElement as HTMLElement);
    const next = e.shiftKey ? (i <= 0 ? all[all.length - 1] : null) : (i === all.length - 1 ? all[0] : null);
    if (next) { e.preventDefault(); next.focus(); }
  };
  const free = elsewhere;
  return (
    <div className={`qwin-backdrop ${free ? `free ${side}` : ''}`} data-testid="qwin-backdrop" hidden={hidden}>
      <div ref={boxRef} className="qwin" role="dialog" aria-modal={!free} aria-label={`Richiesta da ${name}`} data-testid="qwin" data-free={free ? '' : undefined}
        onMouseDown={onMouseDown} onKeyDown={onKeyDown}>
        <div className="qwin-head">
          <HarnessMark harness={chat?.harness ?? 'claude'} regia={!!chat?.isRegia} size={18} />
          <b className="qwin-chat" data-testid="qwin-chat">{name}</b>
          {queue.length > 1 && <span className="qwin-count" data-testid="qwin-count">{queue.length === 2 ? 'poi un’altra' : `poi altre ${queue.length - 1}`}</span>}
          <span className="sp" />
          {!chat?.isRegia && (
            <button type="button" className="btn btn-ghost btn-s" onClick={() => { if (setting) later(); else parkQuestions(); focusChat(cur.chatId); }} data-testid="qwin-open-chat">Apri la chat <IconArrowRight size={12} /></button>
          )}
          <button type="button" className="btn btn-ghost btn-s" onClick={later} data-testid="qwin-later">Rispondi dopo <Keys combo="Esc" /></button>
          {setting && <button type="button" className="btn btn-ghost btn-s" onClick={() => { parkQuestions(); toggleQuestionsModal(); }} data-testid="qwin-off" data-tip="Spegni la finestra: le domande tornano nelle chat">Spegni</button>}
        </div>
        {elsewhere && (
          <div className="qwin-note" role="status" data-testid="qwin-elsewhere">Il cursore è rimasto nel campo dove scrivevi: un clic nella finestra o <Keys combo="Ctrl+J" /> per rispondere.</div>
        )}
        <div className="qwin-body">
          <RequestPanel key={reqKey(cur)} req={cur} variant="tile" chatTitle={name} harness={chat?.harness ?? 'claude'} ctxOpen commands={commands} onEscape={later} testid="qwin-card" />
        </div>
        {titles.length > 0 && (
          <div className="qwin-queue" data-testid="qwin-queue">
            <span className="qwin-queue-k">Poi:</span>
            {titles.map((t, i) => <span key={i} className="qwin-queue-item">{t}</span>)}
            {queue.length > 6 && <span className="qwin-queue-item">+{queue.length - 6}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

/** What a tile (or the Regia) keeps of its requests while the window answers them, or while they wait in "Da
 *  rispondere" (`queued`, the chat stays blocked): one line, its button opens the window on the first of them. */
export function InWindowLine({ reqs, testid, queued }: { reqs: readonly PendingRequest[]; testid: string; queued?: boolean }) {
  const n = reqs.length === 1 ? 'Una domanda' : `${reqs.length} domande`;
  const r = reqs.length === 1 ? 'una richiesta' : `${reqs.length} richieste`;
  const first = reqs[0] ? reqKey(reqs[0]) : null;
  return (
    <div className={`sent-to-regia in-window ${queued ? 'in-queue' : ''}`} role="status" data-testid={testid} data-queued={queued ? '' : undefined}>
      <IconQuestion size={13} />
      <span>{queued ? `Da rispondere: ${r}, la chat aspetta.` : `${n} nella finestra delle domande.`}</span>
      <button type="button" className="btn btn-ghost btn-s" onClick={() => (queued ? openQueue(first) : callQuestions(first))} data-testid={`${testid}-open`}>{queued ? 'Rispondi' : 'Apri'}</button>
    </div>
  );
}
