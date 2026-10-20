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
export function submitEffort(state: ChatEffortStatus, value: unknown): ChatEffortStatus {
  const submitted = effortValue(value);
  const pending = state.requested !== null && state.requested !== submitted && !(state.requested === 'max' && submitted === 'xhigh');
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
