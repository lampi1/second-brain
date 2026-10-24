// Keyboard handling as pure functions (ADR 0005 keyboard map). `resolveShortcut` turns a keydown into an app command
// (App.tsx dispatches it); `requestKey` turns 1-9 / Enter / Esc / arrows on a focused question or permission card into
// an answer, and the digit after the last option into "Altro…" (RequestPanel uses it in every size). Both are pinned by
// test/unit/keys.test.ts.
import type { Answer, PendingRequest } from '@shared/contract';
import { t } from '../i18n';

export interface KeyLike { key: string; code: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }

export type Command =
  | { type: 'palette' }
  | { type: 'next' }
  | { type: 'stopFocused' }
  | { type: 'closeFocused' }
  | { type: 'stopAll' }
  | { type: 'maximize' }
  | { type: 'escape' }
  | { type: 'newChat' }
  | { type: 'focusTile'; index: number }
  | { type: 'focusMode' }
  | { type: 'shortcuts' }
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'center' }
  | { type: 'orchestrator' }
  | { type: 'orchestratorRenew' }
  | { type: 'map' }
  | { type: 'stato' }
  | { type: 'settings' }
  | { type: 'voice' };

/** The keyboard map shown in the shortcuts dialog (Ctrl+/), in the same order as resolveShortcut. */
export const getKeymap = (): readonly { keys: string; what: string }[] => [
  { keys: t('tools.keys.paletteKey'), what: t('tools.keys.paletteWhat') },
  { keys: t('tools.keys.nextKey'), what: t('tools.keys.nextWhat') },
  { keys: t('tools.keys.answerKey'), what: t('tools.keys.answerWhat') },
  { keys: t('tools.keys.backToChatsKey'), what: t('tools.keys.backToChatsWhat') },
  { keys: t('tools.keys.backForwardKey'), what: t('tools.keys.backForwardWhat') },
  { keys: t('tools.keys.goToKey'), what: t('tools.keys.goToWhat') },
  { keys: t('tools.keys.orchestratorKey'), what: t('tools.keys.orchestratorWhat') },
  { keys: t('tools.keys.newOrchestratorKey'), what: t('tools.keys.newOrchestratorWhat') },
  { keys: t('tools.keys.notificationsKey'), what: t('tools.keys.notificationsWhat') },
  { keys: t('tools.keys.statusKey'), what: t('tools.keys.statusWhat') },
  { keys: t('tools.keys.map3dKey'), what: t('tools.keys.map3dWhat') },
  { keys: t('tools.keys.newChatKey'), what: t('tools.keys.newChatWhat') },
  { keys: t('tools.keys.settingsKey'), what: t('tools.keys.settingsWhat') },
  { keys: t('tools.keys.voiceKey'), what: t('tools.keys.voiceWhat') },
  { keys: t('tools.keys.stopChatKey'), what: t('tools.keys.stopChatWhat') },
  { keys: t('tools.keys.closeChatKey'), what: t('tools.keys.closeChatWhat') },
  { keys: t('tools.keys.stopAllKey'), what: t('tools.keys.stopAllWhat') },
  { keys: t('tools.keys.correctThoughtKey'), what: t('tools.keys.correctThoughtWhat') },
  { keys: t('tools.keys.maximizeKey'), what: t('tools.keys.maximizeWhat') },
  { keys: t('tools.keys.focusModeKey'), what: t('tools.keys.focusModeWhat') },
  { keys: t('tools.keys.centerKey'), what: t('tools.keys.centerWhat') },
  { keys: t('tools.keys.escapeKey'), what: t('tools.keys.escapeWhat') },
  { keys: t('tools.keys.helpKey'), what: t('tools.keys.helpWhat') },
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
    if (e.code === 'KeyF') return { type: 'focusMode' };
    if (e.code === 'KeyN') return { type: 'center' };
    if (e.code === 'KeyM') return { type: 'map' };
    if (e.code === 'KeyR') return { type: 'orchestratorRenew' };
    if (e.code === 'KeyS') return { type: 'stato' };
    return null;
  }
  if (ctrl) {
    if (e.code === 'KeyK') return { type: 'palette' };
    if (e.code === 'KeyJ') return { type: 'next' };
    if (e.code === 'KeyN') return { type: 'newChat' };
    if (e.code === 'KeyR') return { type: 'orchestrator' };
    if (e.code === 'Period') return { type: 'stopFocused' };
    if (e.key.toLowerCase() === 'w') return { type: 'closeFocused' }; // the character, like Electron's menu (AZERTY)
    if (e.code === 'Slash' || e.key === '/') return { type: 'shortcuts' };
    if (e.code === 'Comma') return { type: 'settings' };
    if (e.code === 'KeyM') return { type: 'voice' }; // voice mode on / off (ADR 0152)
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

/** other: open the free-text "Altro…" answer (the digit right after the last option). */
export interface KeyResult { handled: boolean; draft: Draft; answer?: Answer; blur?: boolean; other?: boolean }

/** Options of a permission card, in key order (1, 2, 3). */
export const getPermissionOptions = () => [
  { label: t('tools.keys.allowLabel'), hint: t('tools.keys.allowHint') },
  { label: t('tools.keys.allowAlwaysLabel'), hint: t('tools.keys.allowAlwaysHint') },
  { label: t('tools.keys.denyLabel'), hint: t('tools.keys.denyHint') },
] as const;

export function permissionAnswer(i: number): Answer {
  if (i === 0) return { kind: 'permission', allow: true };
  if (i === 1) return { kind: 'permission', allow: true, always: true };
  return { kind: 'permission', allow: false };
}

const REC = /\s*\((consigliat[oa]|recommended)\)\s*/i;
/** The option the agent marked as recommended ("… (consigliato)" in the label, or a description that starts with it);
 *  -1 when none is marked (then no option is shown as recommended). */
export function markedRecommended(options: readonly { label: string; description?: string }[]): number {
  return options.findIndex(o => REC.test(o.label) || /^(consigliat|recommended)/i.test(o.description ?? ''));
}
/** An option label without its "(consigliato)" marker, and its description without a leading "consigliato:". */
export const cleanLabel = (l: string): string => l.replace(REC, ' ').trim();
export const cleanDescription = (d: string): string => d.replace(/^(consigliat[oa]|recommended)\b[:.,;–-]?\s*/i, '').trim();

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
  // multi-select: the ticked options stay, the text is added to them
  const ticked = q.multiSelect ? draft.picks.map(i => q.options[i]?.label).filter((l): l is string => !!l) : [];
  return commit(qs.length, { ...draft, answers: { ...draft.answers, [q.question]: q.multiSelect ? [...ticked, t] : t } });
}

