// Role definition versions: the bounded behaviour history (role-history.json). The catalog owns the roles; this module
// owns what each version did, so metrics can compare versions later.
import path from 'node:path';
import { AMENDS_KEPT, BEHAVIOUR_FIELDS, VERSIONED_CHANGES, type AgentAuthor, type AgentBehaviour, type AgentProfile, type AgentVersion, type AgentVersionState, type VersionedChange } from '../../shared/agents';
import { readLocal, writeLocal } from './local-store';

export const HISTORY_PER_AGENT = 50;
/** Below the local store's 8 MB cap, with headroom for the entry being added. */
export const HISTORY_BYTES = 7_000_000;
const STATES: readonly AgentVersionState[] = ['active', 'trial', 'kept', 'rejected', 'superseded'];
const AUTHORS: readonly AgentAuthor[] = ['default', 'user', 'maintenance'];
const ID = /^[a-z][a-z0-9_-]{0,79}$/;
const count = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 1;

export function behaviourOf(p: AgentBehaviour): AgentBehaviour {
  return structuredClone({ instructions: p.instructions, engine: p.engine, model: p.model,
    ...(p.effort !== undefined ? { effort: p.effort } : {}), ...(p.knowhow !== undefined ? { knowhow: p.knowhow } : {}), tools: p.tools ?? null, permissionCeiling: p.permissionCeiling ?? null,
    ...(typeof p.maxContext === 'number' ? { maxContext: p.maxContext } : {}), tier: p.tier, tierMax: p.tierMax, launches: [...p.launches], skills: [...p.skills] });
}
/** Field-order independent: two saves of the same behaviour never create a version. */
export function sameBehaviour(a: AgentBehaviour, b: AgentBehaviour): boolean {
  const norm = (v: unknown): unknown => Array.isArray(v) ? v.map(norm) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, norm((v as Record<string, unknown>)[k])])) : v;
  const x = behaviourOf(a), y = behaviourOf(b);
  return BEHAVIOUR_FIELDS.every(k => k === 'knowhow' ? x.knowhow?.hash === y.knowhow?.hash : JSON.stringify(norm(x[k] ?? null)) === JSON.stringify(norm(y[k] ?? null)));
}

/** The fields behind each versioned change (ADR 0186). */
const VERSIONED_FIELDS: Record<VersionedChange, readonly (typeof BEHAVIOUR_FIELDS)[number][]> = {
  text: ['instructions'], skills: ['skills', 'knowhow'], model: ['engine', 'model', 'effort'], tier: ['tier', 'tierMax'],
};
/** What changed between two behaviours that makes a new version; empty = the active version is updated in place. */
export function versionedChanges(a: AgentBehaviour, b: AgentBehaviour): VersionedChange[] {
  const x = behaviourOf(a), y = behaviourOf(b);
  const same = (k: (typeof BEHAVIOUR_FIELDS)[number]): boolean => k === 'knowhow' ? x.knowhow?.hash === y.knowhow?.hash
    : k === 'skills' ? JSON.stringify([...x.skills].sort()) === JSON.stringify([...y.skills].sort()) : JSON.stringify(x[k] ?? null) === JSON.stringify(y[k] ?? null);
  return VERSIONED_CHANGES.filter(c => VERSIONED_FIELDS[c].some(k => !same(k)));
}

export function firstVersion(p: AgentProfile, author: AgentAuthor, reason: string, at: number): AgentVersion {
  return { agentId: p.id, version: 1, parentVersion: null, behaviour: behaviourOf(p), author, reason, at, state: 'active' };
}

function readEntry(v: unknown): AgentVersion {
  const e = v as Partial<AgentVersion> | null;
  if (!e || typeof e !== 'object' || typeof e.agentId !== 'string' || !ID.test(e.agentId) || !count(e.version) || !(e.parentVersion === null || count(e.parentVersion))
    || !e.behaviour || typeof e.behaviour !== 'object' || typeof e.behaviour.instructions !== 'string' || typeof e.behaviour.engine !== 'string'
    || !AUTHORS.includes(e.author as AgentAuthor) || typeof e.reason !== 'string' || e.reason.length > 600 || !Number.isFinite(e.at) || !STATES.includes(e.state as AgentVersionState)) throw new Error('Invalid role history entry');
  // `changed` (ADR 0186) is a record only: one out of shape is dropped, never a reason to refuse the history
  const out = { ...e } as AgentVersion;
  if (e.changed !== undefined && !(Array.isArray(e.changed) && e.changed.every(c => (VERSIONED_CHANGES as readonly unknown[]).includes(c)))) delete out.changed;
  if (e.amended !== undefined && !(Array.isArray(e.amended) && e.amended.length <= AMENDS_KEPT && e.amended.every(a => a && Number.isFinite(a.at) && AUTHORS.includes(a.by) && typeof a.reason === 'string' && a.reason.length <= 600))) delete out.amended;
  return out;
}
/** A version whose behaviour is updated in place (ADR 0186: a change that makes no new version). */
export interface VersionAmend { agentId: string; version: number; behaviour: AgentBehaviour; at: number; by: AgentAuthor; reason: string }
/** A change to a stored version: its state. */
export interface VersionChange { agentId: string; version: number; state: AgentVersionState }

