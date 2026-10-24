// Scoped durable facts for memory writers and launch recall. Model assertions stay proposed; history is retained.
// The JSON store is canonical and is deliberately separate from the existing document/hybrid search index.
// Every new fact passes the worth gate (memory-worth.ts, ADR 0129): a case-specific one is refused with what to save
// instead. The maintenance's tidy-up (tidyMemory: merge, generalize, drop) is undone by undoMemoryTidy.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWrite, confined, locked, read } from './storage';
import { checkMemoryWorth, sameMemoryFact } from './memory-worth';
import { emptyPredicate } from '../../shared/proposals';

export interface MemoryScope { roleId: string; userId?: string; project?: string; repository?: string; environment?: string }
export type MemoryStatus = 'observed' | 'proposed' | 'confirmed' | 'disputed' | 'retracted';
export interface MemoryRecord {
  memoryId: string; scope: MemoryScope; subject: string; predicate: string; value: string;
  sourceEventId: string; sourceRunId: string; observedAt: string; validFrom: string; validTo: string | null;
  status: MemoryStatus; supersedes: string | null;
  transitions?: { at: string; status: MemoryStatus; reason?: string }[];
  derivedFiles?: string[];
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
  return { roleId, ...(scope.userId ? { userId: clean(scope.userId) } : {}), ...(scope.project ? { project: clean(scope.project) } : {}), ...(scope.repository ? { repository: clean(scope.repository) } : {}), ...(scope.environment ? { environment: clean(scope.environment) } : {}) };
}
const sameScope = (a: MemoryScope, b: MemoryScope): boolean => a.roleId === b.roleId && a.userId === b.userId && a.project === b.project && a.repository === b.repository && a.environment === b.environment;
export function readMemoryRecords(root: string): MemoryRecord[] {
  const raw = read(root, FILE);
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length > 5000) throw new Error('Invalid memory store.');
  // Reject malformed storage rather than injecting arbitrary fields from disk as trusted facts.
  for (const r of parsed as MemoryRecord[]) {
    if (!r || typeof r !== 'object') throw new Error('Invalid memory record.');
    if (r.transitions && (!Array.isArray(r.transitions) || r.transitions.length > 10000 || r.transitions.some(t => !t || !Number.isFinite(Date.parse(t.at)) || !['observed', 'proposed', 'confirmed', 'disputed', 'retracted'].includes(t.status)))) throw new Error('Invalid memory transitions.');
    if (r.derivedFiles && (!Array.isArray(r.derivedFiles) || r.derivedFiles.some(f => typeof f !== 'string' || !f.startsWith('memory/derived/')))) throw new Error('Invalid memory derivatives.');
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
  checkMemoryWorth(subject, predicate, value);
  return mutate(root, records => {
    const previous = input.supersedes ? records.find(r => r.memoryId === input.supersedes) : undefined;
    if (input.supersedes && (!previous || !sameScope(previous.scope, scope) || previous.subject !== subject || previous.predicate !== predicate)) throw new Error('Supersession must identify the same scoped fact.');
    const equivalents = records.filter(r => sameScope(r.scope, scope) && sameMemoryFact(r, { subject, predicate, value }));
    const duplicate = equivalents.find(r => r.validTo === null && r.status !== 'retracted' && r.status !== 'disputed'
      && (!previous || r.memoryId === previous.memoryId || r.supersedes === previous.memoryId));
    if (duplicate) return duplicate;
    // Repeating an observation is neither new evidence nor a reason to ask again after dismissal. Retain the
    // original record, provenance and status; an explicitly linked supersession still requires fresh approval.
    const dismissed = !previous && equivalents.findLast(r => r.status === 'retracted' || r.status === 'disputed');
    if (dismissed) return dismissed;
    const record: MemoryRecord = { memoryId: randomUUID(), scope, subject, predicate, value, sourceEventId, sourceRunId, observedAt: now, validFrom: now, validTo: null, status: 'proposed', transitions: [{ at: now, status: 'proposed' }], supersedes: previous?.memoryId ?? null };
    // A proposal never invalidates confirmed evidence. Contradictions require independent resolution.
    records.push(record); return record;
  });
}
/** The user's answer when a confirmed fact with the same subject and predicate already says something else: `new`
 *  retracts those facts (the new one supersedes them), `both` keeps them beside it. `ids` are the facts the user saw. */
export interface MemoryConflictChoice { keep: 'new' | 'both'; ids: string[] }
/** The confirmed facts a proposed one contradicts (same scope, subject and predicate, another value), not the one it
 *  already supersedes. */
