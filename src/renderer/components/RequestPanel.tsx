// A question (AskUserQuestion) or a permission as a panel with numbered choices, in three sizes: a needs-lane card,
// the inline panel of a chat tile (also the questions window's and the global layer's card), and the Orchestrator's violet
// "decisione" (the Orchestrator's own requests only: a work chat's never show in the Orchestrator, the user 2026-10-13). The focused panel
// answers with 1-9 / Enter / Esc / arrows (lib/keys.ts); clicks do the same. Every question also takes a free-text
// "Altro…" answer (the digit after the last option, or a click): a short box where Enter sends and Esc goes back.
// A permission says on top, in plain Italian, what the command does (shared/explain.ts: Bash's description, a sentence
// from Read/Edit parameters, a readable MCP name, Cursor's kind and title); the raw command sits under it on one line,
// unfolded with a click. A question may carry the commands its chat gave in the same turn (`commands`, code blocks with
// "Esegui": the questions window, QuestionsWindow.tsx).
// The option the agent marked "(consigliato)" is the highlighted one; multi-select options are checkboxes with a
// "Conferma" that counts the picks. Answering from the lane never opens the chat: focus moves to the next card.
// A "Comando da eseguire" (type 'command') is handed to CommandRequest.tsx, in the same sizes.
// The tile, compact and Orchestrator sizes carry the request's context (AskContext.tsx: the turn's prose, its links and files), folded
// in the chat's own tile, open in a work chat's Orchestrator card and in the questions window (`ctxOpen`).
// Agents ask only yes/no questions (shared/yes-no.ts, ADR 0134): Sì / No (the No card in the refusal's tone), «Altro…»
// for his own words and «Ci penso dopo».
// With `onLater` a "Ci penso dopo" button leaves it unanswered (every host passes lib/later.ts answerLater: it waits in
// "Da rispondere"; Esc does the same when the host gives `onEscape`; then a permission is rejected with 3, never Esc).
// The questions window has its own size (`window`, ADR 0049): a muted lead on top (the agent's context sentence split
// from its question by lib/askSplit.ts when certain, else two lines of why), the question large, a text to approve as a
// document, the options as large cards (the recommended one marked by color, border and a label), the
// keys in the window's footer.
// Used by NeedsLane, ChatTile, OrchestratorTile, OverlayApp, QuestionsWindow.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import{t}from'../i18n';
import { explainTool } from '@shared/explain';
import { isYesNo, yesNoOf } from '@shared/yes-no';
import type { Answer, EngineInfo, Harness, PendingRequest } from '@shared/contract';
import { answerText, confirmPicks, getPermissionOptions, initialDraft, markedRecommended, permissionAnswer, pickOption, requestKey, type Draft, type KeyResult } from '../lib/keys';
import { ago, toolLabel } from '../lib/format';
import { useNow } from '../lib/clock';
import { engineOf } from '../lib/engines';
import { answer, app } from '../store/store';
import { claimFocus, focusChat, reqKey } from '../actions';
import { CommandRequest, type CommandHandlers } from './CommandRequest';
import { AskContext } from './AskContext';
import { qwinStats } from '../lib/questions';
import { withoutImages } from '../lib/askImages';
import { splitAsk } from '../lib/askSplit';
import { HarnessMark, IconQuestion, IconShield } from './Icons';
import { Kbd } from './ui';
import { Gist } from './Gist';
import { ChoiceCard } from './genui/ChoiceCard';

/** plain = a question alone, inside a host card that already says who asks (a Strategist's plan card, StrategyPanel.tsx) */
type Variant = 'lane' | 'tile' | 'orchestrator' | 'compact' | 'window' | 'plain';

