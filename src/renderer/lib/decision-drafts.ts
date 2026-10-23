// Free answers survive evidence viewers, queue navigation and postponement, keyed to the exact proposal version.
// Session-only and bounded: never transfer a draft to a replacement proposal or retain a submitted answer.
const drafts = new Map<string, string>();
export const decisionDraft = (key: string): string => drafts.get(key) ?? '';
export function saveDecisionDraft(key: string, text: string): void {
  if (!text) { drafts.delete(key); return; }
  drafts.delete(key); drafts.set(key, text);
  if (drafts.size > 100) drafts.delete(drafts.keys().next().value!);
}
