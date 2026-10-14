// A question (AskUserQuestion) or a permission as a panel with numbered choices, in three sizes: a needs-lane card,
// the inline panel of a chat tile (also the questions window's and the global layer's card), and the Regia's violet
// "decisione" (the Regia's own requests only: a work chat's never show in the Regia, the user 2026-10-13). The focused panel
// answers with 1-9 / Enter / Esc / arrows (lib/keys.ts); clicks do the same. Every question also takes a free-text
// "Altro…" answer (the digit after the last option, or a click): a short box where Enter sends and Esc goes back.
// A permission says on top, in plain Italian, what the command does (shared/explain.ts: Bash's description, a sentence
// from Read/Edit parameters, a readable MCP name, Cursor's kind and title); the raw command sits under it on one line,
// unfolded with a click. A question may carry the commands its chat gave in the same turn (`commands`, code blocks with
// "Esegui": the questions window, QuestionsWindow.tsx).
// The option the agent marked "(consigliato)" is the highlighted one; multi-select options are checkboxes with a
// "Conferma" that counts the picks. Answering from the lane never opens the chat: focus moves to the next card.
// A "Comando da eseguire" (type 'command') is handed to CommandRequest.tsx, in the same sizes.
// The tile, compact and Regia sizes carry the request's context (AskContext.tsx: the turn's prose, its links and files), folded
// in the chat's own tile, open in a work chat's Regia card and in the questions window (`ctxOpen`).
// With `onLater` a "Rispondi dopo" button leaves it unanswered (every host passes lib/later.ts answerLater: it waits in
// "Da rispondere"; Esc does the same when the host gives `onEscape`; then a permission is rejected with 3, never Esc).
// Used by NeedsLane, ChatTile, RegiaTile, OverlayApp, QuestionsWindow.
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { explainTool } from '@shared/explain';
import type { Answer, Harness, PendingRequest } from '@shared/contract';
import { answerText, cleanDescription, cleanLabel, confirmPicks, initialDraft, markedRecommended, PERMISSION_OPTIONS, permissionAnswer, pickOption, requestKey, type Draft, type KeyResult } from '../lib/keys';
import { ago, toolLabel } from '../lib/format';
import { useNow } from '../lib/clock';
import { answer } from '../store/store';
import { claimFocus, focusChat, reqKey } from '../actions';
import { CommandRequest, type CommandHandlers } from './CommandRequest';
import { AskContext } from './AskContext';
import { HarnessMark, IconCheck, IconQuestion, IconShield } from './Icons';
import { Kbd } from './ui';

type Variant = 'lane' | 'tile' | 'regia' | 'compact';

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
          {open ? 'Mostra meno' : lines.length > 1 ? `Mostra tutto il comando (${lines.length} righe)` : 'Mostra tutto il comando'}
        </button>
      )}
    </div>
  );
}

type PanelProps = {
  req: PendingRequest; variant: Variant; chatTitle?: string; harness?: Harness; onAnswered?: () => void; onAnswer?: (a: Answer) => void; onEscape?: () => void; testid?: string;
  /** a command card's actions through someone else (the global layer) */
  command?: Omit<CommandHandlers, 'onEscape'>;
  /** the asking chat's commands of this turn (code blocks with "Esegui"), below the choices */
  commands?: ReactNode;
  /** the request's context starts unfolded (the questions window) */
  ctxOpen?: boolean;
  /** "Rispondi dopo": a button that sets the request aside without answering */
  onLater?: () => void;
};

/** onAnswer: answer through someone else (the global layer relays to the app page); onEscape: what Esc does instead of
 *  rejecting a permission / leaving a question (the popups: "Rispondi dopo", lib/later.ts). */
export function RequestPanel(p: PanelProps) {
  if (p.req.type !== 'command') return <AskPanel {...p} />;
  // "Apri chat" where the chat is not already on screen around the card: the lane, the Regia, the layer
  const open = p.command?.onOpen ?? (p.variant === 'lane' || p.variant === 'regia' ? () => focusChat(p.req.chatId) : undefined);
  // the turn's prose one click away, except in the global layer (p.command: its page can not read the chat)
  return <CommandRequest req={p.req} variant={p.variant} chatTitle={p.chatTitle} harness={p.harness} testid={p.testid} onEscape={p.onEscape} onLater={p.onLater} withContext={!p.command} {...p.command} onOpen={open} />;
}

