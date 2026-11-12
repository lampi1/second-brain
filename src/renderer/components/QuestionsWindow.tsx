// The questions inside the Orchestrator (the owner, 2026-11-12: «le domande come tooltip nell'orchestrator, non come
// modale così invadente, sempre espandibile»; ADR 0269). Every open question, permission, command and plan from every chat
// sits at the bottom of the Orchestrator's column as one short row each (who asks, the question, Sì / No right on the row
// for a yes/no question, ▾): a click opens that row as the full card (the same Bivio card the old window showed:
// RequestPanel size `window`, PlanApproval, WorkApproval), one open at a time. Nothing floats over the page, nothing takes
// the keyboard by itself. Ctrl+J, the top bar's counter, a strip's «aspetta te» and the Orchestrator's recap
// (app_unblock) open the row they name here (store/ui.ts callQuestions → qwin.first / call). «Ci penso dopo» moves a
// row into one folded line «N da rispondere dopo» (lib/later.ts). A chat's own tile never shows its requests: one line says they went to the Orchestrator
// (InWindowLine). A command the chat left before its question comes first (ADR 0259). Mounted by OrchestratorTile.tsx.
import { WriteViaOrchestrator } from '../lib/write-via-orchestrator';
import { answerableInWords } from '@shared/answer-in-words';
import { userOnlyText } from '@shared/away';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Harness, PendingRequest } from '@shared/contract';
import { isYesNo, yesNoOf } from '@shared/yes-no';
import { focusChat, reqKey } from '../actions';
import { qwinStats } from '../lib/questions';
import { commandsOfTurn } from '../lib/orchestrator-route';
import { sameList } from '../store/state';
import { answer, app, useApp } from '../store/store';
import { parkQuestions, ui } from '../store/ui';
import { answerLater, openQueue, requestPostponed } from '../lib/later';
import { HarnessMark, IconArrowRight, IconChevronDown, IconChevronRight, IconQuestion, IconX } from './Icons';
import { ago } from '../lib/format';
import { useNow } from '../lib/clock';
import { CodeBlock } from './CodeBlock';
import { RequestPanel } from './RequestPanel';
import { PlanApproval } from './PlanApproval';
import { planAskKeys, planAskOf, withPlans, type PlanAsk } from '../lib/plan-ask';
import { Kbd } from './ui';
import { t } from '../i18n';
import { durableAsks, withDurableAsks, type DurableAsk } from '../lib/work-ask';
import { useWorkflows } from '../store/workflows';
import { WorkApproval } from './WorkApproval';
import { AskItemsProvider, useFrozenItems } from '../lib/askItems';

/** A command a chat left right before the question it stopped on comes first (ADR 0259): run it, and its result
 *  answers that question by itself (run/results.ts), so the user never answers «l'hai eseguito?». */
function commandsFirst<T extends { type: string; chatId: string }>(asks: readonly T[]): T[] {
  const out = [...asks];
  for (let i = 0; i < out.length; i++) {
    const c = out[i]!;
    if (c.type !== 'command') continue;
    const q = out.findIndex(x => x.chatId === c.chatId && x.type !== 'command');
    if (q >= 0 && q < i) { out.splice(i, 1); out.splice(q, 0, c); }
  }
  return out;
}

/** what the window shows: an open request, or a Strategist's plan to approve */
type Ask = PendingRequest | PlanAsk | DurableAsk;
const isHost = (ask: Ask): ask is DurableAsk => isDurable(ask);
const isDurable = (ask: Ask): ask is DurableAsk => ask.type === 'work' || ask.type === 'lesson';

