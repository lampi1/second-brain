// Frozen launch metadata validation prevents malformed or extra private data from entering the inspector.
import { expect, it } from 'vitest';
import { readAgentContext, type AgentContextSnapshot } from '../../src/shared/agent-context';
const snapshot: AgentContextSnapshot = { schema: 1, mode: 'scoped', at: 1, memory: { available: true, records: [{ id: 'fact', status: 'confirmed', estimatedTokens: 10, score: 1, sourceRunId: 'run' }], omitted: { ineligible: 1, unmatched: 2, budget: 3 }, budgetTokens: 1200, estimatedTokens: 10 }, skills: [{ name: 'review', sha256: 'a'.repeat(64) }], instructions: { sha256: 'b'.repeat(64), characters: 300, estimatedTokens: 100 } };
it('round-trips the frozen manifest and drops unrecognized content fields', () => {
  expect(readAgentContext(snapshot)).toEqual(snapshot);
  const raw = { ...snapshot, rawPrompt: 'not metadata', memory: { ...snapshot.memory, records: snapshot.memory.records.map(r => ({ ...r, value: 'private fact value' })) } };
  expect(readAgentContext(raw)).toEqual(snapshot); expect(JSON.stringify(readAgentContext(raw))).not.toContain('private fact');
});
it('legacy, oversized and nonfinite metadata remains unknown', () => {
  expect(readAgentContext(undefined)).toBeUndefined(); expect(readAgentContext({ ...snapshot, at: NaN })).toBeUndefined();
  expect(readAgentContext({ ...snapshot, skills: new Array(51).fill(snapshot.skills[0]) })).toBeUndefined();
});
