// Frozen launch-context metadata: provenance and budgets without copying private fact values into chat summaries.
export interface MemorySelection {
  available: boolean;
  records: { id: string; status: string; sourceEventId?: string; sourceRunId?: string; estimatedTokens: number; score: number }[];
  omitted: { ineligible: number; unmatched: number; budget: number };
  estimatedTokens: number; budgetTokens: number;
}
/** The past runs given as examples at launch (episodic memory, ADR 0236): ids and sizes only, never their text. */
export interface RunExampleSelection {
  examples: { runId: string; score: number; estimatedTokens: number }[];
  /** verified successes of the role in the repository that could have been chosen */
  candidates: number;
}
export interface AgentContextSnapshot {
  schema: 1; at: number; mode: 'scoped' | 'sealed';
  memory: MemorySelection; skills: { name: string; sha256: string }[];
  instructions: { sha256: string; characters: number; estimatedTokens: number };
  packageDigest?: string;
  /** absent on launches before ADR 0236 and on the Orchestrator's */
  examples?: RunExampleSelection;
}
/** Invalid or legacy persisted metadata is unknown, never reconstructed as if observed at launch. */
export function readAgentContext(value: unknown): AgentContextSnapshot | undefined {
  if (!value || typeof value !== 'object' || JSON.stringify(value).length > 24_000) return;
  const v = value as AgentContextSnapshot, num = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  const string = (s: unknown, max = 200) => typeof s === 'string' && s.length <= max;
  if (v.schema !== 1 || !num(v.at) || !['scoped', 'sealed'].includes(v.mode) || !v.memory || !Array.isArray(v.memory.records) || v.memory.records.length > 8 || !v.memory.omitted
    || typeof v.memory.available !== 'boolean' || !['ineligible', 'unmatched', 'budget'].every(k => num(v.memory.omitted[k as keyof MemorySelection['omitted']])) || !num(v.memory.estimatedTokens) || !num(v.memory.budgetTokens)
    || v.memory.records.some(r => !r || !string(r.id) || !string(r.status, 30) || !num(r.estimatedTokens) || !num(r.score) || (r.sourceEventId !== undefined && !string(r.sourceEventId)) || (r.sourceRunId !== undefined && !string(r.sourceRunId)))
    || !Array.isArray(v.skills) || v.skills.length > 50 || v.skills.some(s => !s || !string(s.name) || !/^[a-f0-9]{64}$/.test(s.sha256))
    || !v.instructions || !/^[a-f0-9]{64}$/.test(v.instructions.sha256) || !num(v.instructions.characters) || !num(v.instructions.estimatedTokens)
    || (v.packageDigest !== undefined && !/^[a-f0-9]{64}$/.test(v.packageDigest))
    || (v.examples !== undefined && (!v.examples || !Array.isArray(v.examples.examples) || v.examples.examples.length > 4 || !num(v.examples.candidates)
      || v.examples.examples.some(e => !e || !/^r_[a-f0-9]{12}$/.test(e.runId) || !num(e.score) || !num(e.estimatedTokens))))) return;
  return { schema: 1, at: v.at, mode: v.mode, ...(v.packageDigest ? { packageDigest: v.packageDigest } : {}),
    ...(v.examples ? { examples: { candidates: v.examples.candidates, examples: v.examples.examples.map(e => ({ runId: e.runId, score: e.score, estimatedTokens: e.estimatedTokens })) } } : {}),
    memory: { available: v.memory.available, records: v.memory.records.map(r => ({ id: r.id, status: r.status, estimatedTokens: r.estimatedTokens, score: r.score, ...(r.sourceEventId ? { sourceEventId: r.sourceEventId } : {}), ...(r.sourceRunId ? { sourceRunId: r.sourceRunId } : {}) })),
      omitted: { ineligible: v.memory.omitted.ineligible, unmatched: v.memory.omitted.unmatched, budget: v.memory.omitted.budget }, estimatedTokens: v.memory.estimatedTokens, budgetTokens: v.memory.budgetTokens },
    skills: v.skills.map(s => ({ name: s.name, sha256: s.sha256 })), instructions: { sha256: v.instructions.sha256, characters: v.instructions.characters, estimatedTokens: v.instructions.estimatedTokens } };
}