export function memoryConflicts(records: readonly MemoryRecord[], r: MemoryRecord): MemoryRecord[] {
  // free notes («setup · note», every agent_report `remember` line) are separate facts, never two values of one thing
  if (emptyPredicate(r.predicate)) return [];
  return records.filter(x => x.memoryId !== r.memoryId && x.memoryId !== r.supersedes && sameScope(x.scope, r.scope) && x.subject === r.subject && x.predicate === r.predicate && x.status === 'confirmed' && !x.validTo && x.value !== r.value);
}
const retire = (root: string, old: MemoryRecord, by: string, now: string): void => {
  purgeCopies(root, old); delete old.derivedFiles; old.validTo = now;
  (old.transitions ??= [{ at: old.observedAt, status: old.status }]).push({ at: now, status: 'retracted', reason: `superseded:${by}` }); old.status = 'retracted';
};
/** Host-only transition: callers must supply an independently verified event, never model tool arguments. */
export function confirmMemory(root: string, memoryId: string, verification: NonNullable<MemoryRecord['verification']>, now = new Date().toISOString(), choice?: MemoryConflictChoice): MemoryRecord {
  clean(verification.evidence); clean(verification.sourceEventId); clean(verification.sourceRunId);
  if (!Number.isFinite(Date.parse(now))) throw new Error('Invalid verification date.');
  return mutate(root, records => {
    const r = records.find(x => x.memoryId === memoryId);
    if (r?.status === 'confirmed' && r.verification?.evidence === verification.evidence) return r;
    if (!r || r.status !== 'proposed' || verification.sourceEventId === r.sourceEventId || verification.sourceRunId === r.sourceRunId) throw new Error('Independent verification is required.');
    if (Date.parse(now) < Date.parse(r.observedAt)) throw new Error('Verification predates observation.');
    // A contradiction is resolved only by the user's explicit choice on exactly the facts they saw.
    const conflicts = memoryConflicts(records, r), ids = new Set(choice?.ids ?? []);
    if (conflicts.length && (!choice || conflicts.length !== ids.size || conflicts.some(x => !ids.has(x.memoryId)))) throw new Error('Conflicting confirmed fact requires explicit supersession.');
    r.status = 'confirmed'; (r.transitions ??= [{ at: r.observedAt, status: 'proposed' }]).push({ at: now, status: 'confirmed', ...(conflicts.length && choice?.keep === 'both' ? { reason: `kept-beside:${conflicts.map(x => x.memoryId).join(',')}` } : {}) }); r.verification = { ...verification };
    if (r.supersedes) { const old = records.find(x => x.memoryId === r.supersedes); if (old) retire(root, old, r.memoryId, now); }
    if (choice?.keep === 'new') for (const old of conflicts) retire(root, old, r.memoryId, now);
    return r;
  });
}
/** Temporal visibility is evaluated before retrieval. Missing legacy transition data never invents confirmation. */
export function memoryAt(record: MemoryRecord, asOf = new Date().toISOString()): MemoryRecord | null {
  const at = Date.parse(asOf);
  if (!Number.isFinite(at)) throw new Error('Invalid asOf date.');
  if (Date.parse(record.validFrom) > at || (record.validTo && Date.parse(record.validTo) <= at)) return null;
  const past = record.transitions?.filter(t => Date.parse(t.at) <= at).at(-1);
  const status = past?.status ?? (record.transitions ? null : record.status === 'retracted' ? 'proposed' : record.status);
  if (!status || status === 'retracted' || status === 'disputed') return null;
  const snapshot = { ...record, status, ...(record.transitions ? { transitions: record.transitions.filter(t => Date.parse(t.at) <= at) } : {}) };
  if (status !== 'confirmed') delete snapshot.verification;
  return snapshot;
}
export function scopedMemory(root: string, scope: MemoryScope, asOf?: string): MemoryRecord[] {
  scopeOf(scope);
  return readMemoryRecords(root).filter(r => sameScope(r.scope, scope)).flatMap(r => { const visible = memoryAt(r, asOf); return visible ? [visible] : []; });
}
/** Removes only app-owned copies: exact legacy lines and registered summaries, never arbitrary user documents. */
function purgeCopies(root: string, record: MemoryRecord): string[] {
  const changed: string[] = [];
  for (const rel of [`agents/${record.scope.roleId}/memory.md`, 'memory/shared.md']) {
    const before = read(root, rel);
    if (!before) continue;
    const next = before.split('\n').filter(line => line.replace(/^[-*]\s+(?:\d{4}-\d{2}-\d{2}\s*[·|:-]\s*)?/, '').trim() !== record.value).join('\n');
    if (next !== before) { atomicWrite(root, rel, next); changed.push(rel); }
  }
  for (const rel of record.derivedFiles ?? []) {
    if (!rel.startsWith('memory/derived/')) throw new Error('Invalid derived memory path.');
    const file = confined(root, rel); fs.rmSync(file, { force: true }); changed.push(rel);
  }
  return changed;
}
export function registerMemoryDerivative(root: string, memoryId: string, relative: string): void {
  if (!relative.startsWith('memory/derived/')) throw new Error('Derived memory must use its managed folder.');
  confined(root, relative);
  mutate(root, records => { const r = records.find(x => x.memoryId === memoryId); if (!r) throw new Error('Memory not found.'); r.derivedFiles = [...new Set([...(r.derivedFiles ?? []), relative])]; });
}
export function retractMemory(root: string, memoryId: string, reason: string, now = new Date().toISOString()): { record: MemoryRecord; invalidated: string[] } {
  clean(reason);
  if (!Number.isFinite(Date.parse(now))) throw new Error('Invalid retraction date.');
  return mutate(root, records => {
    const r = records.find(x => x.memoryId === memoryId);
    if (!r) throw new Error('Memory not found.');
    if (r.status === 'retracted') {
      if (r.transitions?.at(-1)?.reason === reason) return { record: r, invalidated: [FILE] };
      throw new Error('Memory was already retracted with a different reason.');
    }
    if (Date.parse(now) < Date.parse(r.observedAt)) throw new Error('Retraction predates observation.');
    const invalidated = purgeCopies(root, r);
    (r.transitions ??= [{ at: r.observedAt, status: r.status }]).push({ at: now, status: 'retracted', reason });
    r.status = 'retracted'; r.validTo = now; delete r.derivedFiles;
    return { record: r, invalidated: [FILE, ...invalidated] };
  });
}
/** Hard deletion removes the payload even from historical recall; no tombstone retains its content. */
export function deleteMemory(root: string, memoryId: string): string[] {
  return mutate(root, records => {
    const index = records.findIndex(r => r.memoryId === memoryId);
    if (index < 0) return [FILE]; // idempotent retry still invalidates an index after an earlier failure
    const invalidated = purgeCopies(root, records[index]!); records.splice(index, 1);
    for (const r of records) if (r.supersedes === memoryId) r.supersedes = null;
    return [FILE, ...invalidated];
  });
}
// ── the maintenance's tidy-up (brainmodel/jobs.ts mergeMemory, ADR 0129) ───────────────────────────────────────────────
/** One pass's work on the store: facts retired (merged into another, already known, not generalizable) and facts
 *  rewritten as the general rule behind them (a new record beside the old one, which is retired). */
