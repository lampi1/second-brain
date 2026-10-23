// The questions window (the user, 2026-10-12; always on since 2026-10-22, the owner: "popup sempre attivi"):
// every open question, permission and command shows here, in front of everything (the Orchestrator overlay too, under the
// dialogs), one at a time as a page read top to bottom (ADR 0049, the user 2026-10-14: "non lo trovo molto leggibile"):
// who asks, a muted lead (context), the question large, a text to approve as a document, the options as large cards
// (RequestPanel.tsx size `window`), a question with the shell blocks its chat gave in the same turn (each with "Esegui",
// run as that chat's block: lib/orchestrator-route.ts commandsOfTurn), and the keys in the footer. With more than one request a
// rail on the left lists them all in the order they came; a click answers that one now and the rest stay (any order,
// ADR 0044). The chats' tiles and the Orchestrator keep one line each. It never takes the user's text (lib/questions.ts): while
// they type a request waits as a pill, and when it shows it takes the keyboard only if no other field has it (a note
// says so; Ctrl+J or a click anywhere on it, backdrop too, moves it here). Esc or "Rispondi dopo" turns "Rispondi dopo"
// on that request (lib/later.ts): it stays in "Da rispondere", while other and new requests can still appear. The same window
// is that queue's view: Ctrl+J or the top bar's counter call it with every open request. One modal, anchored near the top like a command palette: what loads late grows
// downward and nothing on screen moves. There is no off switch anywhere. Answered with the keyboard, the next one takes the keyboard; when it closes,
// the keyboard goes back to the field it came from. It renders only on its own requests' changes (selectors return
// primitives or stable lists; counted in lib/questions.ts qwinStats). A Strategist's plan waiting for
// the user's ok is one more card here (lib/plan-ask.ts, PlanApproval.tsx, ADR 0121), in the order it came, its strip only
// pointing to it. Mounted by App.tsx; pinned by test/e2e/questions.spec.ts, answer-later.spec.ts, questions-perf.spec.ts,
// questions-gallery.spec.ts and strategist-plan-popup.spec.ts.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PendingRequest } from '@shared/contract';
import { focusChat, reqKey } from '../actions';
import { isEditable, qwinStats, typingLeft, writingElsewhere } from '../lib/questions';
import { commandsOfTurn } from '../lib/orchestrator-route';
import { sameList } from '../store/state';
import { useApp } from '../store/store';
import { callQuestions, parkQuestions, setQuestionsAside, setQuestionsShown, ui } from '../store/ui';
import { answerLater, openQueue, requestPostponed } from '../lib/later';
import { HarnessMark, IconArrowRight, IconQuestion } from './Icons';
import { ago } from '../lib/format';
import { useNow } from '../lib/clock';
import { CodeBlock } from './CodeBlock';
import { RequestPanel } from './RequestPanel';
import { PlanApproval } from './PlanApproval';
import { planAskKeys, planAskOf, withPlans, type PlanAsk } from '../lib/plan-ask';
import { Kbd, Keys } from './ui';
import { t } from '../i18n';
import { durableAsks, withDurableAsks, type DurableAsk } from '../lib/work-ask';
import { useWorkflows } from '../store/workflows';
import { WorkApproval } from './WorkApproval';
import { FlowApproval } from './FlowApproval';
import { flowAsks, type FlowAsk } from '../lib/flow-ask';
import { useFlows } from '../store/flows';

/** what the window shows: an open request, or a Strategist's plan to approve */
type Ask = PendingRequest | PlanAsk | DurableAsk | FlowAsk;
const isFlow = (ask: Ask): ask is FlowAsk => ask.type === 'flow-definition' || ask.type === 'flow-run' || ask.type === 'flow-automation';
const isHost = (ask: Ask): ask is DurableAsk | FlowAsk => isDurable(ask) || isFlow(ask);
const isDurable = (ask: Ask): ask is DurableAsk => ask.type === 'work' || ask.type === 'lesson';

export function QuestionsWindow() {
  const hidden = ui.use(s => s.hidden, sameList);
  const q = ui.use(s => s.qwin);
  const dialog = ui.use(s => s.modal !== null);
  // Postponed requests stay in the store; only those keys are omitted until the queue is explicitly reopened.
  const allPending = useApp(s => s.pending, sameList);
  // the plans waiting for the user's ok
  const planKeys = useApp(planAskKeys, sameList);
  const plans = useMemo(() => planKeys.map(planAskOf).filter((p): p is PlanAsk => !!p), [planKeys]);
  const { rows, lessons } = useWorkflows();
  const decisions = useMemo(() => durableAsks(rows, lessons), [rows, lessons]);
  const { snapshot } = useFlows();
  const flows = useMemo(() => flowAsks(snapshot), [snapshot]);
  const pending: readonly Ask[] = [...withDurableAsks(withPlans(allPending, plans), decisions), ...flows].filter(p => (isHost(p) || !hidden.includes(p.chatId)) && !requestPostponed(reqKey(p)));
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
  // a file link clicked in the window opened the viewer: the window waits as the pill while the viewer is on screen
  // (Ctrl+J or the pill bring it back, nothing is answered or put off; store/ui.ts setQuestionsAside)
  const onFile = ui.use(s => s.viewer.open);
  const aside = !!q.aside && onFile;
  useEffect(() => { if (q.aside && !onFile) setQuestionsAside(false); }, [q.aside, onFile]);
  // under a dialog (Ctrl+K) the window stays mounted but hidden: a free answer being typed in it survives
  const up = !!cur && calm && !aside;
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

  // the queue called by hand: done once it is empty
  const empty = q.open && !pending.length;
  useEffect(() => { if (empty) parkQuestions(); }, [empty]);

  if (!pending.length || !up) openedAt.current = 0;
  if (!pending.length) return null;
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
  return <Window cur={cur} all={pending} boxRef={box} hidden={dialog} openedAt={openedAt} />;
}