/** Confirm the picks of a multi-select question; with nothing ticked it does nothing (never a choice the user did not make). */
export function confirmPicks(req: PendingRequest, draft: Draft): KeyResult {
  const qs = req.questions ?? [];
  const q = qs[draft.step];
  if (!q || !q.multiSelect) return { handled: false, draft };
  if (!draft.picks.length) return { handled: true, draft };
  const labels = draft.picks.map(i => q.options[i]?.label).filter((l): l is string => !!l);
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
    if (i === n) return { handled: true, draft, other: true };
    return i < n ? pickOption(req, draft, i) : { handled: true, draft };
  }
  if (k === 'ArrowDown' || k === 'ArrowRight') return { handled: true, draft: { ...draft, cursor: (draft.cursor + 1) % n } };
  if (k === 'ArrowUp' || k === 'ArrowLeft') return { handled: true, draft: { ...draft, cursor: (draft.cursor - 1 + n) % n } };
  if (k === 'Enter') return q.multiSelect ? confirmPicks(req, draft) : pickOption(req, draft, draft.cursor);
  if (k === ' ' && q.multiSelect) return pickOption(req, draft, draft.cursor);
  if (k === 'Escape') return { handled: true, draft, blur: true };
  return { handled: false, draft };
}

/** The highlight a fresh draft starts on: the option the agent marked as recommended, else the first. */
export function initialDraft(req: PendingRequest): Draft {
  const q = req.questions?.[0];
  return { ...emptyDraft, cursor: q ? Math.max(0, markedRecommended(q.options)) : 0 };
}