/** Bounded per agent; pruning drops the oldest superseded or rejected version, never v1 or the active/trial one. */
export class AgentHistory {
  private readonly file: string;
  private entries: AgentVersion[] = [];
  problem: string | null = null;
  constructor(userData: string, name: string) {
    this.file = path.join(userData, name);
    try {
      const raw = readLocal(this.file) as { version?: unknown; entries?: unknown } | undefined;
      if (raw === undefined) return;
      if (raw.version !== 1 || !Array.isArray(raw.entries) || raw.entries.length > 256 * HISTORY_PER_AGENT) throw new Error('Invalid role history');
      const keys = new Set<string>();
      this.entries = raw.entries.map(readEntry).filter(e => { const k = `${e.agentId}/${e.version}`; if (keys.has(k)) throw new Error('Duplicate agent version'); keys.add(k); return true; });
    } catch { this.problem = 'La cronologia delle versioni dei ruoli non è leggibile. Il file è conservato; le modifiche ai ruoli sono sospese.'; }
  }
  list(agentId: string): AgentVersion[] { return structuredClone(this.entries.filter(e => e.agentId === agentId).sort((a, b) => b.version - a.version)); }
  get(agentId: string, version: number): AgentVersion | undefined { const e = this.entries.find(x => x.agentId === agentId && x.version === version); return e && structuredClone(e); }
  /**
   * Applies all changes in one write. Adding version N drops that agent's entries from N up: they belong to a save
   * whose catalog write failed, or to an agent whose catalog was regenerated, and the new N supersedes them. `amends`
   * rewrite a version's behaviour in place (ADR 0186: a change that makes no new version).
   */
  commit(add: AgentVersion[], states: VersionChange[] = [], amends: VersionAmend[] = []): void {
    if (this.problem) throw new Error(this.problem);
    let next = this.entries.map(e => states.filter(x => x.agentId === e.agentId && x.version === e.version)
      .reduce<AgentVersion>((v, s) => ({ ...v, state: s.state }), e));
    next = next.map(e => { const a = amends.find(x => x.agentId === e.agentId && x.version === e.version); return a ? { ...e, behaviour: structuredClone(a.behaviour), amended: [...(e.amended ?? []), { at: a.at, by: a.by, reason: a.reason.slice(0, 600) }].slice(-AMENDS_KEPT) } : e; });
    for (const e of add) next = [...next.filter(x => !(x.agentId === e.agentId && x.version >= e.version)), structuredClone(e)];
    const removable = (e: AgentVersion) => e.version !== 1 && (e.state === 'superseded' || e.state === 'rejected');
    for (const agentId of new Set(add.map(e => e.agentId))) {
      const own = next.filter(e => e.agentId === agentId).sort((a, b) => a.version - b.version);
      const drop = new Set(own.filter(removable).slice(0, Math.max(0, own.length - HISTORY_PER_AGENT)).map(e => e.version));
      next = next.filter(e => e.agentId !== agentId || !drop.has(e.version));
    }
    // Entry counts do not bound bytes (instructions and manifests are large): past the budget, drop the oldest
    // superseded/rejected versions of any agent so saves never stay blocked.
    const size = (list: AgentVersion[]) => Buffer.byteLength(JSON.stringify({ version: 1, entries: list }, null, 2), 'utf8') + 1;
    if (size(next) > HISTORY_BYTES) {
      const order = next.filter(removable).sort((a, b) => a.at - b.at || a.version - b.version);
      const drop = new Set<AgentVersion>();
      let bytes = size(next);
      for (const e of order) {
        if (bytes <= HISTORY_BYTES) break;
        drop.add(e);
        bytes -= Buffer.byteLength(JSON.stringify(e, null, 2), 'utf8');
      }
      next = next.filter(e => !drop.has(e));
    }
    writeLocal(this.file, { version: 1, entries: next });
    this.entries = next;
  }
}
