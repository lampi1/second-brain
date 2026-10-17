// Deterministic, budgeted user context assembly for prompt adapters. Reader resolves explicit source IDs only.
// This data is untrusted context, never permission or instructions; legacy prompts work without a packet.
type Category = 'constraint' | 'profile' | 'activity';
interface Fact { id: string; key: string; value: string; confirmation: 'confirmed' | 'pending'; confirmedAt: string | null; category?: Category }
type SourceScope = 'user' | 'project' | 'agent-private' | 'task' | 'procedure' | 'archive';
interface Source { schemaVersion: 1; id: string; label: string; facts: Fact[]; revision?: number; scope?: SourceScope }
interface SelectedFact extends Fact { sourceId: string; sourceLabel: string; sourceRevision: number | null; sourceScope: SourceScope }
export interface ContextPacket {
  text: string; bytes: number;
  estimatedTokens: { value: number; method: 'ceil-utf8-bytes-div-4'; approximate: true };
  status: 'empty' | 'ready' | 'degraded';
  included: string[]; omitted: string[]; conflicts: string[]; pending: string[]; unavailable: string[];
}

const id = (v: unknown): v is string => typeof v === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(v);
function parseSource(input: unknown, expectedId: string): Source {
  if (JSON.stringify(input)?.length > 64 * 1024 || !input || typeof input !== 'object') throw new Error('Invalid context source');
  const s = input as Source;
  if (s.schemaVersion !== 1 || s.id !== expectedId || typeof s.label !== 'string' || !s.label.trim() || s.label.length > 120 || !Array.isArray(s.facts) || s.facts.length > 100) throw new Error('Invalid context source');
  if (s.revision !== undefined && (!Number.isSafeInteger(s.revision) || s.revision < 0)) throw new Error('Invalid context source revision');
  if (s.scope !== undefined && !['user', 'project', 'agent-private', 'task', 'procedure', 'archive'].includes(s.scope)) throw new Error('Invalid context scope');
  const seen = new Set<string>();
  for (const f of s.facts) {
    if (!f || !id(f.id) || !id(f.key) || seen.has(f.id) || typeof f.value !== 'string' || !f.value.trim() || f.value.length > 2000 || !['confirmed', 'pending'].includes(f.confirmation)) throw new Error('Invalid context fact');
    if (f.confirmation === 'confirmed' && (typeof f.confirmedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(f.confirmedAt) || !Number.isFinite(Date.parse(f.confirmedAt)))) throw new Error('Confirmed fact requires timestamp');
    if (f.confirmation === 'pending' && f.confirmedAt !== null) throw new Error('Pending fact cannot be confirmed');
    if (f.category !== undefined && !['constraint', 'profile', 'activity'].includes(f.category)) throw new Error('Invalid context category');
    seen.add(f.id);
  }
  return { schemaVersion: 1, id: s.id, label: s.label, facts: s.facts.map(f => ({ id: f.id, key: f.key, value: f.value, confirmation: f.confirmation, confirmedAt: f.confirmedAt, category: f.category ?? (s.id === 'essential' ? 'profile' : 'activity') })), revision: s.revision, scope: s.scope };
}

/** canonical is essential only. readSource is called once per explicit ID; no directory discovery or fallback. */
export function loadUserContext(canonical: unknown | null, requested: string[], readSource: (id: string) => unknown, budgetBytes = 4096): ContextPacket {
  if (!Number.isSafeInteger(budgetBytes) || budgetBytes < 256 || budgetBytes > 32768 || !Array.isArray(requested) || requested.length > 8 || requested.some(s => !id(s) || s === 'essential')) throw new Error('Invalid context request/budget');
  const result: ContextPacket = { text: '', bytes: 0, estimatedTokens: { value: 0, method: 'ceil-utf8-bytes-div-4', approximate: true }, status: 'empty', included: [], omitted: [], conflicts: [], pending: [], unavailable: [] };
  const sources: Source[] = [];
  const add = (input: unknown, sourceId: string) => {
    try { sources.push(parseSource(input, sourceId)); } catch { result.unavailable.push(sourceId); }
  };
  if (canonical !== null && canonical !== undefined) add(canonical, 'essential');
  for (const sourceId of [...new Set(requested)].sort()) {
    try { add(readSource(sourceId), sourceId); } catch { result.unavailable.push(sourceId); }
  }
  const facts: SelectedFact[] = sources.flatMap(s => s.facts.map(f => ({ ...f, sourceId: s.id, sourceLabel: s.label, sourceRevision: s.revision ?? null, sourceScope: s.scope ?? (s.id === 'essential' ? 'user' : 'task') })));
  const confirmed = facts.filter(f => f.confirmation === 'confirmed');
  result.pending = facts.filter(f => f.confirmation === 'pending').map(f => `${f.sourceId}/${f.id}`);
  result.conflicts = [...new Set(confirmed.filter(f => confirmed.some(other => other.key === f.key && other.value !== f.value)).map(f => f.key))].sort();
  const chosen: SelectedFact[] = [];
  // Whole facts: explicit constraints, profile, activity. Essential first within each category; no guessed rules.
  const render = () => JSON.stringify({ kind: 'untrusted-user-context', schemaVersion: 1, facts: chosen });
  const priority: Record<Category, number> = { constraint: 0, profile: 1, activity: 2 };
  for (const fact of confirmed.sort((a, b) => priority[a.category!] - priority[b.category!] || Number(b.sourceId === 'essential') - Number(a.sourceId === 'essential') || a.sourceId.localeCompare(b.sourceId, 'en') || a.id.localeCompare(b.id, 'en'))) {
    const ref = `${fact.sourceId}/${fact.id}`;
    if (result.conflicts.includes(fact.key)) { result.omitted.push(ref); continue; }
    chosen.push(fact);
    if (Buffer.byteLength(render(), 'utf8') > budgetBytes) { chosen.pop(); result.omitted.push(ref); }
    else result.included.push(ref);
  }
  result.text = chosen.length ? render() : '';
  result.bytes = Buffer.byteLength(result.text, 'utf8');
  // Reporting heuristic only: never used to claim/allocate a model window or enforce the byte budget.
  result.estimatedTokens.value = Math.ceil(result.bytes / 4);
  result.status = result.omitted.length || result.pending.length || result.unavailable.length ? 'degraded' : chosen.length ? 'ready' : 'empty';
  return result;
}
