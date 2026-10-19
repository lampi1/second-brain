// Advisory skill suggestions (skills/suggest.ts): which of the brain's skills fit a request, best first. Shared by the
// skills_suggest MCP tool, the role start dialog and the Classificatori page. Never a permission: a role uses only the
// skills its launch gives it (agents/role-gate.ts).
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
