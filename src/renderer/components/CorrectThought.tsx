// "Correggi il pensiero" (ADR 0058): the text of an open Ragionamento block, where the user corrects the chat's reasoning.
// Select a sentence → a small "No, così" button above it (or Ctrl+Shift+X) → a one-line form under the text: Invio =
// Correggi (the turn stops and starts again from the correction), Maiusc+Invio = Al prossimo passo (Claude only: the
// turn goes on and reads it after its next tool step). From the first mouse press until the form closes the text is
// frozen (a streaming block would move the selection under the mouse). Sentences already corrected stay marked. An
// open question or permission blocks it, with the reason in the form. Used by ChatItems.tsx (Thinking).
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { canCorrectAtNextStep, cleanQuote, correctionBlocked, markPieces } from '../lib/correction';
import { correctThought, useApp } from '../store/store';
import { toast } from '../store/ui';
import { t } from '../i18n';

/** The selection inside `box`, as text (empty: none, or outside). */
function selectedIn(box: HTMLElement | null): string {
  const sel = window.getSelection();
  if (!box || !sel || sel.isCollapsed || !sel.rangeCount) return '';
  const r = sel.getRangeAt(0);
  return box.contains(r.commonAncestorContainer) ? sel.toString() : '';
}

export function ThoughtText({ chatId, text, marks }: { chatId: string | null; text: string; marks?: readonly string[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [frozen, setFrozen] = useState<string | null>(null);
  const [pick, setPick] = useState<{ quote: string; x: number; y: number } | null>(null);
  const [form, setForm] = useState<string | null>(null);
  const shown = frozen ?? text;
  const latest = useRef(text); // the keydown listener below reads the text through this, not a closure
  latest.current = text;

  const chat = useApp(s => (chatId ? s.chats[chatId] : undefined));
  const asking = useApp(s => !!chatId && s.pending.some(p => p.chatId === chatId));
  const blocked = correctionBlocked(chat, asking);
  const step = canCorrectAtNextStep(chat);

  const open = (quote: string) => { setForm(cleanQuote(quote)); setPick(null); setFrozen(f => f ?? latest.current); };
  const close = () => { setForm(null); setPick(null); setFrozen(null); };

  // a selection gone (a click elsewhere) drops the button and the freeze; an open form keeps its quote
  useEffect(() => {
    if (!pick && frozen === null) return;
    const onSel = () => { if (!form && !selectedIn(box.current)) { setPick(null); setFrozen(null); } };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, [pick, frozen, form]);

  // Ctrl+Shift+X with a selection in this block (free in the keyboard map: lib/keys.ts); not while a form is open, like
  // the mouse (a second selection would swap the quote under a fix written for the first)
  useEffect(() => {
    if (!chatId || form !== null) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey || e.code !== 'KeyX') return;
      const q = selectedIn(box.current);
      if (!q.trim()) return;
      e.preventDefault();
      open(q);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [chatId, form]);

  const onUp = () => {
    if (!chatId || form) return;
    const q = selectedIn(box.current);
    const sel = window.getSelection();
    if (!q.trim() || !sel?.rangeCount || !box.current) { setPick(null); setFrozen(null); return; }
    const r = sel.getRangeAt(0).getBoundingClientRect(), b = (box.current.parentElement ?? box.current).getBoundingClientRect();
    setPick({ quote: q, x: Math.max(0, r.left - b.left + r.width / 2), y: r.top - b.top });
  };

  return (
    <div className="thinking-body">
      <div className="thinking-text" ref={box} onMouseDown={() => { if (chatId && !form) setFrozen(text); }} onMouseUp={onUp} data-testid="thinking-text">
        {markPieces(shown, marks ?? []).map((p, i) => (p.mark ? <mark key={i} className="thought-fixed" title={t('chat.correct.fixedTip')}>{p.text}</mark> : p.text))}
      </div>
      {pick && (
        <button type="button" className="thought-pick" style={{ left: pick.x, top: pick.y }} data-testid="thought-pick"
          onMouseDown={e => e.preventDefault()} onClick={() => open(pick.quote)} data-tip={t('chat.correct.pickTip')}>
          {t('chat.correct.pick')}
        </button>
      )}
      {form !== null && <FixForm quote={form} blocked={blocked} step={step} onDone={close}
        onSend={async (fix, mode) => {
          if (!chatId) return null;
          const r = await correctThought(chatId, form, fix, mode);
          if ('blocked' in r) return r.blocked;
          if (r.done === 'stopping') toast(t('chat.correct.stoppingToast'), 'info');
          else if (r.done === 'step') toast(t('chat.correct.stepToast'), 'info');
          window.getSelection()?.removeAllRanges();
          return null;
        }} />}
    </div>
  );
}

/** The one-line form under the reasoning: the quote, the fix, the two ways to send it. */
function FixForm({ quote, blocked, step, onSend, onDone }: { quote: string; blocked: string | null; step: boolean; onSend: (fix: string, mode: 'stop' | 'step') => Promise<string | null>; onDone: () => void }) {
  const [fix, setFix] = useState('');
  const [why, setWhy] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const go = async (mode: 'stop' | 'step') => {
    if (busy || !fix.trim() || blocked) return;
    setBusy(true);
    const err = await onSend(fix, mode);
    setBusy(false);
    if (err) setWhy(err); else onDone();
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onDone(); return; }
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void go(e.shiftKey && step ? 'step' : 'stop'); }
  };
  const reason = blocked ?? why;
  return (
    <div className="thought-fix" data-testid="thought-fix">
      <div className="thought-fix-quote" title={quote}>«{quote}»</div>
      <input ref={input} className="thought-fix-input" value={fix} onChange={e => { setFix(e.target.value); setWhy(null); }} onKeyDown={onKey}
        placeholder={t('chat.correct.placeholder')} aria-label={t('chat.correct.label')} data-testid="thought-fix-input" maxLength={600} />
      {reason && <div className="thought-fix-why" role="alert" data-testid="thought-fix-why">{reason}</div>}
      <div className="thought-fix-actions">
        <button type="button" className="btn btn-primary btn-s" disabled={busy || !fix.trim() || !!blocked} onClick={() => void go('stop')} data-testid="thought-fix-stop"
          data-tip={t('chat.correct.stopTip')}>{t('chat.correct.stop')}</button>
        {step && <button type="button" className="btn btn-ghost btn-s" disabled={busy || !fix.trim() || !!blocked} onClick={() => void go('step')} data-testid="thought-fix-step"
          data-tip={t('chat.correct.stepTip')}>{t('chat.correct.step')}</button>}
        <button type="button" className="btn btn-ghost btn-s" onClick={onDone} data-testid="thought-fix-cancel">{t('common.cancel')}</button>
      </div>
    </div>
  );
}
