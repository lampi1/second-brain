// The shape of a chat's reasoning effort as the UI shows it: what the user chose, what the turn sent and what the
// provider reports, kept apart because they are different facts. Used by src/main/chats/effort.ts and the renderer.
import type { Effort } from './contract';
/** A UI choice, an outgoing turn parameter and a provider-resolved value are different facts. */
export interface ChatEffortStatus {
  supported: boolean;
  requested: Effort | null;
  submitted: string | null;
  effective: string | null;
  pending: boolean;
  effectiveSource: 'provider' | 'unknown';
  /** A resolved thread default is not evidence of the current turn's effective value. */
  sessionDefault: string | null;
}
