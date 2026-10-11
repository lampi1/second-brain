// A question (AskUserQuestion) or a permission as a panel with numbered choices, in three sizes: a needs-lane card,
// the inline panel of a chat tile, and the Regia's violet "decisione". The focused panel answers with 1-9 / Enter /
// Esc / arrows (lib/keys.ts); clicks do the same; questions also take a free-text "Altro…" answer. Answering from the
// lane never opens the chat: focus moves to the next card. Used by NeedsLane, ChatTile, RegiaTile.
import { useRef, useState, type KeyboardEvent } from 'react';
import type { Answer, PendingRequest } from '@shared/contract';
import { answerText, confirmPicks, initialDraft, PERMISSION_OPTIONS, permissionAnswer, pickOption, recommendedIndex, requestKey, type Draft, type KeyResult } from '../lib/keys';
import { ago } from '../lib/format';
import { useNow } from '../lib/clock';
import { answer } from '../store/store';
import { reqKey } from '../actions';
import { HarnessMark, IconQuestion, IconShield } from './Icons';
import { Kbd } from './ui';
import type { Harness } from '@shared/contract';

type Variant = 'lane' | 'tile' | 'regia' | 'compact';

const REC = /\s*\((consigliat[oa]|recommended)\)\s*/i;
const cleanLabel = (l: string) => l.replace(REC, ' ').trim();
const isRec = (l: string, d?: string) => REC.test(l) || /^consigliat/i.test(d ?? '');

/** onAnswer: answer through someone else (the global layer relays to the app page); onEscape: what Esc does instead of
 *  rejecting a permission / leaving a question (the layer: postpone to "Ti aspettano"). */
