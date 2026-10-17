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