export function OrchestratorAsks() {
  const hidden = ui.use(s => s.hidden, sameList);
  const q = ui.use(s => s.qwin);
  const allPending = useApp(s => s.pending.filter(p => !s.chats[p.chatId]?.quick), sameList);
  const planKeys = useApp(planAskKeys, sameList);
  const plans = useMemo(() => planKeys.map(planAskOf).filter((p): p is PlanAsk => !!p), [planKeys]);
  const { rows, lessons } = useWorkflows();
  const decisions = useMemo(() => durableAsks(rows, lessons), [rows, lessons]);
  const pending: readonly Ask[] = [...withDurableAsks(withPlans(allPending, plans), decisions)].filter(p => isHost(p) || !hidden.includes(p.chatId));
  const queue = commandsFirst(pending);
  const now = queue.filter(p => !requestPostponed(reqKey(p)));
  const later = queue.filter(p => requestPostponed(reqKey(p)));
  const ordered = [...now, ...later];
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [laterOpen, setLaterOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // Ctrl+J, a «Rispondi» elsewhere, the recap: that row opens here (the first waiting one when none is named)
  const lastCall = useRef(q.call);
  useEffect(() => {
    if (!q.open && lastCall.current === q.call) return;
    const called = lastCall.current !== q.call;
    lastCall.current = q.call;
    const key = q.first ?? (now[0] ? reqKey(now[0]) : ordered[0] ? reqKey(ordered[0]) : null);
    if (key) setOpenKey(key);
    parkQuestions();
    if (called && key) requestAnimationFrame(() => {
      const el = box.current?.querySelector<HTMLElement>(`[data-ask-row="${CSS.escape(key)}"]`);
      el?.scrollIntoView({ block: 'nearest' });
      el?.querySelector<HTMLElement>('[data-request-key]')?.focus({ preventScroll: true });
    });
  }, [q.call, q.open, q.first]);
  if (!ordered.length) return null;
  const n = now.length;
  // the ones set aside fold into one quiet line (opened by a click, or when one of them is called by name)
  const shownLater = laterOpen || (!!openKey && later.some(p => reqKey(p) === openKey));
  return (
    <div ref={box} className="oasks" role="region" aria-label={t('chat.questions.pendingAriaLabel')} data-testid="orchestrator-asks">
      {n > 0 && <div className="oasks-k">{n === 1 ? t('chat.questions.one') : t('chat.questions.many', { n })}</div>}
      {now.map(a => {
        const k = reqKey(a);
        return <AskRow key={k} ask={a} open={openKey === k} later={false} onToggle={() => setOpenKey(o => (o === k ? null : k))} onClose={() => setOpenKey(null)} />;
      })}
      {later.length > 0 && (
        <button type="button" className="oasks-later" onClick={() => setLaterOpen(v => !v)} aria-expanded={shownLater} data-testid="orchestrator-asks-later">
          {shownLater ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
          <span>{t('chat.questions.laterCount', { n: later.length })}</span>
        </button>
      )}
      {shownLater && later.map(a => {
        const k = reqKey(a);
        return <AskRow key={k} ask={a} open={openKey === k} later onToggle={() => setOpenKey(o => (o === k ? null : k))} onClose={() => setOpenKey(null)} />;
      })}
    </div>
  );
}

/** the yes / no options of a one-step yes/no question, for the row's own buttons */
function quickYesNo(ask: Ask): { question: string; yes: string; no: string } | null {
  if (isDurable(ask) || ask.type !== 'question' || ask.questions?.length !== 1) return null;
  const q = ask.questions[0]!;
  if (q.multiSelect || !isYesNo(q)) return null;
  const yes = q.options.find(o => yesNoOf(o.label) === 'yes'), no = q.options.find(o => yesNoOf(o.label) === 'no');
  return yes && no ? { question: q.question, yes: yes.label, no: no.label } : null;
}

function AskRow({ ask, open, later, onToggle, onClose }: { ask: Ask; open: boolean; later: boolean; onToggle: () => void; onClose: () => void }) {
  const onLater = () => { answerLater(reqKey(ask)); if (open) onClose(); };
  qwinStats.renders++;
  const name = useApp(s => isHost(ask) ? ask.title : (s.chats[ask.chatId]?.isOrchestrator ? 'Orchestrator' : (s.chats[ask.chatId]?.agent?.name || s.chats[ask.chatId]?.title || 'Chat')));
  const harness = useApp(s => s.chats[ask.chatId]?.harness ?? 'claude');
  const isOrchestrator = useApp(s => isHost(ask) || !!s.chats[ask.chatId]?.isOrchestrator);
  const now = useNow(30_000);
  const k = reqKey(ask);
  const yn = quickYesNo(ask);
  const [sent, setSent] = useState(false);
  const title = isDurable(ask) ? ask.title : ask.type === 'plan' ? t('tree.plan.ask.kicker')
    : ask.type === 'permission' ? `${t('chat.questions.permission')}: ${ask.title}`
    : ask.type === 'command' ? `${t('chat.questions.command')}: ${ask.title}`
    : (ask.questions?.[0]?.question ?? ask.title).replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim();
  const quick = (label: string) => {
    if (!yn || sent || isDurable(ask) || ask.type === 'plan') return;
    setSent(true);
    void answer(ask, { kind: 'question', answers: { [yn.question]: label } }).then(ok => { if (!ok) setSent(false); });
  };
  return (
    <div className={`oask ${open ? 'open' : ''} ${later ? 'later' : ''}`} data-ask-row={k} data-testid="orchestrator-ask">
      <div className="oask-row">
        <button type="button" className="oask-main" onClick={onToggle} aria-expanded={open} data-testid="orchestrator-ask-toggle">
          <span className="oask-who"><HarnessMark harness={harness} orchestrator={isOrchestrator} size={13} /><span>{name}</span><span className="oask-age">{ago(ask.at, now)}</span>{later && <span className="oask-later">{t('chat.questions.later')}</span>}</span>
          <span className="oask-q">{title}</span>
        </button>
        {yn && !open && <>
          <button type="button" className="oask-yn y" disabled={sent} onClick={() => quick(yn.yes)} data-testid="orchestrator-ask-yes">{t('chat.questions.yes')}</button>
          <button type="button" className="oask-yn n" disabled={sent} onClick={() => quick(yn.no)} data-testid="orchestrator-ask-no">{t('chat.questions.no')}</button>
        </>}
        <button type="button" className="oask-chev" onClick={onToggle} aria-label={open ? t('chat.questions.close') : t('chat.questions.expand')} data-testid="orchestrator-ask-chev">{open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}</button>
        {/* ✕ = «Ci penso dopo» (the owner, 2026-11-12): the row folds into «N da rispondere dopo» */}
        {!later && <button type="button" className="oask-chev oask-x" onClick={onLater} aria-label={t('chat.questions.later')} data-tip={t('chat.questions.laterTip')} data-testid="orchestrator-ask-later"><IconX size={13} /></button>}
      </div>
      {open && <AskCard ask={ask} name={name} harness={harness} onLater={onLater} />}
    </div>
  );
}

function AskCard({ ask, name, harness, onLater }: { ask: Ask; name: string; harness: Harness; onLater: () => void }) {
  const [keysEl, setKeysEl] = useState<HTMLSpanElement | null>(null);
  const k = reqKey(ask);
  // what the Orchestrator can pass on in the user's words (ADR 0274): a plan, an engine question (not a Strategist's
  // interview); the rest (work proposals, commands, forms, the app's own steps) keeps its own box
  const interview = useApp(s => !isHost(ask) && !s.chats[ask.chatId]?.isOrchestrator && !!s.chats[ask.chatId]?.plan);
  // what is his alone keeps its own box: the Orchestrator never passes it on (shared/away.ts userOnlyText)
  const viaOrchestrator = !isDurable(ask) && (ask.type === 'plan' || (answerableInWords(ask) && !interview
    && !userOnlyText([ask.title, ask.detail, ...(ask.questions ?? []).flatMap(q => [q.question, q.header ?? '', ...q.options.map(o => `${o.label} ${o.description ?? ''}`)])].join(' '))));
  // the card reads the chat as it was when it opened (lib/askItems.tsx)
  const frozen = useFrozenItems(ask.chatId, k);
  const items = ask.type === 'question' ? frozen.items : undefined;
  const ownCard = useApp(s => s.pending.some(p => p.chatId === ask.chatId && p.type === 'command'));
  const cmds = useMemo(() => (ownCard ? [] : commandsOfTurn(items)), [items, ownCard]);
  const commands = cmds.length ? (
    <div className="decision-cmds" data-testid="qwin-card-cmds">
      {cmds.map((c, i) => <CodeBlock key={`${c.itemId}.${i}`} chatId={ask.chatId} itemId={c.itemId} lang={c.lang} code={c.code} />)}
    </div>
  ) : null;
  return (
    <div className="oask-card qwin-inline" data-testid="qwin">
      {/* its free answer is written to the Orchestrator, in its input under it (lib/write-via-orchestrator.ts) */}
      <WriteViaOrchestrator.Provider value={viaOrchestrator}>
      <AskItemsProvider chatId={ask.chatId} items={frozen.items}>
        {isDurable(ask)
          ? <WorkApproval key={k} ask={ask} onEscape={onLater} />
          : ask.type === 'plan'
          ? <PlanApproval key={k} ask={ask} chatTitle={name} onEscape={onLater} keysTo={keysEl} testid="qwin-plan" />
          : <RequestPanel key={k} req={ask} variant="window" chatTitle={name} harness={harness} commands={commands} onEscape={onLater} keysTo={keysEl} testid="qwin-card" />}
      </AskItemsProvider>
      </WriteViaOrchestrator.Provider>
      <div className="oask-foot">
        <span className="qwin-keys" ref={setKeysEl} />
        <span className="sp" />
        {!isOrchestratorChat(ask) && <button type="button" className="btn btn-ghost btn-s" onClick={() => focusChat(ask.chatId)} data-testid="qwin-open-chat">{t('chat.questions.openChat')} <IconArrowRight size={12} /></button>}
        <button type="button" className="btn btn-ghost btn-s" onClick={onLater} data-testid="qwin-later" data-tip={t('chat.questions.laterTip')}>{t('chat.questions.later')} <Kbd>Esc</Kbd></button>
      </div>
    </div>
  );
}

const isOrchestratorChat = (ask: Ask): boolean => isHost(ask) || !!app.get().chats[ask.chatId]?.isOrchestrator;

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
