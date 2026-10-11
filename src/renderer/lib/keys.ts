// Keyboard handling as pure functions (ADR 0005 keyboard map). `resolveShortcut` turns a keydown into an app command
// (App.tsx dispatches it); `requestKey` turns 1-9 / Enter / Esc / arrows on a focused question or permission card into
// an answer (NeedsLane.tsx and the inline RequestPanel use it). Both are pinned by test/unit/keys.test.ts.
import type { Answer, PendingRequest } from '@shared/contract';

export interface KeyLike { key: string; code: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }

export type Command =
  | { type: 'palette' }
  | { type: 'next' }
  | { type: 'stopFocused' }
  | { type: 'stopAll' }
  | { type: 'toggleView' }
  | { type: 'maximize' }
  | { type: 'escape' }
  | { type: 'newChat' }
  | { type: 'focusTile'; index: number }
  | { type: 'focusMode' }
  | { type: 'shortcuts' }
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'center' }
  | { type: 'regia' }
  | { type: 'map' };

/** The keyboard map shown in the shortcuts dialog (Ctrl+/), in the same order as resolveShortcut. */
export const KEYMAP: readonly { keys: string; what: string }[] = [
  { keys: 'Ctrl K', what: 'Vai ovunque, cerca, comandi (incolla un link sb://)' },
  { keys: 'Ctrl J', what: 'Prossima cosa che ti aspetta' },
  { keys: '1-9 · Invio · Esc', what: 'Rispondi alla richiesta selezionata (Esc nel riquadro: dopo)' },
  { keys: 'Ctrl 1', what: 'Torna alle chat' },
  { keys: 'Alt ← · Alt →', what: 'Indietro / avanti' },
  { keys: 'G poi lettera', what: 'Vai a una sezione (fuori dai campi di testo)' },
  { keys: 'Ctrl R', what: 'Regia (da qualsiasi pagina)' },
  { keys: 'Ctrl Shift N', what: 'Notifiche' },
  { keys: 'Ctrl Shift M', what: 'Mappa 3D' },
  { keys: 'Ctrl N', what: 'Nuova chat' },
  { keys: 'Ctrl .', what: 'Ferma la chat selezionata' },
  { keys: 'Ctrl Shift .', what: 'Ferma tutto' },
  { keys: 'Ctrl Shift V', what: 'Cambia vista (Mosaico / Corsie)' },
  { keys: 'F11', what: 'Ingrandisci la tessera selezionata' },
  { keys: 'Ctrl Shift F', what: 'Modalità focus' },
  { keys: 'Ctrl 0', what: 'Vai alla Regia' },
  { keys: 'Esc', what: 'Chiudi / torna indietro di un livello' },
  { keys: 'Ctrl /', what: 'Questa guida' },
];

/** Global shortcuts. They work inside text fields too (they all use Ctrl, Alt+arrows, F11 or Esc). */
export function resolveShortcut(e: KeyLike): Command | null {
  const ctrl = e.ctrlKey || e.metaKey;
  if (e.altKey) {
    if (!ctrl && !e.shiftKey && e.key === 'ArrowLeft') return { type: 'back' };
    if (!ctrl && !e.shiftKey && e.key === 'ArrowRight') return { type: 'forward' };
    return null;
  }
  if (ctrl && e.shiftKey) {
    if (e.code === 'Period') return { type: 'stopAll' };
    if (e.code === 'KeyV') return { type: 'toggleView' };
    if (e.code === 'KeyF') return { type: 'focusMode' };
    if (e.code === 'KeyN') return { type: 'center' };
    if (e.code === 'KeyM') return { type: 'map' };
    return null;
  }
  if (ctrl) {
    if (e.code === 'KeyK') return { type: 'palette' };
    if (e.code === 'KeyJ') return { type: 'next' };
    if (e.code === 'KeyN') return { type: 'newChat' };
    if (e.code === 'KeyR') return { type: 'regia' };
    if (e.code === 'Period') return { type: 'stopFocused' };
    if (e.code === 'Slash' || e.key === '/') return { type: 'shortcuts' };
    const digit = /^Digit([0-9])$/.exec(e.code) ?? /^Numpad([0-9])$/.exec(e.code);
    if (digit) return { type: 'focusTile', index: Number(digit[1]) };
    return null;
  }
  if (e.key === 'F11') return { type: 'maximize' };
  if (e.key === 'Escape' && !e.shiftKey) return { type: 'escape' };
  return null;
}

/** "G then a letter" go-to shortcuts (outside text fields): `keys` like "G H". Returns the new pending state and,
 *  when the sequence completes, the target id. A G alone waits up to `windowMs` for its letter. */
export function goSequence(pendingAt: number | null, e: KeyLike, now: number, targets: readonly { id: string; key: string }[], windowMs = 1200): { pendingAt: number | null; target?: string; handled: boolean } {
  if (e.ctrlKey || e.metaKey || e.altKey) return { pendingAt: null, handled: false };
  const letter = e.key.length === 1 ? e.key.toUpperCase() : '';
  if (pendingAt !== null && now - pendingAt <= windowMs && letter) {
    const t = targets.find(x => x.key.toUpperCase() === `G ${letter}`);
    if (t) return { pendingAt: null, target: t.id, handled: true };
    return letter === 'G' ? { pendingAt: now, handled: true } : { pendingAt: null, handled: false };
  }
  if (letter === 'G' && !e.shiftKey) return { pendingAt: now, handled: true };
  return { pendingAt: null, handled: false };
}