export function RequestPanel({ req, variant, chatTitle, harness = 'claude', onAnswered, onAnswer, onEscape, testid }: {
  req: PendingRequest; variant: Variant; chatTitle?: string; harness?: Harness; onAnswered?: () => void; onAnswer?: (a: Answer) => void; onEscape?: () => void; testid?: string;
}) {
  const [draft, setDraft] = useState<Draft>(() => initialDraft(req));
  const [sent, setSent] = useState(false);
  const [other, setOther] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const now = useNow(15_000);
  const key = reqKey(req);
  const q = req.questions?.[draft.step];
  const testBase = testid ?? (variant === 'lane' ? `lane-card-${req.chatId}-${req.id}` : `request-${req.chatId}-${req.id}`);

  const finish = (a: Answer, viaKey = false) => {
    setSent(true);
    if (onAnswer) { onAnswer(a); return; }
    // keyboard flow only (never after a click): the next card of the lane (or the next panel) takes the focus
    const here = ref.current;
    if (viaKey && here && here.contains(document.activeElement)) {
      const all = [...document.querySelectorAll<HTMLElement>(variant === 'lane' ? '[data-lane][data-request-key]' : '[data-request-key]')];
      const next = all[all.indexOf(here) + 1] ?? all.find(x => x !== here);
      requestAnimationFrame(() => { if (next && next.isConnected) next.focus(); else document.querySelector<HTMLElement>('[data-testid="regia-input"]')?.focus(); });
    }
    void answer(req, a).then(ok => { if (ok) onAnswered?.(); else setSent(false); });
  };
  const apply = (r: KeyResult, viaKey = false) => {
    setDraft(r.draft);
    if (r.answer) finish(r.answer, viaKey);
    if (r.blur) ref.current?.blur();
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (sent) return;
    if ((e.target as HTMLElement).tagName === 'INPUT') return; // typing the "Altro…" answer
    if (e.key === 'Escape' && onEscape && !e.ctrlKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); onEscape(); return; }
    const r = requestKey(req, draft, e);
    if (!r.handled) return;
    e.preventDefault();
    e.stopPropagation();
    apply(r, true);
  };

  const age = ago(req.at, now);
  const isPerm = req.type === 'permission';
  const title = isPerm ? req.title : (q?.question ?? req.title);
  const stepBadge = req.questions && req.questions.length > 1 ? <span className="step">{draft.step + 1}/{req.questions.length}</span> : null;
  const recIdx = q ? recommendedIndex(q.options.map(o => `${o.label} ${isRec(o.label, o.description) ? 'consigliato' : ''}`)) : 0;
  const common = {
    ref, tabIndex: 0, onKeyDown: onKey, 'data-request-key': key, 'data-testid': testBase, 'aria-busy': sent,
    role: 'group' as const, 'aria-label': `${isPerm ? 'Permesso' : 'Domanda'} da ${chatTitle ?? 'una chat'}: ${title}`,
  };

  // ---------- chips (lane, regia, compact)
  const chips = () => {
    if (isPerm) {
      return PERMISSION_OPTIONS.map((o, i) => (i === 1 && req.noAlways ? null : (
        <button key={o.label} type="button" className={`chip-opt ${i === 0 ? 'rec' : ''} ${i === 2 ? 'deny' : ''}`} onClick={() => finish(permissionAnswer(i))} disabled={sent} data-testid={`${testBase}-opt-${i + 1}`}
          title={i === 1 && req.alwaysRules?.length ? `Per questa sessione: ${req.alwaysRules.join(', ')}` : undefined}>
          <Kbd>{o.hint}</Kbd><span className="chip-l">{i === 1 ? 'Sempre' : o.label}</span>
        </button>
      )));
    }
    if (!q) return null;
    return (
      <>
        {q.options.map((o, i) => (
          <button key={i} type="button" className={`chip-opt ${i === recIdx ? 'rec' : ''} ${draft.picks.includes(i) ? 'picked' : ''} ${i === draft.cursor ? 'cur' : ''}`}
            onClick={() => apply(pickOption(req, draft, i))} disabled={sent} title={o.description} data-testid={`${testBase}-opt-${i + 1}`}>
            <Kbd>{i + 1}</Kbd><span className="chip-l">{cleanLabel(o.label)}</span>
          </button>
        ))}
        {q.multiSelect && <button type="button" className="chip-opt rec" onClick={() => apply(confirmPicks(req, draft))} disabled={sent} data-testid={`${testBase}-confirm`}><Kbd>Invio</Kbd><span className="chip-l">Conferma</span></button>}
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
        <div className="need-q" title={title}>
          {isPerm && variant === 'lane' ? <span className="need-kind">Permesso</span> : null}
          {isPerm ? <code>{req.detail || req.title}</code> : title}
        </div>
        <div className="need-opts">{chips()}</div>
      </div>
    );
  }

  if (variant === 'regia') {
    return (
      <div {...common} className={`decision ${sent ? 'sent' : ''}`}>
        <div className="decision-k">Decisione{q?.header ? ` · ${q.header}` : ''}{stepBadge}</div>
        <div className="decision-q">{isPerm ? req.title : title}</div>
        <div className="need-opts">{chips()}</div>
      </div>
    );
  }

  // ---------- full inline panel of a tile
  return (
    <div {...common} className={`ask ${isPerm ? 'perm' : 'question'} ${sent ? 'sent' : ''}`}>
      <div className="ask-head">
        {isPerm ? <IconShield size={15} /> : <IconQuestion size={15} />}
        <span className="ask-kind">{isPerm ? `Permesso · ${req.tool}` : (q?.header ?? 'Domanda')}</span>
        {stepBadge}
        <span className="sp" />
        <span className="ask-age">{age}</span>
      </div>
      <div className="ask-q">{title}</div>
      {isPerm ? (
        <>
          {req.detail && <pre className="ask-cmd" data-testid={`${testBase}-detail`}>{req.detail}</pre>}
          <div className="ask-actions">
            <button type="button" className="btn btn-primary btn-m" onClick={() => finish(permissionAnswer(0))} disabled={sent} data-testid={`${testBase}-opt-1`}>Consenti <Kbd>Invio</Kbd></button>
            {!req.noAlways && (
              <button type="button" className="btn btn-ghost btn-m" onClick={() => finish(permissionAnswer(1))} disabled={sent} data-testid={`${testBase}-opt-2`}
                data-tip={req.alwaysRules?.length ? `Per questa sessione: ${req.alwaysRules.join(', ')}` : 'Per questa sessione'}>Consenti sempre <Kbd>2</Kbd></button>
            )}
            <button type="button" className="btn btn-danger btn-m" onClick={() => finish(permissionAnswer(2))} disabled={sent} data-testid={`${testBase}-opt-3`}>Rifiuta <Kbd>Esc</Kbd></button>
          </div>
        </>
      ) : q ? (
        <div className="ask-opts">
          {q.options.map((o, i) => (
            <button key={i} type="button" className={`ask-opt ${i === recIdx ? 'rec' : ''} ${draft.picks.includes(i) ? 'picked' : ''} ${i === draft.cursor ? 'cur' : ''}`}
              onClick={() => apply(pickOption(req, draft, i))} disabled={sent} aria-pressed={q.multiSelect ? draft.picks.includes(i) : undefined} data-testid={`${testBase}-opt-${i + 1}`}>
              <Kbd>{i + 1}</Kbd>
              <span className="ask-opt-text">
                <span className="ask-opt-label">{cleanLabel(o.label)}{isRec(o.label, o.description) && <span className="rec-tag">consigliato</span>}</span>
                {o.description && <span className="ask-opt-desc">{o.description.replace(/^consigliat[oa]:?\s*/i, '')}</span>}
              </span>
            </button>
          ))}
          {q.multiSelect && <button type="button" className="btn btn-primary btn-m" onClick={() => apply(confirmPicks(req, draft))} disabled={sent} data-testid={`${testBase}-confirm`}>Conferma <Kbd>Invio</Kbd></button>}
          {harness === 'cursor' ? null : other === null ? (
            <button type="button" className="ask-other" onClick={() => setOther('')} disabled={sent} data-testid={`${testBase}-other`}>Altro… scrivi la tua risposta</button>
          ) : (
            <input className="ask-other-input" autoFocus value={other} placeholder="La tua risposta, poi Invio" aria-label="Risposta libera" data-testid={`${testBase}-other-input`}
              onChange={e => setOther(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); apply(answerText(req, draft, other)); }
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOther(null); ref.current?.focus(); }
              }} />
          )}
        </div>
      ) : null}
    </div>
  );
}
