// Keeps the keyboard in the field the user is typing in when the UI redraws it (the user, 2026-10-12: "perdo il focus
// del campo di testo su cui sto scrivendo"). First seen in the retired Corsie view: a chat that started waiting moved
// column, React mounted its tile again and the focused input was gone, so the keys fell on the page. Rule: when
// the focused field (an input or textarea with a data-testid) leaves the page and the keyboard is left on nothing, the
// field with the same testid that shows up within RESTORE_MS takes it back, caret and selection where they were. A
// click elsewhere, a dialog or another field moving the focus on purpose is never undone. The drafts themselves survive
// remounts in ChatInput.tsx. Started by main.tsx.

export const RESTORE_MS = 2000;

interface Kept { el: HTMLElement; id: string; start: number; end: number; lostAt: number }

const isField = (el: unknown): el is HTMLInputElement | HTMLTextAreaElement =>
  !!el && typeof el === 'object' && ((el as Element).tagName === 'TEXTAREA' || ((el as Element).tagName === 'INPUT' && /^(text|search|)$/.test((el as HTMLInputElement).type ?? '')));

export function startFocusKeeper(doc: Document = document, now: () => number = Date.now): () => void {
  let kept: Kept | null = null;
  const remember = (el: EventTarget | null) => {
    if (!isField(el) || !el.dataset.testid) return;
    kept = { el, id: el.dataset.testid, start: el.selectionStart ?? el.value.length, end: el.selectionEnd ?? el.value.length, lostAt: 0 };
  };
  const onFocusIn = (e: FocusEvent) => {
    if (isField(e.target) && (e.target as HTMLElement).dataset.testid) remember(e.target);
    else kept = null; // the keyboard went somewhere else on purpose (a button, a panel, another field without testid)
  };
  // the caret moves while typing: keep its last place
  const onCaret = (e: Event) => { if (kept && e.target === kept.el) remember(e.target); };
  // a click outside the field (even on something that takes no focus: a transcript, the background) is on purpose
  const onPointer = (e: Event) => { if (kept && !(kept.el.isConnected && kept.el.contains(e.target as Node))) kept = null; };
  const check = () => {
    if (!kept || kept.el.isConnected) return;
    const active = doc.activeElement;
    if (active && active !== doc.body) { kept = null; return; }
    if (!kept.lostAt) kept.lostAt = now();
    if (now() - kept.lostAt > RESTORE_MS) { kept = null; return; }
    const next = doc.querySelector<HTMLElement>(`[data-testid="${CSS.escape(kept.id)}"]`);
    if (!isField(next)) return; // not drawn yet: the next mutation tries again
    const { start, end } = kept;
    next.focus({ preventScroll: true });
    const len = next.value.length;
    try { next.setSelectionRange(Math.min(start, len), Math.min(end, len)); } catch { /* a field without selection */ }
    remember(next);
  };
  doc.addEventListener('focusin', onFocusIn, true);
  doc.addEventListener('pointerdown', onPointer, true);
  for (const t of ['input', 'keyup', 'mouseup', 'select'] as const) doc.addEventListener(t, onCaret, true);
  const mo = new MutationObserver(check);
  mo.observe(doc.body, { childList: true, subtree: true });
  return () => {
    mo.disconnect();
    doc.removeEventListener('focusin', onFocusIn, true);
    doc.removeEventListener('pointerdown', onPointer, true);
    for (const t of ['input', 'keyup', 'mouseup', 'select'] as const) doc.removeEventListener(t, onCaret, true);
  };
}