/** Where an answer draft is: which question (multi-question requests), the picks of a multi-select, the highlight. */
export interface Draft { step: number; picks: number[]; cursor: number; answers: Record<string, string | string[]> }
export const emptyDraft: Draft = { step: 0, picks: [], cursor: 0, answers: {} };

export interface KeyResult { handled: boolean; draft: Draft; answer?: Answer; blur?: boolean }

/** Options of a permission card, in key order (1, 2, 3). */
export const PERMISSION_OPTIONS = [
  { label: 'Consenti', hint: 'Invio' },
  { label: 'Consenti sempre', hint: '2' },
  { label: 'Rifiuta', hint: 'Esc' },
] as const;

export function permissionAnswer(i: number): Answer {
  if (i === 0) return { kind: 'permission', allow: true };
  if (i === 1) return { kind: 'permission', allow: true, always: true };
  return { kind: 'permission', allow: false };
}

/** Which option is "recommended" (highlighted, Enter picks it first): the one that says so, else the first. */
export function recommendedIndex(labels: readonly string[]): number {
  const i = labels.findIndex(l => /consigliat|recommended/i.test(l));
  return i >= 0 ? i : 0;
}

/** Pick option `index` of the current question (click or digit); returns the next draft and, when complete, the answer. */
export function pickOption(req: PendingRequest, draft: Draft, index: number): KeyResult {
  if (req.type === 'permission') return { handled: true, draft, answer: permissionAnswer(index) };
  const qs = req.questions ?? [];
  const q = qs[draft.step];
  if (!q) return { handled: false, draft };
  const opt = q.options[index];
  if (!opt) return { handled: false, draft };
  if (q.multiSelect) {
    const picks = draft.picks.includes(index) ? draft.picks.filter(p => p !== index) : [...draft.picks, index].sort((a, b) => a - b);
    return { handled: true, draft: { ...draft, picks, cursor: index } };
  }
  return commit(qs.length, { ...draft, answers: { ...draft.answers, [q.question]: opt.label } });
}

/** Free-text answer to the current question ("Altro…"). */
export function answerText(req: PendingRequest, draft: Draft, text: string): KeyResult {
  const t = text.trim();
  if (!t) return { handled: false, draft };
  if (req.type === 'permission') return { handled: true, draft, answer: { kind: 'permission', allow: false, message: t } };
  const qs = req.questions ?? [];
  const q = qs[draft.step];
  if (!q) return { handled: false, draft };
  return commit(qs.length, { ...draft, answers: { ...draft.answers, [q.question]: q.multiSelect ? [t] : t } });
}

/** Confirm the picks of a multi-select question. */
export function confirmPicks(req: PendingRequest, draft: Draft): KeyResult {
  const qs = req.questions ?? [];
  const q = qs[draft.step];
  if (!q || !q.multiSelect) return { handled: false, draft };
  const picks = draft.picks.length ? draft.picks : [draft.cursor];
  const labels = picks.map(i => q.options[i]?.label).filter((l): l is string => !!l);
  return commit(qs.length, { ...draft, answers: { ...draft.answers, [q.question]: labels } });
}

function commit(total: number, draft: Draft): KeyResult {
  if (draft.step + 1 >= total) return { handled: true, draft: { ...draft, picks: [] }, answer: { kind: 'question', answers: draft.answers } };
  return { handled: true, draft: { ...draft, step: draft.step + 1, picks: [], cursor: 0 } };
}

/** A key on a focused request card. Digits pick, arrows move the highlight, Enter confirms, Esc rejects a permission
 *  (or just leaves a question). Keys with Ctrl/Alt are never handled here (they are global shortcuts). */
export function requestKey(req: PendingRequest, draft: Draft, e: Pick<KeyLike, 'key' | 'ctrlKey' | 'altKey' | 'metaKey'>): KeyResult {
  if (e.ctrlKey || e.altKey || e.metaKey) return { handled: false, draft };
  const k = e.key;
  if (req.type === 'permission') {
    if (k === '1' || k === 'Enter') return { handled: true, draft, answer: permissionAnswer(0) };
    if (k === '2') return req.noAlways ? { handled: true, draft } : { handled: true, draft, answer: permissionAnswer(1) };
    if (k === '3' || k === 'Escape') return { handled: true, draft, answer: permissionAnswer(2) };
    return { handled: false, draft };
  }
  const q = req.questions?.[draft.step];
  if (!q) return k === 'Escape' ? { handled: true, draft, blur: true } : { handled: false, draft };
  const n = q.options.length;
  if (/^[1-9]$/.test(k)) {
    const i = Number(k) - 1;
    return i < n ? pickOption(req, draft, i) : { handled: true, draft };
  }
  if (k === 'ArrowDown' || k === 'ArrowRight') return { handled: true, draft: { ...draft, cursor: (draft.cursor + 1) % n } };
  if (k === 'ArrowUp' || k === 'ArrowLeft') return { handled: true, draft: { ...draft, cursor: (draft.cursor - 1 + n) % n } };
  if (k === 'Enter') return q.multiSelect ? confirmPicks(req, draft) : pickOption(req, draft, draft.cursor);
  if (k === 'Escape') return { handled: true, draft, blur: true };
  return { handled: false, draft };
}

/** The highlight a fresh draft starts on: the recommended option of the first question. */
export function initialDraft(req: PendingRequest): Draft {
  const q = req.questions?.[0];
  return { ...emptyDraft, cursor: q ? recommendedIndex(q.options.map(o => `${o.label} ${o.description ?? ''}`)) : 0 };
}