/** The raw command of a permission: its first line, the rest unfolded with a click (never hidden: the user approves it). */
function RawCommand({ raw, testBase, onToggle }: { raw: string; testBase: string; onToggle: () => void }) {
  const [open, setOpen] = useState(false);
  const lines = raw.split('\n');
  const more = lines.length > 1 || raw.length > 110;
  return (
    <div className={`ask-raw ${open ? 'open' : ''}`}>
      <pre className="ask-cmd" data-testid={`${testBase}-raw`}>{open ? raw : lines[0]}</pre>
      {more && (
        <button type="button" className="ask-raw-toggle" onClick={() => { setOpen(o => !o); onToggle(); }} aria-expanded={open} data-testid={`${testBase}-raw-toggle`}>
          {open ? t('genui.request.less') : lines.length > 1 ? t('genui.request.commandLines', { count: lines.length }) : t('genui.request.command')}
        </button>
      )}
    </div>
  );
}

type PanelProps = {
  req: PendingRequest; variant: Variant; chatTitle?: string; harness?: Harness;
  /** the chat's engine when this page has no app:info (the global layer); else looked up by harness */
  engine?: EngineInfo | null;
  onAnswered?: () => void; onAnswer?: (a: Answer) => void; onEscape?: () => void; testid?: string;
  /** a command card's actions through someone else (the global layer) */
  command?: Omit<CommandHandlers, 'onEscape'>;
  /** the asking chat's commands of this turn (code blocks with "Esegui"), below the choices */
  commands?: ReactNode;
  /** the request's context starts unfolded (the questions window) */
  ctxOpen?: boolean;
  /** "Rispondi dopo": a button that sets the request aside without answering */
  onLater?: () => void;
  /** where the questions window wants a question's keys (its footer): written here, for the step shown */
  keysTo?: HTMLElement | null;
};

/** onAnswer: answer through someone else (the global layer relays to the app page); onEscape: what Esc does instead of
 *  rejecting a permission / leaving a question (the popups: "Rispondi dopo", lib/later.ts). */
export function RequestPanel(p: PanelProps) {
  if (p.req.type !== 'command') return <AskPanel {...p} />;
  // "Vai alla chat" where the chat is not already on screen around the card: the lane, the Orchestrator, the layer
  const open = p.command?.onOpen ?? (p.variant === 'lane' || p.variant === 'orchestrator' ? () => focusChat(p.req.chatId) : undefined);
  // the turn's prose one click away, except in the global layer (p.command: its page can not read the chat)
  return <CommandRequest req={p.req} variant={p.variant === 'plain' ? 'tile' : p.variant} chatTitle={p.chatTitle} harness={p.harness} testid={p.testid} onEscape={p.onEscape} onLater={p.onLater} withContext={!p.command} {...p.command} onOpen={open} />;
}

/** A half-given answer (a step of several, a free text being written) per request: it survives the panel going away
 *  while the request still waits (the questions window shows another one first: "Altre in attesa", ADR 0044). */
const drafts = new Map<string, { draft: Draft; other: string | null }>();

