// How many cold starts run at once on automatic (ADR 0222): cloudroom's bound, half the logical cores, at least 1.
// Shared so main's admission queue (chats/admission.ts) and Settings → Avanzate «Coda e avvii»
// (renderer/components/QueueSettings.tsx) say the same number.

/** max(1, floor(cores / 2)): 7 on a 14-core PC */
export function autoColdSlots(cores: number): number {
  return Math.max(1, Math.floor(cores / 2));
}
