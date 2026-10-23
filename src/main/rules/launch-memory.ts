// Task-selective launch memory for AgentPackFlows. This is a read-only view; memory_recall still searches every fact.
// User-confirmed facts, legacy text and unknown provenance stay present even when the optional-memory budget is full.
import { budgetMemory, memoryWords, quoteMemory, readMemoryRecords, scopedMemory, type MemoryRecord, type MemoryScope } from './memory-records';
import { read } from './storage';

const STOP = new Set('the and for with from this that then into your task please una uno per con del della delle degli nel nella alla che come prima dopo'.split(' '));
const words = (s: string): Set<string> => new Set([...memoryWords(s)].filter(w => !STOP.has(w)));
/** Only host-marked model proposals can be faded. Missing provenance is protected, never inferred to be generated. */
export function protectedMemory(r: MemoryRecord): boolean {
  return r.status === 'confirmed' || !!r.verification || !/^(memory-proposal:|report:)/.test(r.sourceEventId)
    || /\b(security|sicurezza|permission|permissions|permessi|credential|credentials|credenziali|secret|secrets|segreti|password|sandbox|token|production|produzione)\b/i.test(`${r.subject} ${r.predicate} ${r.value}`);
}
export interface LaunchMemory { text: string; selected: number; omitted: number; protected: number }
export function selectLaunchMemory(root: string, scope: MemoryScope, query = '', budgetTokens = 1200): LaunchMemory {
  const rows = scopedMemory(root, scope), pinned = rows.filter(protectedMemory), q = words(query.slice(0, 16000));
  const optional = rows.filter(r => !protectedMemory(r)).map(r => ({ r, score: [...words(`${r.subject} ${r.predicate} ${r.value}`)].filter(w => q.has(w)).length }))
    .filter(r => r.score > 0).sort((a, b) => b.score - a.score || b.r.observedAt.localeCompare(a.r.observedAt) || a.r.memoryId.localeCompare(b.r.memoryId));
  const selectedText = budgetMemory(optional.slice(0, 40).map(({ r }) => quoteMemory(r)), budgetTokens);
  const selected = selectedText ? selectedText.split('\n').length : 0;
  const protectedText = pinned.sort((a, b) => a.memoryId.localeCompare(b.memoryId)).map(quoteMemory);
  // A legacy file has no reliable author metadata. Preserve it in unscoped launches, including non-bullet notes;
  // known record copies are excluded so retracted or out-of-scope facts cannot re-enter through the old Markdown.
  if (!scope.userId && !scope.project && !scope.repository && !scope.environment) {
    const known = readMemoryRecords(root).filter(r => r.scope.roleId === scope.roleId).map(r => r.value);
    const legacy = read(root, `agents/${scope.roleId}/memory.md`).split('\n').filter(line => !known.some(value => line.endsWith(` · ${value}`))).join('\n').trim();
    if (legacy) protectedText.push(JSON.stringify({ status: 'unverified-legacy', value: legacy }));
  }
  const omitted = rows.length - pinned.length - selected;
  return { text: [...protectedText, selectedText].filter(Boolean).join('\n'), selected, omitted, protected: protectedText.length };
}