function AskPanel({ req, variant, chatTitle, harness = 'claude', engine, onAnswered, onAnswer, onEscape, onLater, testid, commands, ctxOpen, keysTo }: {
  req: PendingRequest; variant: Variant; chatTitle?: string; harness?: Harness; engine?: EngineInfo | null; onAnswered?: () => void; onAnswer?: (a: Answer) => void; onEscape?: () => void; testid?: string;
  /** the asking chat's commands of this turn (code blocks with "Esegui"), below the choices */
  commands?: ReactNode;
  /** the context block starts open (default: folded) */
  ctxOpen?: boolean;
  onLater?: () => void;
  keysTo?: HTMLElement | null;
}) {
  const key = reqKey(req);
  const eng = engine ?? engineOf(harness);
  const [draft, setDraft] = useState<Draft>(() => drafts.get(key)?.draft ?? initialDraft(req));
  const [sent, setSent] = useState(false);
  const [other, setOther] = useState<string | null>(() => drafts.get(key)?.other ?? null);
  useEffect(() => {
    if (sent) drafts.delete(key); else drafts.set(key, { draft, other });
  }, [key, draft, other, sent]);
  // gone with the request (answered elsewhere, the chat stopped): nothing kept
  useEffect(() => () => { if (!app.get().pending.some(p => reqKey(p) === key)) drafts.delete(key); }, [key]);
  const ref = useRef<HTMLDivElement>(null);
  const now = useNow(15_000);
  // Ctrl+J asked for this card before it was drawn: the keyboard comes here as it mounts (actions.ts claimFocus)
  useLayoutEffect(() => { if (claimFocus(key)) ref.current?.focus({ preventScroll: true }); }, [key]);
  const q = req.questions?.[draft.step];
  const testBase = testid ?? (variant === 'lane' ? `lane-card-${req.chatId}-${req.id}` : `request-${req.chatId}-${req.id}`);
  const isPerm = req.type === 'permission';
  // free text on every question; Cursor gets it as a skip with the text as the reason (its ACP answer has room only
  // for option ids: acp.ts freeTextReason), so the box says so
  const canOther = !isPerm && !!q;
  const otherKey = q && q.options.length < 9 ? String(q.options.length + 1) : null;

  const finish = (a: Answer, viaKey = false) => {
    setSent(true);
    if (onAnswer) { onAnswer(a); return; }
    // keyboard flow only (never after a click): the next card of the lane (or the next panel) takes the focus
    const here = ref.current;
    // in the questions window the window itself gives the next card the keyboard (QuestionsWindow.tsx)
    if (viaKey && here && here.contains(document.activeElement) && !here.closest('.qwin')) {
      const all = [...document.querySelectorAll<HTMLElement>(variant === 'lane' ? '[data-lane][data-request-key]' : '[data-request-key]')];
      const next = all[all.indexOf(here) + 1] ?? all.find(x => x !== here);
      requestAnimationFrame(() => { if (next && next.isConnected) next.focus(); else document.querySelector<HTMLElement>('[data-testid="orchestrator-input"]')?.focus(); });
    }
    void answer(req, a).then(ok => { if (ok) onAnswered?.(); else setSent(false); });
  };
  const apply = (r: KeyResult, viaKey = false) => {
    if (r.other) { if (canOther) setOther(''); return; }
    setDraft(r.draft);
    // the next question of the same request: the panel keeps the keyboard (the clicked button or the box may be gone)
    // (and after a click that only ticks an option, so Enter confirms instead of clicking the same option again)
    if (!r.answer && !r.blur) requestAnimationFrame(() => ref.current?.focus());
    if (r.answer) finish(r.answer, viaKey);
    if (r.blur) ref.current?.blur();
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (sent) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return; // typing the "Altro…" answer
    // a command's code block on the Orchestrator card (its buttons, its output read with the arrows): its keys stay its own
    if ((e.target as HTMLElement).closest('.codeblock, [data-option-preview]')) return;
    // Enter / Space on a focused button (Tab to "Rifiuta", "Invia", an option) is that button's own click
    if ((tag === 'BUTTON' || tag === 'A') && e.target !== e.currentTarget && (e.key === 'Enter' || e.key === ' ')) return;
    // Tab from the card reaches an option first, before the "Contesto" toggle and its links (Shift+Tab goes back to them)
    if (e.key === 'Tab' && !e.shiftKey && e.target === e.currentTarget) {
      const first = ref.current?.querySelector<HTMLElement>(`[data-testid="${testBase}-opt-1"]`);
      if (first) { e.preventDefault(); first.focus(); return; }
    }
    if (e.key === 'Escape' && onEscape && !e.ctrlKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); onEscape(); return; }
    const r = requestKey(req, draft, e);
    if (!r.handled) return;
    e.preventDefault();
    e.stopPropagation();
    apply(r, true);
  };
  const sendOther = () => {
    if (other === null) return;
    const r = answerText(req, draft, other);
    if (!r.handled) return;
    setOther(null);
    apply(r, true);
  };
  const closeOther = () => { setOther(null); ref.current?.focus(); };
  // a click on the context's toggle: the keyboard stays on the panel (1-9 / Enter keep answering)
  const refocus = () => requestAnimationFrame(() => ref.current?.focus({ preventScroll: true }));

  const ex = isPerm ? explainTool(req.tool, req.input, req.title) : null;
  // the raw part: the command (or path, url) first, then the detail lines that say something more (reason, path)
  const rawFull = isPerm ? [ex?.raw ?? '', ...req.detail.split('\n').filter(l => l.trim() && !(ex?.raw ?? '').includes(l.trim()) && l.trim().toLowerCase() !== ex?.line.toLowerCase())].filter(Boolean).join('\n') : '';
  const age = ago(req.at, now);
  // a question's markdown images show as thumbnails (AskImages.tsx), never as ![](…) in the title
  const title = isPerm ? (ex?.line ?? req.title) : withoutImages(q?.question ?? req.title);
  const total = req.questions?.length ?? 0;
  const stepBadge = total > 1 ? <span className="step" data-testid={`${testBase}-step`}>{draft.step + 1} {t('genui.request.of')} {total}</span> : null;
  const recIdx = q ? markedRecommended(q.options) : -1;
  const common = {
    ref, tabIndex: 0, onKeyDown: onKey, 'data-request-key': key, 'data-testid': testBase, 'aria-busy': sent,
    role: 'group' as const, 'aria-label': t('genui.request.from', { kind: t(isPerm ? 'genui.request.permission' : 'genui.request.question'), chat: chatTitle, title }),
  };

  // the free-text box, the same in every size
  const otherBox = (compact: boolean): ReactNode => (
    <div className={`other-box ${compact ? 'compact' : ''}`} data-testid={`${testBase}-other-box`}>
      <textarea className="other-input" autoFocus rows={compact ? 1 : 2} value={other ?? ''} placeholder={t('genui.request.write')} aria-label={t('genui.request.free')} data-testid={`${testBase}-other-input`}
        onChange={e => setOther(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); sendOther(); }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeOther(); }
        }} />
      {eng?.kind === 'acp' && !compact && <div className="other-note" data-testid={`${testBase}-other-note`}>{t('genui.request.written', { engine: eng.label })}</div>}
      <div className="other-actions">
        <span className="other-hint"><Kbd>{t('genui.request.enter')}</Kbd>{' '}{t('genui.request.sendHint')} · <Kbd>Esc</Kbd>{' '}{t('genui.request.backHint')}</span>
        <span className="sp" />
        <button type="button" className="btn btn-ghost btn-s" onClick={closeOther} data-testid={`${testBase}-other-cancel`}>{t('genui.request.cancel')}</button>
        <button type="button" className="btn btn-primary btn-s" onClick={sendOther} disabled={sent || !(other ?? '').trim()} data-testid={`${testBase}-other-send`}>{t('genui.request.send')}</button>
      </div>
    </div>
  );

  const laterBtn = onLater ? (
    <button type="button" className="btn btn-ghost btn-s ask-later" onClick={onLater} disabled={sent} data-testid={`${testBase}-later`}
      data-tip={t('genui.request.laterHint')}>{t('genui.request.later')}{onEscape && <Kbd>Esc</Kbd>}</button>
  ) : null;

  // One renderer for every host; disclosure actions are separate from answering.
  // a yes/no question (the only kind agents ask, ADR 0134): its No card has the refusal's tone
  const yesNo = !!q && isYesNo(q);
  const choiceCards = () => q?.options.map((option, i) => (
    <ChoiceCard key={draft.step + ':' + i} option={option} number={i + 1} recommended={i === recIdx} previewOpen={variant === 'window'}
      tone={yesNo && yesNoOf(option.label) === 'no' ? 'deny' : undefined}
      picked={draft.picks.includes(i)} multi={q.multiSelect} current={i === draft.cursor} disabled={sent}
      onChoose={() => apply(pickOption(req, draft, i))} testid={testBase + '-opt-' + (i + 1)} />
  ));
  const permissionCards = () => getPermissionOptions().map((option, i) => i === 1 && req.noAlways ? null : (
    <ChoiceCard key={i} option={{ label: option.label, description: i === 0 ? t('genui.permission.once')
      : i === 1 ? t('genui.permission.session') + (req.alwaysRules?.length ? ': ' + req.alwaysRules.join(', ') : '')
      : t('genui.permission.deny') }} number={i + 1} tone={i === 2 ? 'deny' : undefined} disabled={sent}
      onChoose={() => finish(permissionAnswer(i))} testid={testBase + '-opt-' + (i + 1)} />
  ));

  // ---------- chips (lane, orchestrator, compact)
  const chips = () => {
    if (isPerm) {
      return permissionCards();
    }
    if (!q) return null;
    if (other !== null) return otherBox(true);
    return (
      <>
        {choiceCards()}
        {canOther && (
          <button type="button" className="chip-opt chip-other" onClick={() => setOther('')} disabled={sent} data-testid={`${testBase}-other`} title={t('genui.request.write')}>
            {otherKey && <Kbd>{otherKey}</Kbd>}<span className="chip-l">{t('ui.other')}</span>
          </button>
        )}
        {q.multiSelect && (
          <button type="button" className="chip-opt chip-confirm" onClick={() => apply(confirmPicks(req, draft))} disabled={sent || draft.picks.length === 0} data-testid={`${testBase}-confirm`}>
            <Kbd>{t('genui.request.enter')}</Kbd><span className="chip-l">{t('genui.request.confirm')}{draft.picks.length ? ` (${draft.picks.length})` : ''}</span>
          </button>
        )}
      </>
    );
  };

  // ---------- the questions window (ADR 0049): one page, read top to bottom
  if (variant === 'window') {
    qwinStats.cardRenders++;
    const kicker = isPerm ? `${t('genui.request.permission')} · ${toolLabel(req.tool)}` : (q?.header ?? t('genui.request.question'));
    // the agent's context sentence muted on top, the real question large under it (only when the split is certain)
    const split = isPerm ? null : splitAsk(title);
    return (
      <div {...common} className={`wq ${isPerm ? 'perm' : 'question'} ${sent ? 'sent' : ''}`}>
        {keysTo && q && createPortal(<><Kbd>1</Kbd>–<Kbd>{otherKey ?? q.options.length}</Kbd>{' '}{t('genui.request.choose')} <Kbd>↑</Kbd><Kbd>↓</Kbd>{' '}{t('genui.request.move')} <Kbd>{t('genui.request.enter')}</Kbd>{' '}{t('genui.request.confirmHint')}</>, keysTo)}
        <div className="wq-kicker">
          {/* a permission says in two words what it does (shared/gist.ts) */}
          {isPerm && <Gist tool={req.tool} input={req.input} testid={`${testBase}-gist`} />}
          <span className="wq-kind">{isPerm ? <IconShield size={12} /> : <IconQuestion size={12} />}<span data-testid={isPerm ? undefined : `${testBase}-header`}>{kicker}</span></span>
          {total > 1 && <span className="wq-step" data-testid={`${testBase}-step`}>{draft.step + 1} {t('genui.request.of')} {total}</span>}
          {q?.multiSelect && <span className="wq-step">{t('genui.request.multiple')}</span>}
        </div>
        <AskContext req={req} defaultOpen testBase={testBase} layout="window" lead={split?.lead}
          question={<h2 className="wq-q" data-testid={isPerm ? `${testBase}-explain` : `${testBase}-q`}>{split?.ask ?? title}</h2>} />
        {isPerm ? (
          <>
            {/* the whole command, wrapped: it is what the user approves */}
            {rawFull && <pre className="ask-cmd wq-raw" data-testid={`${testBase}-raw`}>{rawFull}</pre>}
            <div className="wq-perm">{permissionCards()}
            </div>
          </>
        ) : q ? (
          <>
            {commands && <div className="wq-cmds"><div className="wq-label">{t('genui.request.commands')}</div>{commands}</div>}
            <div className={`wq-opts ${yesNo ? 'yesno' : ''}`} role={q.multiSelect ? 'group' : undefined}>
              {choiceCards()}
              {canOther && (other === null ? (
                <button type="button" className="wq-opt wq-other" onClick={() => setOther('')} disabled={sent} data-testid={`${testBase}-other`}>
                  <span className="wq-key" aria-hidden="true">{otherKey ?? '…'}</span>
                  <span className="wq-opt-text"><span className="wq-opt-label">{t('genui.request.ownWords')}</span></span>
                </button>
              ) : otherBox(false))}
            </div>
            {q.multiSelect && (
              <div className="wq-confirm">
                <span className="wq-count" data-testid={`${testBase}-count`}>{t('genui.request.count', { count: draft.picks.length })}</span>
                <button type="button" className="btn btn-primary btn-l" onClick={() => apply(confirmPicks(req, draft))} disabled={sent || draft.picks.length === 0} data-testid={`${testBase}-confirm`}>{t('genui.request.confirm')} <Kbd>{t('genui.request.enter')}</Kbd></button>
              </div>
            )}
          </>
        ) : null}
      </div>
    );
  }

  if (variant === 'lane' || variant === 'compact') {
    return (
      <div {...common} className={`need-card ${isPerm ? 'perm' : 'question'} ${sent ? 'sent' : ''}`} data-lane={variant === 'lane' ? '' : undefined}>
        <div className="need-head">
          {variant === 'lane' ? (
            <><HarnessMark harness={harness} size={16} /><b className="need-title">{chatTitle}</b></>
          ) : (
            <span className="need-kind-head">{isPerm ? <IconShield size={13} /> : <IconQuestion size={13} />}{isPerm ? `${t('genui.request.permission')} · ${req.tool}` : (q?.header ?? t('genui.request.question'))}</span>
          )}
          {stepBadge}
          <span className="need-age">{age}</span>
        </div>
        <div className="need-q" title={isPerm ? rawFull || title : title} data-testid={isPerm ? `${testBase}-explain` : undefined}>
          {isPerm && variant === 'lane' ? <span className="need-kind">{t('genui.request.permission')}</span> : null}
          {title}
        </div>
        {isPerm && rawFull && <code className="need-raw" title={rawFull} data-testid={`${testBase}-raw`}>{rawFull.split('\n')[0]}</code>}
        {variant === 'compact' && <AskContext req={req} defaultOpen={false} testBase={testBase} onToggle={refocus} />}
        <div className="need-opts">{chips()}</div>
        {laterBtn && <div className="ask-later-row">{laterBtn}</div>}
      </div>
    );
  }

  if (variant === 'plain' && q) {
    return (
      <div {...common} className={`ask-plain ${sent ? 'sent' : ''}`}>
        <div className="ask-plain-q" data-testid={`${testBase}-q`}>{title}{stepBadge}</div>
        <div className="ask-plain-opts" role={q.multiSelect ? 'group' : undefined}>
          {choiceCards()}
          {canOther && (other === null ? (
            <button type="button" className="ask-plain-other" onClick={() => setOther('')} disabled={sent} data-testid={`${testBase}-other`}>
              {otherKey && <Kbd>{otherKey}</Kbd>}<span>{t('genui.request.ownWords')}</span>
            </button>
          ) : otherBox(false))}
        </div>
        {q.multiSelect && (
          <button type="button" className="btn btn-primary btn-s" onClick={() => apply(confirmPicks(req, draft))} disabled={sent || draft.picks.length === 0} data-testid={`${testBase}-confirm`}>{t('genui.request.confirm')} <Kbd>{t('genui.request.enter')}</Kbd></button>
        )}
      </div>
    );
  }

  if (variant === 'orchestrator') {
    return (
      <div {...common} className={`decision ${sent ? 'sent' : ''}`}>
        <div className="decision-k">{t('genui.request.decision')}{q?.header ? ` · ${q.header}` : ''}{stepBadge}</div>
        <div className="decision-q" title={isPerm ? rawFull || undefined : undefined}>{title}</div>
        {isPerm && rawFull && <code className="need-raw" title={rawFull} data-testid={`${testBase}-raw`}>{rawFull.split('\n')[0]}</code>}
        <AskContext req={req} defaultOpen={!!ctxOpen} testBase={testBase} onToggle={refocus} />
        <div className="need-opts">{chips()}</div>
        {laterBtn && <div className="ask-later-row">{laterBtn}</div>}
        {/* after the choices: Tab from the card reaches an option first, never a command's Esegui */}
        {commands}
      </div>
    );
  }

  // ---------- full inline panel of a tile (and the global layer)
  const n = q?.options.length ?? 0;
  const tileSplit = isPerm ? null : splitAsk(title);
  return (
    <div {...common} className={`ask ${isPerm ? 'perm' : 'question'} ${sent ? 'sent' : ''}`}>
      <div className="ask-head">
        <span className="ask-icon">{isPerm ? <IconShield size={14} /> : <IconQuestion size={14} />}</span>
        <span className="ask-kind">{t(isPerm ? 'genui.request.permission' : 'genui.request.question')}</span>
        {isPerm ? <span className="ask-chip">{toolLabel(req.tool)}</span> : q?.header ? <span className="ask-chip" data-testid={`${testBase}-header`}>{q.header}</span> : null}
        {q?.multiSelect && <span className="ask-chip soft">{t('genui.request.multiple')}</span>}
        {stepBadge}
        <span className="sp" />
        <span className="ask-age">{age}</span>
        {laterBtn}
      </div>
      {tileSplit && <div className="ask-lead" data-testid={`${testBase}-ctx-lead`}>{tileSplit.lead}</div>}
      <div className="ask-q" data-testid={isPerm ? `${testBase}-explain` : undefined}>{tileSplit?.ask ?? title}</div>
      {/* not in the global layer (onAnswer): its page can neither read the chat nor open links; "Apri" leads to the chat */}
      {!onAnswer && <AskContext req={req} defaultOpen={!!ctxOpen} testBase={testBase} onToggle={refocus} />}
      {isPerm ? (
        <>
          {rawFull && <RawCommand raw={rawFull} testBase={testBase} onToggle={() => requestAnimationFrame(() => ref.current?.focus())} />}
          <div className="ask-actions">{permissionCards()}
          </div>
        </>
      ) : q ? (
        <>
          <div className="ask-opts" role={q.multiSelect ? 'group' : undefined}>
            {choiceCards()}
            {canOther && (other === null ? (
              <button type="button" className="ask-opt ask-opt-other" onClick={() => setOther('')} disabled={sent} data-testid={`${testBase}-other`}>
                {otherKey ? <Kbd>{otherKey}</Kbd> : <span className="ask-check" aria-hidden="true" />}
                <span className="ask-opt-text">
                  <span className="ask-opt-label">{t('ui.other')}</span>
                  <span className="ask-opt-desc">{t('ui.writeAnswer')}</span>
                </span>
              </button>
            ) : otherBox(false))}
          </div>
          {q.multiSelect ? (
            <div className="ask-foot">
              <span className="ask-hint" data-testid={`${testBase}-count`}>{t('genui.request.count', { count: draft.picks.length })} · <Kbd>1</Kbd>–<Kbd>{n}</Kbd>{' '}{t('genui.request.toChoose')}</span>
              <span className="sp" />
              <button type="button" className="btn btn-primary btn-m" onClick={() => apply(confirmPicks(req, draft))} disabled={sent || draft.picks.length === 0} data-testid={`${testBase}-confirm`}>{t('genui.request.confirm')} <Kbd>{t('genui.request.enter')}</Kbd></button>
            </div>
          ) : other === null && (
            <div className="ask-foot">
              <span className="ask-hint"><Kbd>1</Kbd>–<Kbd>{n}</Kbd>{' '}{t('genui.request.choose')} · <Kbd>↑</Kbd><Kbd>↓</Kbd>{' '}{t('genui.request.move')} · <Kbd>{t('genui.request.enter')}</Kbd>{' '}{t('genui.request.confirmHint')}</span>
            </div>
          )}
        </>
      ) : null}
      {/* after the choices: Tab from the card reaches an option first, never a command's Esegui */}
      {commands}
    </div>
  );
}
