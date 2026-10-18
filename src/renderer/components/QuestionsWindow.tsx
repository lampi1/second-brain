// The questions window ("Domande in finestra", settings questionsModal; the user, 2026-10-12): with the switch on,
// every open question, permission and command shows here, in front of everything (the Regia overlay too, under the
// dialogs), one at a time as a page read top to bottom (ADR 0049, the user 2026-10-14: "non lo trovo molto leggibile"):
// who asks, a muted lead (context), the question large, a text to approve as a document, the options as large cards
// (RequestPanel.tsx size `window`), a question with the shell blocks its chat gave in the same turn (each with "Esegui",
// run as that chat's block: lib/regia-route.ts commandsOfTurn), and the keys in the footer. With more than one request a
// rail on the left lists them all in the order they came; a click answers that one now and the rest stay (any order,
// ADR 0044). The chats' tiles and the Regia keep one line each. It never takes the user's text (lib/questions.ts): while
// they type a request waits as a pill, and when it shows it takes the keyboard only if no other field has it (a note
// says so; Ctrl+J or a click anywhere on it, backdrop too, moves it here). Esc or "Rispondi dopo" turns "Rispondi dopo"
// on (lib/later.ts): the window closes and stays closed, new requests wait silently in "Da rispondere". The same window
// is that queue's view: Ctrl+J or the top bar's counter call it with every open request, switch on or off (off: it
// closes once the queue is empty). One modal, anchored near the top like a command palette: what loads late grows
// downward and nothing on screen moves. It has no off switch of its own: a "Spegni" in its head, under the pointer when
// the window popped up, turned the setting off by mistake again and again (the user, 2026-10-16: "è come se a volte si
// togliesse da sola"); the switch is in Settings, "…" and Ctrl+K only. Answered with the keyboard, the next one takes the keyboard; when it closes,
// the keyboard goes back to the field it came from. It renders only on its own requests' changes (selectors return
// primitives or stable lists; counted in lib/questions.ts qwinStats). Mounted by App.tsx; pinned by
// test/e2e/questions.spec.ts, answer-later.spec.ts, questions-perf.spec.ts and questions-gallery.spec.ts.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PendingRequest } from '@shared/contract';
import { focusChat, reqKey } from '../actions';
import { isEditable, qwinStats, questionsModalOn, typingLeft, writingElsewhere } from '../lib/questions';
import { commandsOfTurn } from '../lib/regia-route';
import { sameList } from '../store/state';
import { useApp } from '../store/store';
import { callQuestions, parkQuestions, setQuestionsAside, setQuestionsShown, ui } from '../store/ui';
import { answerLater, openQueue } from '../lib/later';
import { HarnessMark, IconArrowRight, IconQuestion } from './Icons';
import { ago } from '../lib/format';
import { useNow } from '../lib/clock';
import { CodeBlock } from './CodeBlock';
import { RequestPanel } from './RequestPanel';
import { Kbd, Keys } from './ui';
import { t } from '../i18n';

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
  // a file link clicked in the window opened the viewer: the window waits as the pill while that file page is on
  // screen (Ctrl+J or the pill bring it back, nothing is answered or put off; store/ui.ts setQuestionsAside)
  const onFile = ui.use(s => s.page === 'file' && !s.map);
  const aside = !!q.aside && onFile;
  useEffect(() => { if (q.aside && !onFile) setQuestionsAside(false); }, [q.aside, onFile]);
  // under a dialog (Ctrl+K) the window stays mounted but hidden: a free answer being typed in it survives
  const up = on && !!cur && calm && !aside;
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
  const openedAt = useRef(0);
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

  if (!on || !pending.length || !up) openedAt.current = 0;
  if (!on || !pending.length) return null;
  if (dialog && !up) return null;
  if (!up || !cur) {
    return (
      <button type="button" className="qwin-pill" onClick={() => callQuestions(aside ? curKey : null)} data-testid="qwin-pill" data-tip={`${t('chat.questions.open')}|Ctrl+J`}>
        <IconQuestion size={13} />
        <span>{`${queue.length === 1 ? t('chat.questions.one') : t('chat.questions.many', { n: queue.length })}: ${t(aside ? 'chat.questions.asideHint' : 'chat.questions.typingHint')}`}</span>
        <Keys combo="Ctrl+J" />
      </button>
    );
  }
  if (!openedAt.current) openedAt.current = performance.now();
  return <Window cur={cur} all={pending} boxRef={box} hidden={dialog} setting={setting} openedAt={openedAt} />;
}