function AskPanel({ req, variant, chatTitle, harness = 'claude', onAnswered, onAnswer, onEscape, onLater, testid, commands, ctxOpen }: {
  req: PendingRequest; variant: Variant; chatTitle?: string; harness?: Harness; onAnswered?: () => void; onAnswer?: (a: Answer) => void; onEscape?: () => void; testid?: string;
  /** the asking chat's commands of this turn (code blocks with "Esegui"), below the choices */
  commands?: ReactNode;
  /** the context block starts open (default: folded) */
  ctxOpen?: boolean;
  onLater?: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => initialDraft(req));
  const [sent, setSent] = useState(false);
  const [other, setOther] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const now = useNow(15_000);
  const key = reqKey(req);
  // Ctrl+J asked for this card before it was drawn: the keyboard comes here as it mounts (actions.ts claimFocus)
  useLayoutEffect(() => { if (claimFocus(key)) ref.current?.focus({ preventScroll: true }); }, [key]);
  const q = req.questions?.[draft.step];
  const testBase = testid ?? (variant === 'lane' ? `lane-card-${req.chatId}-${req.id}` : `request-${req.chatId}-${req.id}`);
  const isPerm = req.type === 'permission';
  // free text on every question; Cursor gets it as a skip with the text as the reason (its ACP answer has room only
  // for option ids: cursor.ts freeTextReason), so the box says so
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
      requestAnimationFrame(() => { if (next && next.isConnected) next.focus(); else document.querySelector<HTMLElement>('[data-testid="regia-input"]')?.focus(); });
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
    // a command's code block on the Regia card (its buttons, its output read with the arrows): its keys stay its own
    if ((e.target as HTMLElement).closest('.codeblock')) return;
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
  const refocus = () => requestAnimationFrame(() => ref.current?.focus());

  const ex = isPerm ? explainTool(req.tool, req.input, req.title) : null;
  // the raw part: the command (or path, url) first, then the detail lines that say something more (reason, path)
  const rawFull = isPerm ? [ex?.raw ?? '', ...req.detail.split('\n').filter(l => l.trim() && !(ex?.raw ?? '').includes(l.trim()) && l.trim().toLowerCase() !== ex?.line.toLowerCase())].filter(Boolean).join('\n') : '';
  const age = ago(req.at, now);
  const title = isPerm ? (ex?.line ?? req.title) : (q?.question ?? req.title);
  const total = req.questions?.length ?? 0;
  const stepBadge = total > 1 ? <span className="step" data-testid={`${testBase}-step`}>{draft.step + 1} di {total}</span> : null;
  const recIdx = q ? markedRecommended(q.options) : -1;
  const common = {
    ref, tabIndex: 0, onKeyDown: onKey, 'data-request-key': key, 'data-testid': testBase, 'aria-busy': sent,
    role: 'group' as const, 'aria-label': `${isPerm ? 'Permesso' : 'Domanda'} da ${chatTitle ?? 'una chat'}: ${title}`,
  };

  // the free-text box, the same in every size
  const otherBox = (compact: boolean): ReactNode => (
    <div className={`other-box ${compact ? 'compact' : ''}`} data-testid={`${testBase}-other-box`}>
      <textarea className="other-input" autoFocus rows={compact ? 1 : 2} value={other ?? ''} placeholder="Scrivi la tua risposta" aria-label="Risposta libera" data-testid={`${testBase}-other-input`}
        onChange={e => setOther(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); sendOther(); }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeOther(); }
        }} />
      {harness === 'cursor' && !compact && <div className="other-note" data-testid={`${testBase}-other-note`}>Cursor la riceve come risposta scritta da te, al posto delle opzioni.</div>}
      <div className="other-actions">
        <span className="other-hint"><Kbd>Invio</Kbd> invia · <Kbd>Esc</Kbd> torna alle scelte</span>
        <span className="sp" />
        <button type="button" className="btn btn-ghost btn-s" onClick={closeOther} data-testid={`${testBase}-other-cancel`}>Annulla</button>
        <button type="button" className="btn btn-primary btn-s" onClick={sendOther} disabled={sent || !(other ?? '').trim()} data-testid={`${testBase}-other-send`}>Invia</button>
      </div>
    </div>
  );

  const laterBtn = onLater ? (
    <button type="button" className="btn btn-ghost btn-s ask-later" onClick={onLater} disabled={sent} data-testid={`${testBase}-later`}
      data-tip="Non rispondi adesso: la chat resta in attesa">Rispondi dopo{onEscape && <Kbd>Esc</Kbd>}</button>
  ) : null;

  // ---------- chips (lane, regia, compact)
  const chips = () => {
    if (isPerm) {
      return PERMISSION_OPTIONS.map((o, i) => (i === 1 && req.noAlways ? null : (
        <button key={o.label} type="button" className={`chip-opt ${i === 0 ? 'rec' : ''} ${i === 2 ? 'deny' : ''}`} onClick={() => finish(permissionAnswer(i))} disabled={sent} data-testid={`${testBase}-opt-${i + 1}`}
          title={i === 1 && req.alwaysRules?.length ? `Per questa sessione: ${req.alwaysRules.join(', ')}` : undefined}>
          <Kbd>{i === 2 && onEscape ? '3' : o.hint}</Kbd><span className="chip-l">{i === 1 ? 'Sempre' : o.label}</span>
        </button>
      )));
    }
    if (!q) return null;
    if (other !== null) return otherBox(true);
    return (
      <>
        {q.options.map((o, i) => {
          const picked = draft.picks.includes(i);
          return (
            <button key={i} type="button" className={`chip-opt ${i === recIdx ? 'rec' : ''} ${picked ? 'picked' : ''} ${i === draft.cursor ? 'cur' : ''}`}
              onClick={() => apply(pickOption(req, draft, i))} disabled={sent} title={o.description ? cleanDescription(o.description) : undefined} data-testid={`${testBase}-opt-${i + 1}`}
              aria-pressed={q.multiSelect ? picked : undefined}>
              {q.multiSelect ? <span className={`chip-check ${picked ? 'on' : ''}`} aria-hidden="true">{picked && <IconCheck size={10} />}</span> : <Kbd>{i + 1}</Kbd>}
              <span className="chip-l">{cleanLabel(o.label)}</span>
              {i === recIdx && <><span className="chip-rec" aria-hidden="true">★</span><span className="sr-only">consigliata</span></>}
            </button>
          );
        })}
        {canOther && (
          <button type="button" className="chip-opt chip-other" onClick={() => setOther('')} disabled={sent} data-testid={`${testBase}-other`} title="Scrivi la tua risposta">
            {otherKey && <Kbd>{otherKey}</Kbd>}<span className="chip-l">Altro…</span>
          </button>
        )}
        {q.multiSelect && (
          <button type="button" className="chip-opt chip-confirm" onClick={() => apply(confirmPicks(req, draft))} disabled={sent || draft.picks.length === 0} data-testid={`${testBase}-confirm`}>
            <Kbd>Invio</Kbd><span className="chip-l">Conferma{draft.picks.length ? ` (${draft.picks.length})` : ''}</span>
          </button>
        )}
      </>
    );
  };

  if (variant === 'lane' || variant === 'compact') {
    return (
      <div {...common} className={`need-card ${isPerm ? 'perm' : 'question'} ${sent ? 'sent' : ''}`} data-lane={variant === 'lane' ? '' : undefined}>
        <div className="need-head">
          {variant === 'lane' ? (
            <><HarnessMark harness={harness} size={16} /><b className="need-title">{chatTitle}</b></>
          ) : (
            <span className="need-kind-head">{isPerm ? <IconShield size={13} /> : <IconQuestion size={13} />}{isPerm ? `Permesso · ${req.tool}` : (q?.header ?? 'Domanda')}</span>
          )}
          {stepBadge}
          <span className="need-age">{age}</span>
        </div>
        <div className="need-q" title={isPerm ? rawFull || title : title} data-testid={isPerm ? `${testBase}-explain` : undefined}>
          {isPerm && variant === 'lane' ? <span className="need-kind">Permesso</span> : null}
          {title}
        </div>
        {isPerm && rawFull && <code className="need-raw" title={rawFull} data-testid={`${testBase}-raw`}>{rawFull.split('\n')[0]}</code>}
        {variant === 'compact' && <AskContext req={req} defaultOpen={false} testBase={testBase} onToggle={refocus} />}
        <div className="need-opts">{chips()}</div>
        {laterBtn && <div className="ask-later-row">{laterBtn}</div>}
      </div>
    );
  }

  if (variant === 'regia') {
    return (
      <div {...common} className={`decision ${sent ? 'sent' : ''}`}>
        <div className="decision-k">Decisione{q?.header ? ` · ${q.header}` : ''}{stepBadge}</div>
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
  return (
    <div {...common} className={`ask ${isPerm ? 'perm' : 'question'} ${sent ? 'sent' : ''}`}>
      <div className="ask-head">
        <span className="ask-icon">{isPerm ? <IconShield size={14} /> : <IconQuestion size={14} />}</span>
        <span className="ask-kind">{isPerm ? 'Permesso' : 'Domanda'}</span>
        {isPerm ? <span className="ask-chip">{toolLabel(req.tool)}</span> : q?.header ? <span className="ask-chip" data-testid={`${testBase}-header`}>{q.header}</span> : null}
        {q?.multiSelect && <span className="ask-chip soft">più scelte</span>}
        {stepBadge}
        <span className="sp" />
        <span className="ask-age">{age}</span>
        {laterBtn}
      </div>
      <div className="ask-q" data-testid={isPerm ? `${testBase}-explain` : undefined}>{title}</div>
      {/* not in the global layer (onAnswer): its page can neither read the chat nor open links; "Apri" leads to the chat */}
      {!onAnswer && <AskContext req={req} defaultOpen={!!ctxOpen} testBase={testBase} onToggle={refocus} />}
      {isPerm ? (
        <>
          {rawFull && <RawCommand raw={rawFull} testBase={testBase} onToggle={() => requestAnimationFrame(() => ref.current?.focus())} />}
          <div className="ask-actions">
            <button type="button" className="btn btn-primary btn-m" onClick={() => finish(permissionAnswer(0))} disabled={sent} data-testid={`${testBase}-opt-1`}>Consenti <Kbd>Invio</Kbd></button>
            {!req.noAlways && (
              <button type="button" className="btn btn-ghost btn-m" onClick={() => finish(permissionAnswer(1))} disabled={sent} data-testid={`${testBase}-opt-2`}
                data-tip={req.alwaysRules?.length ? `Per questa sessione: ${req.alwaysRules.join(', ')}` : 'Per questa sessione'}>Consenti sempre <Kbd>2</Kbd></button>
            )}
            <span className="sp" />
            <button type="button" className="btn btn-danger btn-m" onClick={() => finish(permissionAnswer(2))} disabled={sent} data-testid={`${testBase}-opt-3`}>Rifiuta <Kbd>{onEscape ? '3' : 'Esc'}</Kbd></button>
          </div>
        </>
      ) : q ? (
        <>
          <div className="ask-opts" role={q.multiSelect ? 'group' : undefined}>
            {q.options.map((o, i) => {
              const picked = draft.picks.includes(i);
              return (
                <button key={i} type="button" className={`ask-opt ${i === recIdx ? 'rec' : ''} ${picked ? 'picked' : ''} ${i === draft.cursor ? 'cur' : ''}`}
                  onClick={() => apply(pickOption(req, draft, i))} disabled={sent} role={q.multiSelect ? 'checkbox' : undefined} aria-checked={q.multiSelect ? picked : undefined} data-testid={`${testBase}-opt-${i + 1}`}>
                  {q.multiSelect
                    ? <span className={`ask-check ${picked ? 'on' : ''}`} aria-hidden="true">{picked && <IconCheck size={11} />}</span>
                    : <Kbd>{i + 1}</Kbd>}
                  <span className="ask-opt-text">
                    <span className="ask-opt-label">{cleanLabel(o.label)}{i === recIdx && <span className="rec-tag">Consigliata</span>}</span>
                    {o.description && cleanDescription(o.description) && <span className="ask-opt-desc">{cleanDescription(o.description)}</span>}
                  </span>
                  {q.multiSelect && <span className="ask-opt-num"><Kbd>{i + 1}</Kbd></span>}
                </button>
              );
            })}
            {canOther && (other === null ? (
              <button type="button" className="ask-opt ask-opt-other" onClick={() => setOther('')} disabled={sent} data-testid={`${testBase}-other`}>
                {otherKey ? <Kbd>{otherKey}</Kbd> : <span className="ask-check" aria-hidden="true" />}
                <span className="ask-opt-text">
                  <span className="ask-opt-label">Altro…</span>
                  <span className="ask-opt-desc">scrivi la tua risposta</span>
                </span>
              </button>
            ) : otherBox(false))}
          </div>
          {q.multiSelect ? (
            <div className="ask-foot">
              <span className="ask-hint" data-testid={`${testBase}-count`}>{draft.picks.length === 0 ? 'Nessuna scelta' : draft.picks.length === 1 ? '1 scelta' : `${draft.picks.length} scelte`} · <Kbd>1</Kbd>–<Kbd>{n}</Kbd> per scegliere</span>
              <span className="sp" />
              <button type="button" className="btn btn-primary btn-m" onClick={() => apply(confirmPicks(req, draft))} disabled={sent || draft.picks.length === 0} data-testid={`${testBase}-confirm`}>Conferma <Kbd>Invio</Kbd></button>
            </div>
          ) : other === null && (
            <div className="ask-foot">
              <span className="ask-hint"><Kbd>1</Kbd>–<Kbd>{n}</Kbd> scegli · <Kbd>↑</Kbd><Kbd>↓</Kbd> muovi · <Kbd>Invio</Kbd> conferma</span>
            </div>
          )}
        </>
      ) : null}
      {/* after the choices: Tab from the card reaches an option first, never a command's Esegui */}
      {commands}
    </div>
  );
}
