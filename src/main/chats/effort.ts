// A chat's effort as four facts (requested, submitted, effective, session default): the manager keeps them per chat
// (ChatSummary.effortStatus), the chat header and tiles show the effective one (renderer/lib/effort-label.ts).
import type { Effort } from '../../shared/contract';
import type { ChatEffortStatus } from '../../shared/effort';
export const effortValue = (value: unknown): string | null => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,39}$/.test(value) ? value : null;
export function initialEffort(supported: boolean, requested: Effort | null): ChatEffortStatus {
  return { supported, requested, submitted: null, effective: null, pending: supported && requested !== null, effectiveSource: 'unknown', sessionDefault: null };
}
export function selectEffort(state: ChatEffortStatus, requested: Effort | null): ChatEffortStatus {
  return { ...state, requested, pending: state.supported && requested !== state.requested ? true : state.pending };
}
const matches = (requested: Effort | null, value: string): boolean => requested === value || (requested === 'max' && value === 'xhigh');
/** A turn sent: the value the app gave it. No value (a turn without a per-turn effort, one the CLI starts by itself)
 *  keeps the effort the engine last reported, since the session's effort did not change; a value other than that
 *  report makes the effective one unknown until the engine reports again (the label shows the submitted one). */
export function submitEffort(state: ChatEffortStatus, value: unknown): ChatEffortStatus {
  const submitted = effortValue(value);
  if (submitted === null) return { ...state, submitted };
  if (state.effectiveSource === 'provider' && state.effective === submitted) return { ...state, submitted, pending: state.pending && !matches(state.requested, submitted) };
  const pending = state.requested !== null && !matches(state.requested, submitted);
  return { ...state, submitted, effective: null, effectiveSource: 'unknown', pending };
}
/** The effort the engine itself reports for the session or turn (Claude's init, an ACP model's thought_level value):
 *  the effective one. An unreadable or absent report makes it unknown again, never a guess. */
export function observeEffort(state: ChatEffortStatus, value: unknown): ChatEffortStatus {
  const effective = effortValue(value);
  if (!effective) return { ...state, effective: null, effectiveSource: 'unknown' };
  const pending = state.requested !== null && state.requested !== effective && !(state.requested === 'max' && effective === 'xhigh') && state.pending;
  return { ...state, effective, effectiveSource: 'provider', pending };
}