function Window({ cur, all, boxRef, hidden, setting, openedAt }: { cur: PendingRequest; all: readonly PendingRequest[]; boxRef: React.RefObject<HTMLDivElement | null>; hidden: boolean; setting: boolean; openedAt: React.RefObject<number> }) {
  const [keysEl, setKeysEl] = useState<HTMLSpanElement | null>(null);
  qwinStats.renders++;
  // primitives only: the asking chat's other changes (cost, last line) do not render the window
  const name = useApp(s => (s.chats[cur.chatId]?.isRegia ? 'Orchestrator' : (s.chats[cur.chatId]?.title ?? 'Chat')));
  const harness = useApp(s => s.chats[cur.chatId]?.harness ?? 'claude');
  const isRegia = useApp(s => !!s.chats[cur.chatId]?.isRegia);
  const titles = useApp(s => all.map(p => (s.chats[p.chatId]?.isRegia ? 'Orchestrator' : (s.chats[p.chatId]?.title ?? 'Chat'))), sameList);
  const harnesses = useApp(s => all.map(p => `${s.chats[p.chatId]?.harness ?? 'claude'}${s.chats[p.chatId]?.isRegia ? ':r' : ''}`), sameList);
  const now = useNow(30_000);
  // a question brings the commands its chat gave in the same turn; a permission's command is the agent's own (never run twice)
  const items = useApp(s => (cur.type === 'question' ? s.items[cur.chatId] : undefined));
  const cmds = useMemo(() => commandsOfTurn(items), [items]);
  const commands = cmds.length ? (
    <div className="decision-cmds" data-testid="qwin-card-cmds">
      {cmds.map((c, i) => <CodeBlock key={`${c.itemId}.${i}`} chatId={cur.chatId} itemId={c.itemId} lang={c.lang} code={c.code} />)}
    </div>
  ) : null;
  const later = answerLater;
  useEffect(() => {
    const t0 = openedAt.current;
    const f = requestAnimationFrame(() => { qwinStats.openMs = performance.now() - t0; });
    return () => cancelAnimationFrame(f);
  }, [openedAt]);
  // the user's field still has the keyboard: the window says so (it stays the one modal in the middle)
  const [elsewhere, setElsewhere] = useState(() => writingElsewhere());
  useEffect(() => {
    const f = () => setElsewhere(writingElsewhere());
    const later = () => setTimeout(f, 0); // after a focusout the new focus is known only on the next task
    document.addEventListener('focusin', f);
    document.addEventListener('focusout', later);
    // the card may have taken the keyboard before these listeners (the layout effect on open): else the note stays
    f();
    return () => { document.removeEventListener('focusin', f); document.removeEventListener('focusout', later); };
  }, []);
  // once shown for a card the note keeps its place, empty: a click on an option moves the keyboard here on the mousedown,
  // and a note leaving then would move the options up under the pointer, the mouseup elsewhere, no click (the user,
  // 2026-10-15: "devo premere 2 volte")
  const curKey = reqKey(cur);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  if (elsewhere && noteFor !== curKey) setNoteFor(curKey);
  const noteSlot = elsewhere || noteFor === curKey;
  const card = () => boxRef.current?.querySelector<HTMLElement>('[data-request-key]');
  // a click on the window's own surface or on the backdrop (not a button, link or field) gives the card the keyboard
  const onMouseDown = (e: React.MouseEvent) => {
    if ((e.target as Element).closest('button, a, input, textarea, select, [tabindex], .md, .cb-code, .ask-cmd')) return;
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
  const rail = all.length > 1;
  return (
    <div className="qwin-backdrop" data-testid="qwin-backdrop" hidden={hidden} onMouseDown={onMouseDown}>
      <div ref={boxRef} className={`qwin ${rail ? 'with-rail' : ''}`} role="dialog" aria-modal="true" aria-label={t('chat.questions.request', { chatTitle: name })} data-testid="qwin" onKeyDown={onKeyDown}>
        {rail && (
          <nav className="qwin-rail" aria-label={t('chat.questions.pendingAriaLabel')} data-testid="qwin-queue">
            <div className="qwin-rail-k">{t('chat.questions.waiting')} <b data-testid="qwin-count">{all.length}</b></div>
            <div className="qwin-rail-list">
              {all.map((p, i) => {
                const k = reqKey(p);
                const [h, r] = harnesses[i]!.split(':');
                const body = <><HarnessMark harness={h ?? 'claude'} regia={r === 'r'} size={14} /><span className="qwin-rail-t"><b>{titles[i]}</b><span>{p.type === 'permission' ? `${t('chat.questions.permission')}: ${p.title}` : p.title}</span></span></>;
                return k === curKey
                  ? <div key={k} className="qwin-rail-item cur" aria-current="true" data-testid="qwin-current">{body}</div>
                  : <button key={k} type="button" className="qwin-rail-item" onClick={() => callQuestions(k)} data-testid="qwin-pick" data-key={k}
                    data-tip={t('chat.questions.answerNowTip', { title: titles[i] ?? '' })}>{body}</button>;
              })}
            </div>
          </nav>
        )}
        <div className="qwin-main">
          <div className="qwin-head">
            <HarnessMark harness={harness} regia={isRegia} size={16} />
            <b className="qwin-chat" data-testid="qwin-chat">{name}</b>
            <span className="qwin-age">{ago(cur.at, now)}</span>
            <span className="sp" />
            {!isRegia && (
              <button type="button" className="btn btn-subtle btn-s" onClick={() => { if (setting) later(); else parkQuestions(); focusChat(cur.chatId); }} data-testid="qwin-open-chat">{t('chat.questions.openChat')} <IconArrowRight size={12} /></button>
            )}
          </div>
          {noteSlot && !elsewhere && <div className="qwin-note gone" aria-hidden="true" data-testid="qwin-elsewhere-slot">{t('chat.questions.note')} <Keys combo="Ctrl+J" /> {t('chat.questions.note2')}</div>}
          {elsewhere && (
            <div className="qwin-note" role="status" data-testid="qwin-elsewhere">{t('chat.questions.note')} <Keys combo="Ctrl+J" /> {t('chat.questions.note2')}</div>
          )}
          <div className="qwin-body">
            <RequestPanel key={curKey} req={cur} variant="window" chatTitle={name} harness={harness} commands={commands} onEscape={later} keysTo={keysEl} testid="qwin-card" />
          </div>
          <div className="qwin-foot">
            {/* a question's keys, written by the card for the step it shows (a permission's and a command's are on their buttons) */}
            <span className="qwin-keys" ref={setKeysEl} />
            <span className="sp" />
            <button type="button" className="btn btn-ghost btn-m" onClick={later} data-testid="qwin-later" data-tip={t('chat.questions.laterTip')}>{t('chat.questions.later')} <Kbd>Esc</Kbd></button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** What a tile (or the Regia) keeps of its requests while the window answers them, or while they wait in "Da
 *  rispondere" (`queued`, the chat stays blocked): one line, its button opens the window on the first of them. */
export function InWindowLine({ reqs, testid, queued }: { reqs: readonly PendingRequest[]; testid: string; queued?: boolean }) {
  const n = reqs.length === 1 ? t('chat.questions.one') : t('chat.questions.many', { n: reqs.length });
  const r = t('chat.questions.requestsCount', { n: reqs.length });
  const first = reqs[0] ? reqKey(reqs[0]) : null;
  return (
    <div className={`sent-to-regia in-window ${queued ? 'in-queue' : ''}`} role="status" data-testid={testid} data-queued={queued ? '' : undefined}>
      <IconQuestion size={13} />
      <span>{queued ? t('chat.questions.inQueue', { noun: r }) : t('chat.questions.inWindow', { noun: n })}</span>
      <button type="button" className="btn btn-ghost btn-s" onClick={() => (queued ? openQueue(first) : callQuestions(first))} data-testid={`${testid}-open`}>{queued ? t('chat.questions.openQueue') : t('chat.questions.openWindow')}</button>
    </div>
  );
}
