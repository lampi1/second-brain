// Provider child observations, reduced independently of UI tools and external hooks. A partial event stream never
// proves a zero census; historical replay cannot revive a child that a live event already settled. Used by the
// session adapters and ChatManager, including restoration from its private chat store.
import type { AgentChildren, ChildObservation, ChildState } from '../../shared/agents';

type Coverage = AgentChildren['coverage'];
const STATES = new Set<ChildState>(['running', 'waiting', 'completed', 'failed', 'stopped', 'unknown']);
const TERMINAL = new Set<ChildState>(['completed', 'failed', 'stopped']);
const MAX_CHILDREN = 500;
/** Finished commands kept (a Codex turn runs dozens): older ones go, so they never crowd out sub-agents. */
const MAX_ENDED_SHELL = 20;
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const stamp = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 8.64e15 ? v : null;
const identifier = (v: unknown, limit: number): string | null =>
  typeof v === 'string' && v.trim() && v.length <= limit && !/[\x00-\x1f\x7f]/.test(v) ? v : null;
const text = (v: unknown, limit: number): string | null => {
  if (typeof v !== 'string') return null;
  const clean = v.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, limit);
  return clean || null;
};

/** Validate data from a provider or saved metadata, without inventing native identities or a timestamp. */
export function sanitizeChildObservation(raw: unknown): ChildObservation | null {
  const o = object(raw), key = identifier(o.key, 512), observedAt = stamp(o.observedAt);
  if (!key || observedAt === null || (o.source !== 'live' && o.source !== 'replay')) return null;
  const startedAt = stamp(o.startedAt);
  return {
    key, nativeId: identifier(o.nativeId, 300), toolCallId: identifier(o.toolCallId, 300), parentNativeId: identifier(o.parentNativeId, 300),
    kind: o.kind === 'agent' || o.kind === 'shell' ? o.kind : 'unknown',
    state: STATES.has(o.state as ChildState) ? o.state as ChildState : 'unknown',
    task: text(o.task, 1200), observedAt, source: o.source,
    // a start time never later than the observation it comes with (a saved row from before it existed has none)
    ...(startedAt !== null ? { startedAt: Math.min(startedAt, observedAt) } : {}),
  };
}

/** One reducer per session. The owner resets coverage on resume; persisted counts are never trusted. */
export class AgentChildrenReducer {
  private rows = new Map<string, ChildObservation>();
  private completeness: Coverage = 'unknown';
  private at = 0;
  private ended = false;

  constructor(initial?: unknown) {
    const o = object(initial);
    let valid = Array.isArray(o.children);
    if (Array.isArray(o.children)) for (const row of o.children.slice(0, MAX_CHILDREN)) {
      if (!sanitizeChildObservation(row)) valid = false;
      else this.observe(row);
    }
    this.at = Math.max(this.at, stamp(o.observedAt) ?? 0);
    this.completeness = o.coverage === 'complete' || o.coverage === 'partial' ? o.coverage : 'unknown';
    if (!valid || (Array.isArray(o.children) && o.children.length > MAX_CHILDREN)) this.completeness = 'unknown';
  }

  observe(raw: unknown): boolean {
    const next = sanitizeChildObservation(raw);
    if (!next || this.ended) return false;
    // The first event may identify only a spawn tool; a later one supplies its native id. Correlate them only when
    // they cannot describe two different native children of the same tool (batch spawning is possible).
    const alias = this.rows.has(next.key) ? null : [...this.rows.values()].find(row =>
      (next.nativeId !== null && row.nativeId === next.nativeId) ||
      (next.toolCallId !== null && row.toolCallId === next.toolCallId && (!row.nativeId || !next.nativeId)));
    if (alias) next.key = alias.key;
    const prev = this.rows.get(next.key);
    if (prev && next.observedAt < prev.observedAt) return false;
    // Replay is historical even when read just now. It enriches missing metadata, but never replaces a live state
    // or changes a terminal historical row back to working.
    if (prev) {
      const historical = (next.source === 'replay' && (prev.source === 'live' || TERMINAL.has(prev.state))) ||
        (prev.nativeId !== null && next.nativeId === null && TERMINAL.has(prev.state));
      const merged: ChildObservation = {
        ...next, nativeId: next.nativeId ?? prev.nativeId, toolCallId: next.toolCallId ?? prev.toolCallId,
        parentNativeId: next.parentNativeId ?? prev.parentNativeId, kind: next.kind === 'unknown' ? prev.kind : next.kind,
        task: next.task ?? prev.task,
        // the child started when the app first saw it: the earliest time any of its events carries
        startedAt: Math.min(prev.startedAt ?? prev.observedAt, next.startedAt ?? next.observedAt),
        ...(historical ? { state: prev.state, source: prev.source, observedAt: prev.observedAt } : {}),
      };
      if (JSON.stringify(prev) === JSON.stringify(merged)) return false;
      this.rows.set(next.key, merged);
    } else {
      // full: make room by dropping the oldest finished row (a command first); refuse only when all are unfinished
      if (this.rows.size >= MAX_CHILDREN && !this.evictEnded()) { this.completeness = 'unknown'; return false; }
      this.rows.set(next.key, { ...next, startedAt: next.startedAt ?? next.observedAt });
    }
    this.pruneEndedShell();
    this.at = Math.max(this.at, next.observedAt);
    return true;
  }

