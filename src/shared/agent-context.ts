// Frozen launch-context metadata: provenance and budgets without copying private fact values into chat summaries.
export interface MemorySelection {
  available: boolean;
  records: { id: string; status: string; sourceEventId?: string; sourceRunId?: string; estimatedTokens: number; score: number }[];
  omitted: { ineligible: number; unmatched: number; budget: number };
  estimatedTokens: number; budgetTokens: number;
}
export interface AgentContextSnapshot {
  schema: 1; at: number; mode: 'scoped' | 'sealed';
  memory: MemorySelection; skills: { name: string; sha256: string }[];
  instructions: { sha256: string; characters: number; estimatedTokens: number };
  packageDigest?: string;
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
    || (v.packageDigest !== undefined && !/^[a-f0-9]{64}$/.test(v.packageDigest))) return;
  return { schema: 1, at: v.at, mode: v.mode, ...(v.packageDigest ? { packageDigest: v.packageDigest } : {}),
    memory: { available: v.memory.available, records: v.memory.records.map(r => ({ id: r.id, status: r.status, estimatedTokens: r.estimatedTokens, score: r.score, ...(r.sourceEventId ? { sourceEventId: r.sourceEventId } : {}), ...(r.sourceRunId ? { sourceRunId: r.sourceRunId } : {}) })),
      omitted: { ineligible: v.memory.omitted.ineligible, unmatched: v.memory.omitted.unmatched, budget: v.memory.omitted.budget }, estimatedTokens: v.memory.estimatedTokens, budgetTokens: v.memory.budgetTokens },
    skills: v.skills.map(s => ({ name: s.name, sha256: s.sha256 })), instructions: { sha256: v.instructions.sha256, characters: v.instructions.characters, estimatedTokens: v.instructions.estimatedTokens } };
}