function Window({ cur, all, boxRef, hidden, openedAt }: { cur: Ask; all: readonly Ask[]; boxRef: React.RefObject<HTMLDivElement | null>; hidden: boolean; openedAt: React.RefObject<number> }) {
  const [keysEl, setKeysEl] = useState<HTMLSpanElement | null>(null);
  qwinStats.renders++;
  // primitives only: the asking chat's other changes (cost, last line) do not render the window
  const name = useApp(s => isHost(cur) ? cur.title : (s.chats[cur.chatId]?.isOrchestrator ? 'Orchestrator' : (s.chats[cur.chatId]?.title ?? 'Chat')));
  const harness = useApp(s => s.chats[cur.chatId]?.harness ?? 'claude');
  const isOrchestrator = useApp(s => isHost(cur) || !!s.chats[cur.chatId]?.isOrchestrator);
  const titles = useApp(s => all.map(p => isHost(p) ? p.title : (s.chats[p.chatId]?.isOrchestrator ? 'Orchestrator' : (s.chats[p.chatId]?.title ?? 'Chat'))), sameList);
  const harnesses = useApp(s => all.map(p => `${s.chats[p.chatId]?.harness ?? 'claude'}${isHost(p) || s.chats[p.chatId]?.isOrchestrator ? ':r' : ''}`), sameList);
  const now = useNow(30_000);
  // a question brings the commands its chat gave in the same turn; a permission's command is the agent's own (never run twice)
  const items = useApp(s => (cur.type === 'question' ? s.items[cur.chatId] : undefined));
  const cmds = useMemo(() => commandsOfTurn(items), [items]);
  const commands = cmds.length ? (
    <div className="decision-cmds" data-testid="qwin-card-cmds">
      {cmds.map((c, i) => <CodeBlock key={`${c.itemId}.${i}`} chatId={cur.chatId} itemId={c.itemId} lang={c.lang} code={c.code} />)}
    </div>
  ) : null;
  const later = () => answerLater(reqKey(cur));
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
                const body = <><HarnessMark harness={h ?? 'claude'} orchestrator={r === 'r'} size={14} /><span className="qwin-rail-t"><b>{titles[i]}</b><span>{p.type === 'plan' ? t('tree.plan.ask.kicker') : p.type === 'permission' ? `${t('chat.questions.permission')}: ${p.title}` : p.title}</span></span></>;
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
            <HarnessMark harness={harness} orchestrator={isOrchestrator} size={16} />
            <b className="qwin-chat" data-testid="qwin-chat">{name}</b>
            <span className="qwin-age">{ago(cur.at, now)}</span>
            <span className="sp" />
            {!isOrchestrator && (
              <button type="button" className="btn btn-subtle btn-s" onClick={() => { later(); focusChat(cur.chatId); }} data-testid="qwin-open-chat">{t('chat.questions.openChat')} <IconArrowRight size={12} /></button>
            )}
          </div>
          {noteSlot && !elsewhere && <div className="qwin-note gone" aria-hidden="true" data-testid="qwin-elsewhere-slot">{t('chat.questions.note')} <Keys combo="Ctrl+J" /> {t('chat.questions.note2')}</div>}
          {elsewhere && (
            <div className="qwin-note" role="status" data-testid="qwin-elsewhere">{t('chat.questions.note')} <Keys combo="Ctrl+J" /> {t('chat.questions.note2')}</div>
          )}
          <div className="qwin-body">
            {isFlow(cur)
              ? <FlowApproval key={curKey} ask={cur} onEscape={later} />
              : isDurable(cur)
              ? <WorkApproval key={curKey} ask={cur} onEscape={later} />
              : cur.type === 'plan'
              ? <PlanApproval key={curKey} ask={cur} chatTitle={name} onEscape={later} keysTo={keysEl} testid="qwin-plan" />
              : <RequestPanel key={curKey} req={cur} variant="window" chatTitle={name} harness={harness} commands={commands} onEscape={later} keysTo={keysEl} testid="qwin-card" />}
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

/** What a tile (or the Orchestrator) keeps of its requests while the window answers them, or while they wait in "Da
 *  rispondere" (`queued`, the chat stays blocked): one line, its button opens the window on the first of them. */
export function InWindowLine({ reqs, testid, queued }: { reqs: readonly PendingRequest[]; testid: string; queued?: boolean }) {
  const n = reqs.length === 1 ? t('chat.questions.one') : t('chat.questions.many', { n: reqs.length });
  const r = t('chat.questions.requestsCount', { n: reqs.length });
  const first = reqs[0] ? reqKey(reqs[0]) : null;
  return (
    <div className={`sent-to-orchestrator in-window ${queued ? 'in-queue' : ''}`} role="status" data-testid={testid} data-queued={queued ? '' : undefined}>
      <IconQuestion size={13} />
      <span>{queued ? t('chat.questions.inQueue', { noun: r }) : t('chat.questions.inWindow', { noun: n })}</span>
      <button type="button" className="btn btn-ghost btn-s" onClick={() => openQueue(first)} data-testid={`${testid}-open`}>{queued ? t('chat.questions.openQueue') : t('chat.questions.openWindow')}</button>
    </div>
  );
}
