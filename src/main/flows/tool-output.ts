// Bounded agent-facing routine discovery. Summary pages omit prompts/inputs; explicit detail reads return digest-pinned
// JSON text chunks so even one oversized definition stays readable. This changes transport only, never stored data.
import { createHash } from 'node:crypto';
import { APP_OWNER, type FlowSnapshot } from '../../shared/flows';
import type { FlowAutomationSnapshot } from '../../shared/flow-automation';
import { integer, text } from './schema';
export const FLOW_TOOL_MAX = 40_000;
export const listProperties = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 25 }, contentOffset: { type: 'integer', minimum: 0 }, expectedDigest: { type: 'string' } };
const offsetOf = (args: Record<string, unknown>, key = 'offset') => args[key] === undefined ? 0 : integer(args[key], key, 0, Number.MAX_SAFE_INTEGER);
const paging = (args: Record<string, unknown>) => ({ offset: offsetOf(args), limit: args.limit === undefined ? 10 : integer(args.limit, 'limit', 1, 25) });
const short = (value: string | undefined, max = 200) => value === undefined ? undefined : value.slice(0, max);
export function detailPage(value: unknown, args: Record<string, unknown>, contextKey: string): object {
  const json = JSON.stringify(value), digest = createHash('sha256').update(json).digest('hex');
  if (args.expectedDigest !== undefined && args.expectedDigest !== digest) throw new Error('Detail changed; restart with contentOffset 0 and its new digest');
  const offset = offsetOf(args, 'contentOffset'); if (offset > json.length) throw new Error('contentOffset exceeds detail length');
  const make = (end: number) => ({ contextKey, digest, content: json.slice(offset, end), totalCharacters: json.length, contentOffset: offset, nextContentOffset: end < json.length ? end : null, truncated: end < json.length, ...(end < json.length ? { note: 'Truncated: repeat the same selection with contentOffset=nextContentOffset and expectedDigest=digest; concatenate content before parsing JSON.' } : {}) });
  let low = offset, high = Math.min(json.length, offset + 32000);
  while (low < high) { const end = Math.ceil((low + high) / 2); if (JSON.stringify(make(end)).length <= FLOW_TOOL_MAX) low = end; else high = end - 1; }
  return make(low);
}
/** Read-only results can always be reconstructed by repeating the same selection, pinned to its digest. */
export function capReadResult(value: unknown, args: Record<string, unknown>, contextKey: string): unknown {
  if (value && typeof (value as Promise<unknown>).then === 'function') return Promise.resolve(value).then(result => capReadResult(result, args, contextKey));
  if (args.contentOffset !== undefined || args.expectedDigest !== undefined || (JSON.stringify(value)?.length ?? 0) > FLOW_TOOL_MAX) return detailPage(value, args, contextKey);
  return value;
}
/** Last line of defence for every flow/automation tool, including a huge mutation receipt or dossier. */
export function capFlowResult(value: unknown): unknown {
  if (value && typeof (value as Promise<unknown>).then === 'function') return Promise.resolve(value).then(capFlowResult);
  const encoded = JSON.stringify(value); if (!encoded || encoded.length <= FLOW_TOOL_MAX) return value;
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const receipt: Record<string, string | number> = {};
  for (const key of ['id', 'runId', 'flowId', 'revision', 'version', 'flowVersion', 'status', 'contextKey', 'currentStep', 'digest', 'markdown', 'json']) {
    const item = row[key]; if (typeof item === 'string') receipt[key] = item.slice(0, 1000); else if (typeof item === 'number') receipt[key] = item;
  }
  const definition = row.definition as { id?: unknown } | undefined;
  if (typeof definition?.id === 'string') receipt.flowId = definition.id.slice(0, 200);
  return { ...receipt, truncated: true, totalCharacters: encoded.length, note: 'Truncated tool result. Use app_flow_list section definition/draft/run with flowId/runId and contentOffset, or app_flow_auto_list detail:true with ruleId and contentOffset. Dossiers: use section summary and open the returned viewer paths. The operation was not retried.' };
}
export function flowList(snapshot: FlowSnapshot, owner: string, args: Record<string, unknown>): object {
  const section = args.section ?? 'summary', { offset, limit } = paging(args);
  const owned = snapshot.runs.filter(run => run.ownerOrchestratorId === owner || run.ownerOrchestratorId === APP_OWNER);
  if (section === 'run') { const run = owned.find(r => r.id === args.runId); if (!run) throw new Error('Owned run unavailable'); return detailPage(run, args, snapshot.contextKey); }
  if (section === 'definition' || section === 'draft') {
    const id = text(args.flowId, 'flowId', 80);
    const selected = section === 'draft' ? snapshot.drafts.find(d => d.definition.id === id) : snapshot.versions.find(v => v.definition.id === id && v.version === (args.version === undefined ? snapshot.active[id] : integer(args.version, 'version', 1, Number.MAX_SAFE_INTEGER)));
    if (!selected) throw new Error('Requested routine version/draft unavailable');
    return detailPage(selected, args, snapshot.contextKey);
  }
  if (section !== 'summary') throw new Error('section: summary, definition, draft or run');
  const ids = [...new Set([...snapshot.versions.map(v => v.definition.id), ...snapshot.drafts.map(d => d.definition.id)])].sort();
  const flows = ids.slice(offset, offset + limit).map(id => {
    const draft = snapshot.drafts.find(d => d.definition.id === id), active = snapshot.versions.find(v => v.definition.id === id && v.version === snapshot.active[id]), latest = snapshot.versions.filter(v => v.definition.id === id).at(-1), definition = draft?.definition ?? active?.definition ?? latest!.definition;
    return { id, title: short(definition.title), activeVersion: snapshot.active[id] ?? null, revision: draft?.revision ?? active?.draftRevision ?? latest?.draftRevision, status: draft?.status ?? (active ? 'active' : 'inactive'), stepCount: definition.steps.length, versionCount: snapshot.versions.filter(v => v.definition.id === id).length, ownedRunCount: owned.filter(r => r.flowId === id).length };
  });
  const runs = owned.slice(offset, offset + limit).map(run => { const step = run.steps[run.currentStep]; return { id: run.id, flowId: run.flowId, flowVersion: run.flowVersion, revision: run.revision, status: run.status, currentStep: step ? { id: step.stepId, status: step.status, chatId: step.chatId, reason: short(step.reason) } : null, stepCount: run.steps.length }; });
  return { contextKey: snapshot.contextKey, storageError: short(snapshot.storageError), flows, runs, counts: { flows: ids.length, runs: owned.length }, offset, limit, nextOffset: offset + limit < Math.max(ids.length, owned.length) ? offset + limit : null };
}
export function automationList(snapshot: FlowAutomationSnapshot, contextKey: string, owner: string, args: Record<string, unknown>): object {
  const { offset, limit } = paging(args);
  for (const key of ['allOwners', 'detail']) if (args[key] !== undefined && typeof args[key] !== 'boolean') throw new Error(`${key}: expected boolean`);
  const rules = snapshot.rules.filter(r => args.allOwners === true || r.ownerOrchestratorId === owner);
  const ownedIds = new Set(snapshot.rules.filter(r => r.ownerOrchestratorId === owner).map(r => r.id));
  const events = snapshot.events.filter(e => ownedIds.has(e.ruleId));
  if (args.detail === true) { const rule = rules.find(r => r.id === args.ruleId); if (!rule) throw new Error('Requested rule unavailable; specify ruleId (allOwners:true for other owners)'); return detailPage(rule, args, contextKey); }
  const selected = args.ruleId === undefined ? rules : rules.filter(r => r.id === args.ruleId), selectedIds = new Set(selected.map(r => r.id));
  const visibleEvents = events.filter(e => selectedIds.has(e.ruleId));
  return { contextKey, revision: snapshot.revision, paused: snapshot.paused, background: snapshot.background, storageError: short(snapshot.storageError), counts: { rules: selected.length, events: visibleEvents.length }, offset, limit, nextOffset: offset + limit < Math.max(selected.length, visibleEvents.length) ? offset + limit : null,
    rules: selected.slice(offset, offset + limit).map(r => ({ id: r.id, flowId: r.config.flowId, flowVersion: r.config.flowVersion, ownerOrchestratorId: r.ownerOrchestratorId, revision: r.revision, approvedRevision: r.approvedRevision, status: r.status, trigger: r.config.trigger.kind, failures: r.failures, error: short(r.error), nextCheckAt: r.nextCheckAt, eventCount: visibleEvents.filter(e => e.ruleId === r.id).length })),
    events: visibleEvents.slice(offset, offset + limit).map(e => ({ id: e.id, ruleId: e.ruleId, ruleRevision: e.ruleRevision, title: short(e.title), status: e.status, attempts: e.attempts, runId: e.runId, reason: short(e.reason) })) };
}