export interface MemoryTidy { retire: { id: string; reason: string }[]; generalize: { id: string; value: string }[] }
/** What undoes one tidy-up: the facts it retired and the ones it wrote, under the tag of its change. */
export interface MemoryTidyUndo { tag: string; retired: string[]; added: string[]; proposedFrom?: string[] }
const open = (r: MemoryRecord | undefined): r is MemoryRecord => !!r && r.validTo === null && (r.status === 'proposed' || r.status === 'confirmed') && !r.derivedFiles?.length;
/** Applies a tidy-up under the store's lock. Rewriting confirmed evidence creates an unverified proposed supersession;
 *  the original stays current until independent approval. Only proposed originals can be retired automatically.
 *  Nothing is purged: history stays, and undoMemoryTidy restores retired proposals and removes untouched additions. */
export function tidyMemory(root: string, tidy: MemoryTidy, tag: string, now = new Date().toISOString()): MemoryTidyUndo {
  clean(tag, 100);
  return mutate(root, records => {
    const undo: MemoryTidyUndo = { tag, retired: [], added: [] };
    const retire = (r: MemoryRecord, reason: string) => {
      (r.transitions ??= [{ at: r.observedAt, status: r.status }]).push({ at: now, status: 'retracted', reason: `${tag}:${reason}` });
      r.status = 'retracted'; r.validTo = now; undo.retired.push(r.memoryId);
    };
    for (const g of tidy.generalize) {
      const old = records.find(r => r.memoryId === g.id);
      if (!open(old) || undo.retired.includes(old.memoryId)) continue;
      if (old.status === 'confirmed' && records.some(r => r.supersedes === old.memoryId)) continue;
      const value = clean(g.value);
      checkMemoryWorth(old.subject, old.predicate, value);
      const record: MemoryRecord = { memoryId: randomUUID(), scope: { ...old.scope }, subject: old.subject, predicate: old.predicate, value, sourceEventId: `${tag}:${old.memoryId}`,
        sourceRunId: old.sourceRunId, observedAt: now, validFrom: now, validTo: null, status: 'proposed', supersedes: old.status === 'confirmed' ? old.memoryId : null,
        transitions: [{ at: now, status: 'proposed', reason: `${tag}:generalized-from:${old.memoryId}` }] };
      records.push(record); undo.added.push(record.memoryId);
      if (old.status === 'proposed') retire(old, `generalized:${record.memoryId}`);
      else (undo.proposedFrom ??= []).push(old.memoryId);
    }
    for (const x of tidy.retire) {
      const r = records.find(y => y.memoryId === x.id);
      if (open(r) && r.status === 'proposed' && !undo.retired.includes(r.memoryId)) retire(r, clean(x.reason, 200));
    }
    return undo;
  });
}
/** The tidy-up can still be undone: every fact it retired is still retired by it, every fact it wrote still untouched. */
export function canUndoMemoryTidy(root: string, undo: MemoryTidyUndo): boolean {
  let records: MemoryRecord[];
  try { records = readMemoryRecords(root); } catch { return false; }
  return undo.retired.every(id => { const r = records.find(x => x.memoryId === id); return r?.status === 'retracted' && !!r.transitions?.at(-1)?.reason?.startsWith(`${undo.tag}:`); })
    && undo.added.every(id => { const r = records.find(x => x.memoryId === id); return !!r && r.validTo === null && r.transitions?.length === 1; });
}
/** Puts the store back as it was before the tidy-up: the retired facts open again, the written ones go. */
export function undoMemoryTidy(root: string, undo: MemoryTidyUndo): void {
  if (!canUndoMemoryTidy(root, undo)) throw new Error('This memory change can no longer be undone: the facts changed since.');
  mutate(root, records => {
    for (const id of undo.retired) {
      const r = records.find(x => x.memoryId === id)!;
      r.transitions!.pop();
      r.status = r.transitions!.at(-1)?.status ?? 'proposed'; r.validTo = null;
    }
    for (const id of undo.added) {
      const at = records.findIndex(x => x.memoryId === id);
      if (at >= 0) records.splice(at, 1);
    }
  });
}
export const memoryWords = (s: string): Set<string> => new Set(s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').match(/[\p{L}\p{N}]{3,}/gu) ?? []);
export const quoteMemory = (r: MemoryRecord): string => JSON.stringify({ id: r.memoryId, status: r.status, scope: r.scope, subject: r.subject, predicate: r.predicate, value: r.value, sourceEventId: r.sourceEventId, sourceRunId: r.sourceRunId, observedAt: r.observedAt, validFrom: r.validFrom, validTo: r.validTo });
export function budgetMemory(rows: string[], budgetTokens = 1200): string {
  let left = Math.max(0, Math.min(budgetTokens, 4000)) * 3;
  const chosen: string[] = [];
  for (const text of rows) { if (text.length + 1 > left) continue; chosen.push(text); left -= text.length + 1; }
  return chosen.join('\n');
}
/** Whole records under a conservative token estimate; scoped candidates remain quoted unverified data. */
export function recallMemory(root: string, scope: MemoryScope, query = '', budgetTokens = 1200, asOf?: string): string {
  const q = memoryWords(query), all = readMemoryRecords(root);
  const rows = scopedMemory(root, scope, asOf).map(r => ({ text: quoteMemory(r), score: [...memoryWords(`${r.subject} ${r.predicate} ${r.value}`)].filter(w => q.has(w)).length, confirmed: r.status === 'confirmed', date: r.observedAt }));
  // Unscoped legacy records cannot establish historical validity, project or user provenance.
  if (!asOf && !scope.userId && !scope.project && !scope.repository && !scope.environment) {
    const known = new Set(all.filter(r => r.scope.roleId === scope.roleId).map(r => r.value));
    for (const line of read(root, `agents/${scope.roleId}/memory.md`).split('\n').filter(l => /^[-*] /.test(l))) {
      if ([...known].some(v => line.endsWith(` · ${v}`))) continue;
      rows.push({ text: JSON.stringify({ status: 'unverified-legacy', value: line }), score: [...memoryWords(line)].filter(w => q.has(w)).length, confirmed: false, date: '' });
    }
  }
  rows.sort((a, b) => b.score - a.score || Number(b.confirmed) - Number(a.confirmed) || b.date.localeCompare(a.date));
  return budgetMemory(rows.filter(r => !q.size || r.score > 0).map(r => r.text), budgetTokens);
}
