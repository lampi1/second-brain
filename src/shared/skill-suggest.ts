// Advisory skill suggestions (skills/suggest.ts): which of the brain's skills fit a request, best first. Shared by the
// skills_suggest MCP tool, the role start dialog and the Classificatori page. Never a permission: a role uses only the
// skills its launch gives it (agents/role-gate.ts).
/** skills_suggest's request limit (skills/suggest.ts suggestRequest) */
export const SUGGEST_REQUEST_MAX = 2000;
/** The app's own callers (a run's goal, a follow-up's prompt): the first SUGGEST_REQUEST_MAX characters, the topic is
 *  up front; null = nothing to rank. The limit stays a refusal for the agent-facing tool (#185). */
export function suggestInput(text: string | null | undefined): string | null {
  const t = (text ?? '').trim();
  return t ? t.slice(0, SUGGEST_REQUEST_MAX).trim() : null;
}
export interface SkillCandidate {
  name: string;
  /** 0-100 text affinity (words, or the local embeddings when they are ready) */
  score: number;
  why: { field: 'name' | 'description' | 'pastRun'; runId?: string };
}
export interface SkillSuggestions {
  candidates: SkillCandidate[];
  /** hybrid = words and the local embeddings; words = words only (the model is missing, busy or slow) */
  mode: 'hybrid' | 'words';
}
/** How many suggestions a request gets. */
export const SKILL_SUGGESTIONS_MAX = 5;
