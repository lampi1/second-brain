// Scoped durable facts for memory writers and launch recall. Model assertions stay proposed; history is retained.
// The JSON store is canonical and is deliberately separate from the existing document/hybrid search index.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWrite, confined, locked, read } from './storage';

export interface MemoryScope { roleId: string; project?: string; repository?: string; environment?: string }
export type MemoryStatus = 'observed' | 'proposed' | 'confirmed' | 'disputed' | 'retracted';
export interface MemoryRecord {
  memoryId: string; scope: MemoryScope; subject: string; predicate: string; value: string;
  sourceEventId: string; sourceRunId: string; observedAt: string; validFrom: string; validTo: string | null;
  status: MemoryStatus; supersedes: string | null;
  verification?: { sourceEventId: string; sourceRunId: string; evidence: string };
}
export interface MemoryProposal {
  scope: MemoryScope; subject: string; predicate: string; value: string;
  sourceEventId: string; sourceRunId: string; supersedes?: string;
}
const FILE = 'memory/records.json';
const clean = (s: string, limit = 1000): string => {
  if (typeof s !== 'string' || !s.trim() || s.length > limit || /[\x00-\x1f\x7f]/.test(s)) throw new Error('Memory fields must be bounded, nonempty single lines.');
  return s.trim();
};
function scopeOf(scope: MemoryScope): MemoryScope {
  const roleId = clean(scope.roleId, 64);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(roleId)) throw new Error('Invalid memory role id.');
  return { roleId, ...(scope.project ? { project: clean(scope.project) } : {}), ...(scope.repository ? { repository: clean(scope.repository) } : {}), ...(scope.environment ? { environment: clean(scope.environment) } : {}) };
}
const sameScope = (a: MemoryScope, b: MemoryScope): boolean => a.roleId === b.roleId && a.project === b.project && a.repository === b.repository && a.environment === b.environment;
export function readMemoryRecords(root: string): MemoryRecord[] {
  const raw = read(root, FILE);
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length > 5000) throw new Error('Invalid memory store.');
  // Reject malformed storage rather than injecting arbitrary fields from disk as trusted facts.
  for (const r of parsed as MemoryRecord[]) {
    if (!r || typeof r !== 'object') throw new Error('Invalid memory record.');
    scopeOf(r.scope); clean(r.memoryId); clean(r.subject); clean(r.predicate); clean(r.value); clean(r.sourceEventId); clean(r.sourceRunId);
    if (!['observed', 'proposed', 'confirmed', 'disputed', 'retracted'].includes(r.status) || !Number.isFinite(Date.parse(r.observedAt)) || !Number.isFinite(Date.parse(r.validFrom)) || (r.validTo !== null && !Number.isFinite(Date.parse(r.validTo)))) throw new Error('Invalid memory record.');
  }
  return parsed as MemoryRecord[];
}
function mutate<T>(root: string, change: (records: MemoryRecord[]) => T): T {
  fs.mkdirSync(path.dirname(confined(root, FILE)), { recursive: true });
  return locked(root, FILE, () => {
    const records = readMemoryRecords(root), result = change(records), text = JSON.stringify(records, null, 2) + '\n';
    if (records.length > 5000 || Buffer.byteLength(text, 'utf8') > 2_000_000) throw new Error('Memory store full; archive explicitly before adding facts.');
    atomicWrite(root, FILE, text); return result;
  });
}
export function proposeMemory(root: string, input: MemoryProposal, now = new Date().toISOString()): MemoryRecord {
  const scope = scopeOf(input.scope), subject = clean(input.subject), predicate = clean(input.predicate), value = clean(input.value);
  const sourceEventId = clean(input.sourceEventId), sourceRunId = clean(input.sourceRunId);
  if (!Number.isFinite(Date.parse(now))) throw new Error('Invalid observation date.');
  return mutate(root, records => {
    const previous = input.supersedes ? records.find(r => r.memoryId === input.supersedes) : undefined;
    if (input.supersedes && (!previous || !sameScope(previous.scope, scope) || previous.subject !== subject || previous.predicate !== predicate)) throw new Error('Supersession must identify the same scoped fact.');
    const duplicate = records.find(r => sameScope(r.scope, scope) && r.subject === subject && r.predicate === predicate && r.value === value && r.validTo === null && r.status !== 'retracted' && r.status !== 'disputed');
    if (duplicate) return duplicate;
    const record: MemoryRecord = { memoryId: randomUUID(), scope, subject, predicate, value, sourceEventId, sourceRunId, observedAt: now, validFrom: now, validTo: null, status: 'proposed', supersedes: previous?.memoryId ?? null };
    // A proposal never invalidates confirmed evidence. Contradictions require independent resolution.
    records.push(record); return record;
  });
}
/** Host-only transition: callers must supply an independently verified event, never model tool arguments. */
export function confirmMemory(root: string, memoryId: string, verification: NonNullable<MemoryRecord['verification']>, now = new Date().toISOString()): MemoryRecord {
  clean(verification.evidence); clean(verification.sourceEventId); clean(verification.sourceRunId);
  if (!Number.isFinite(Date.parse(now))) throw new Error('Invalid verification date.');
  return mutate(root, records => {
    const r = records.find(x => x.memoryId === memoryId);
    if (!r || r.status !== 'proposed' || verification.sourceEventId === r.sourceEventId || verification.sourceRunId === r.sourceRunId) throw new Error('Independent verification is required.');
    if (Date.parse(now) < Date.parse(r.observedAt)) throw new Error('Verification predates observation.');
    r.status = 'confirmed'; r.verification = { ...verification };
    if (r.supersedes) { const old = records.find(x => x.memoryId === r.supersedes); if (old) { old.validTo = now; old.status = 'retracted'; } }
    return r;
  });
}
const words = (s: string): Set<string> => new Set(s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
/** Whole records under a conservative token estimate; scoped candidates remain quoted unverified data. */
export function recallMemory(root: string, scope: MemoryScope, query = '', budgetTokens = 1200): string {
  const q = words(query), now = Date.now();
  const all = readMemoryRecords(root);
  const rows: { text: string; score: number; confirmed: boolean; date: string }[] = all.filter(r => sameScope(r.scope, scope) && !['disputed', 'retracted'].includes(r.status) && Date.parse(r.validFrom) <= now && (!r.validTo || Date.parse(r.validTo) > now)).map(r => ({
    text: JSON.stringify({ id: r.memoryId, status: r.status, subject: r.subject, predicate: r.predicate, value: r.value, sourceEventId: r.sourceEventId, sourceRunId: r.sourceRunId, observedAt: r.observedAt }),
    score: [...words(`${r.subject} ${r.predicate} ${r.value}`)].filter(w => q.has(w)).length, confirmed: r.status === 'confirmed', date: r.observedAt,
  }));
  // Legacy facts have no project provenance: never silently apply them to a project-specific launch.
  if (!scope.project && !scope.repository && !scope.environment) {
    const known = new Set(all.filter(r => r.scope.roleId === scope.roleId).map(r => r.value));
    for (const line of read(root, `agents/${scope.roleId}/memory.md`).split('\n').filter(l => /^[-*] /.test(l))) {
      if ([...known].some(v => line.endsWith(` · ${v}`))) continue;
      rows.push({ text: JSON.stringify({ status: 'unverified-legacy', value: line }), score: [...words(line)].filter(w => q.has(w)).length, confirmed: false, date: '' });
    }
  }
  rows.sort((a, b) => b.score - a.score || Number(b.confirmed) - Number(a.confirmed) || b.date.localeCompare(a.date));
  let left = Math.max(0, Math.min(budgetTokens, 4000)) * 3;
  const chosen: string[] = [];
  for (const row of rows) { if (q.size && !row.score) continue; if (row.text.length + 1 > left) continue; chosen.push(row.text); left -= row.text.length + 1; }
  return chosen.join('\n');
}