  /** Drops the oldest finished row, a command before an agent (dropping an agent leaves the census incomplete). */
  private evictEnded(): boolean {
    const ended = [...this.rows.values()].filter(r => TERMINAL.has(r.state)).sort((a, b) => a.observedAt - b.observedAt);
    const victim = ended.find(r => r.kind === 'shell') ?? ended[0];
    if (!victim) return false;
    this.rows.delete(victim.key);
    if (victim.kind !== 'shell') this.completeness = 'unknown';
    return true;
  }

  private pruneEndedShell(): void {
    const ended = [...this.rows.values()].filter(r => r.kind === 'shell' && TERMINAL.has(r.state));
    if (ended.length <= MAX_ENDED_SHELL) return;
    for (const r of ended.sort((a, b) => a.observedAt - b.observedAt).slice(0, ended.length - MAX_ENDED_SHELL)) this.rows.delete(r.key);
  }

  coverage(value: Coverage, observedAt = Date.now()): boolean {
    if (this.ended && value !== 'unknown') return false;
    if (!['unknown', 'partial', 'complete'].includes(value)) return false;
    const at = stamp(observedAt);
    if (at === null) return false;
    const changed = this.completeness !== value;
    this.completeness = value;
    this.at = Math.max(this.at, at);
    return changed;
  }

  /** A process ending does not prove its remote children finished. Retain terminal evidence and stale the rest. */
  end(observedAt = Date.now()): void {
    this.ended = true;
    const at = stamp(observedAt) ?? this.at;
    for (const [key, row] of this.rows) if (!TERMINAL.has(row.state)) this.rows.set(key, { ...row, state: 'unknown', observedAt: Math.max(row.observedAt, at) });
    this.coverage('unknown', at);
  }

  snapshot(): AgentChildren {
    const children = [...this.rows.values()].map(row => ({ ...row }));
    const agents = children.filter(row => row.kind === 'agent');
    const observedActive = agents.filter(row => row.state === 'running' || row.state === 'waiting').length;
    const known = this.completeness === 'complete' && children.every(row => row.kind !== 'unknown' && row.state !== 'unknown');
    return {
      coverage: this.completeness, active: known ? observedActive : null, total: known ? agents.length : null,
      observedActive, observedTotal: agents.length, observedAt: this.at, children,
    };
  }
}

export const sanitizeAgentChildren = (raw: unknown): AgentChildren => new AgentChildrenReducer(raw).snapshot();

/** Small adapter-side reporter: extraction does not depend on whether the manager or external hooks consume it. */
export class AgentChildrenReporter {
  private state = new AgentChildrenReducer();
  private ended = false;
  constructor(private readonly sink: { children?: (observation: ChildObservation) => void; childrenCoverage?: (coverage: Coverage, reason?: 'exit') => void }) {}
  coverage(value: Coverage): void {
    if (this.ended) return;
    if (this.state.coverage(value)) this.sink.childrenCoverage?.(value);
  }
  observe(observation: ChildObservation): void {
    if (this.ended) return;
    if (this.state.snapshot().coverage === 'unknown') this.coverage('partial');
    const before = this.state.snapshot();
    if (!this.state.observe(observation)) return;
    for (const row of this.state.snapshot().children) {
      if (JSON.stringify(before.children.find(child => child.key === row.key)) !== JSON.stringify(row)) this.sink.children?.(row);
    }
  }
  end(): void {
    if (this.ended) return;
    this.ended = true;
    const before = this.state.snapshot();
    this.state.end();
    for (const row of this.state.snapshot().children) {
      if (before.children.find(child => child.key === row.key)?.state !== row.state) this.sink.children?.(row);
    }
    this.sink.childrenCoverage?.('unknown', 'exit');
  }
}
