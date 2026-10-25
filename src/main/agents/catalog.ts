// The role catalog: the Orchestrator and the five work roles (shared/roles.ts), plus Pulse in the background, kept in
// <userData>/roles.json with every behaviour change as a version (role-history.json). The user edits a role's tools,
// ceiling, engine, model tier, launches, skills and instructions (Brain → Agenti); "Ripristina predefinito" goes back to
// the shipped role. No role is ever created or removed by the user; a retired role's stored entry (Router, Judge, Scribe,
// ADR 0100) is left out on load and a launches list naming one drops it, so an older roles.json still loads. resolve() turns a role id into what a chat starts with: engine,
// model (the role's tier on that engine), the composed instructions, the tool policy. Used by ChatManager, the IPC
// handlers (index.ts), the packs (pack/flows.ts) and the maintenance jobs (brainmodel/).
import type { AgentContextSnapshot } from '../../shared/agent-context';
import path from 'node:path';
import { checkedKnowhow, checkedPackIdentity, packName } from '../../shared/agent-pack';
import type { Effort, Harness, NewChat } from '../../shared/contract';
import { MAX_CONTEXT_RANGE, PERMISSION_CEILINGS, type AgentAuthor, type AgentCatalog, type AgentDraft, type AgentModelChoice, type AgentOwnerSnapshot, type AgentProfile, type AgentToolPolicy, type AgentVersion, type PermissionCeiling } from '../../shared/agents';
import { FLASH_ID, MODEL_TIERS, PULSE_ID, ROLE_DEFAULTS, ROLE_IDS, ROLE_PREAMBLE, currentLaunches, currentRoleId, isRetiredRoleId, isRoleId, isWorkRole, roleName, tierRank, type ModelTier, type RoleId } from '../../shared/roles';
import { characterOf, isCharacterId } from '../../shared/characters';
import { readLocal, writeLocal } from './local-store';
import { AgentHistory, behaviourOf, firstVersion, sameBehaviour } from './versions';
import { checkedTools, type AgentPolicy } from './tool-policy';
import { cappedTier } from './model-tier';
import { fiveRolesTextFor, fullDefaultsFor, shippedTextFor } from './role-migrate';
import { engineOf } from '../engines/registry';
import { log, errText } from '../log';

const MODEL = /^[\w.:@/[\]][\w.:@/=[\],-]{0,119}$/;
const ID = /^[a-z][a-z0-9_-]{0,79}$/;
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const AUTHORS: readonly AgentAuthor[] = ['default', 'user', 'maintenance'];
const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const count = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 1;
const has = <T>(list: readonly T[], v: unknown): v is T => (list as readonly unknown[]).includes(v);
const CATALOG_IDS: readonly string[] = [...ROLE_IDS, PULSE_ID, FLASH_ID];
/** the entries that are not roles: never delegated, never in the role count */
const isBackground = (id: string): boolean => id === PULSE_ID || id === FLASH_ID;
/** «Flash» (ADR 0107): its face and default instructions; its read-only tools and plan ceiling are fixed (behaviour) */
const FLASH = { name: 'Flash', purpose: 'Risposte al volo accanto all’Orchestrator: vede la sua chat, legge, non cambia nulla',
  instructions: 'Answer fast and briefly, in the user\'s language. Lead with the answer.' };
const FLASH_TOOLS: AgentToolPolicy = { allow: ['read', 'web'] };
const PULSE = { name: 'Pulse', purpose: 'Idee, consigli, promemoria, collegamenti e frase della Dashboard',
  instructions: 'Use only the digest you are given. Cite the sources. Propose a few concrete cards without inventing facts. Take no action.' };

function text(v: unknown, max: number, label: string, empty = false): string {
  if (typeof v !== 'string' || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v) || (!empty && !v.trim())) throw new Error(`${label}: testo ${empty ? 'fino a' : 'da 1 a'} ${max} caratteri.`);
  return v.trim();
}

export interface AgentCatalogDeps {
  userData: string;
  models: () => AgentModelChoice[];
  /** the engine the user chose at setup (Settings.orchestratorChats.harness): untouched roles follow it while it is usable */
  preferredEngine?: () => string | null;
  /** Pulse's engine, model and effort (Impostazioni → Pulse) */
  pulsePreset?: () => { engine: string; model: string | null; effort?: Effort };
  /** the model a tier means on an engine (agents/model-tier.ts with the registry and Settings.modelTiers); null = the
   *  engine's own default */
  tierModel?: (engine: Harness, tier: ModelTier) => string | null;
  /** the routing table's row for this chat (kind and area from its title and prompt), when it is on `engine` and names a
   *  model: a role with no model of its own takes it, and its effort when the role names none (ADR 0078, 0091) */
  tableModel?: (engine: Harness, req: NewChat) => { model: string; effort: Effort | null } | null;
  emit?: (catalog: AgentCatalog) => void;
  now?: () => number;
  onCustomized?: () => void;
}
/** What a chat starts with: the request with the role's engine, model and effort, its owner snapshot, the composed
 *  instructions and the tool policy; skills = the role's default skills; launches = the roles it may delegate to. */
export interface ResolvedRole {
  launchContext?: AgentContextSnapshot;
  request: NewChat; owner: AgentOwnerSnapshot; instructions: string; policy: AgentPolicy | null;
  maxContext?: number; skills: string[]; launches: string[];
  /** the model tier a role chat runs on */
  tier?: ModelTier;
  /** 'table' = the model (and effort, if the role names none) came from the routing table's row */
  modelFrom?: 'table';
}

export function ownerOf(p: AgentProfile): AgentOwnerSnapshot {
  return { id: p.id, name: p.name, purpose: p.purpose, avatar: { kind: 'character', value: characterOf(p.id) }, engine: p.engine, model: p.model, revision: p.updatedAt, source: 'catalog', version: p.activeVersion };
}
/** A chat started without a role: the user's own permissions, no run, no character. */
export function plainOwner(engine: string, model: string | null): AgentOwnerSnapshot {
  return { id: 'plain', name: 'Chat', purpose: 'Chat avviata senza un ruolo', engine, model, revision: 1, source: 'plain' };
}
/** The Orchestrator's owner: the session's engine and model with the Orchestrator's face; never a run. */
export function orchestratorOwner(engine: string, model: string | null, p?: Pick<AgentProfile, 'updatedAt' | 'activeVersion'>): AgentOwnerSnapshot {
  const d = ROLE_DEFAULTS.orchestrator;
  return { id: d.id, name: d.name, purpose: d.summary, avatar: { kind: 'character', value: 'orchestrator' }, engine, model, revision: p?.updatedAt ?? 1, source: 'catalog', ...(p ? { version: p.activeVersion } : {}) };
}

/** Bounded validation for snapshots read from chats.json; model/engine never replace the effective session facts. An
 *  owner of a role this build does not know is dropped (the chat shows without a face); a retired role's owner shows as
 *  its successor (ADR 0100: an old Judge chat reads Sentinel). */
export function readOwner(v: unknown): AgentOwnerSnapshot | null {
  const a = obj(v), avatar = obj(a.avatar);
  if (typeof a.id !== 'string' || !ID.test(a.id) || typeof a.name !== 'string' || !a.name.trim() || a.name.length > 80 || typeof a.purpose !== 'string' || a.purpose.length > 400
    || typeof a.engine !== 'string' || !/^[a-z][a-z0-9_-]{0,59}$/.test(a.engine) || !(a.model === null || typeof a.model === 'string' && MODEL.test(a.model))
    || typeof a.revision !== 'number' || !Number.isFinite(a.revision) || !(a.version === undefined || count(a.version))) return null;
  if (a.source === 'plain') return { id: 'plain', name: a.name, purpose: a.purpose, engine: a.engine, model: a.model as string | null, revision: a.revision, source: 'plain' };
  if (a.source !== 'catalog') return null;
  if (isRetiredRoleId(a.id)) {
    const id = currentRoleId(a.id) as RoleId, r = ROLE_DEFAULTS[id];
    return { id, name: r.name, purpose: r.summary, engine: a.engine, model: a.model as string | null, revision: a.revision, source: 'catalog', avatar: { kind: 'character', value: id }, ...(a.version !== undefined ? { version: a.version as number } : {}) };
  }
  if (!CATALOG_IDS.includes(a.id)) return null;
  const value = isCharacterId(avatar.value) ? avatar.value : characterOf(a.id);
  return { id: a.id, name: a.name, purpose: a.purpose, engine: a.engine, model: a.model as string | null, revision: a.revision, source: 'catalog', avatar: { kind: 'character', value }, ...(a.version !== undefined ? { version: a.version as number } : {}) };
}

/** The editable fields, validated. Name, purpose and character always come from the role. */
type Behaviour = Pick<AgentProfile, 'instructions' | 'engine' | 'model' | 'effort' | 'tools' | 'permissionCeiling' | 'knowhow' | 'pack' | 'maxContext' | 'tier' | 'tierMax' | 'launches' | 'skills'>;

export class AgentCatalogService {
  private readonly file: string;
  private readonly store: AgentHistory;
  private profiles: AgentProfile[] = [];
  private problem: string | null = null;
  /** Set by the packs: a version change that swaps the know-how republishes its editable brain copy. */
  private knowhowListener: ((profile: AgentProfile, previousHash: string | undefined) => void) | null = null;
  onKnowhowChange(listener: (profile: AgentProfile, previousHash: string | undefined) => void): void { this.knowhowListener = listener; }
  private knowhowChanged(before: AgentProfile, after: AgentProfile): void {
    if (before.knowhow?.hash !== after.knowhow?.hash) this.knowhowListener?.(structuredClone(after), before.knowhow?.hash);
  }

  constructor(private readonly d: AgentCatalogDeps) {
    this.file = path.join(d.userData, 'roles.json');
    this.store = new AgentHistory(d.userData, 'role-history.json');
    try {
      const raw = readLocal(this.file);
      if (raw !== undefined) {
        const a = obj(raw);
        if (a.format !== 1 || !Array.isArray(a.roles)) throw new Error('Catalogo dei ruoli non valido.');
        this.profiles = this.read(a.roles);
      }
    } catch { this.problem = 'Il catalogo dei ruoli non è leggibile. Il file è conservato; correggilo prima di modificare i ruoli.'; return; }
    this.seed();
    this.fullDefaults();
  }

  private now(): number { return this.d.now?.() ?? Date.now(); }
  /** Entries this build knows, each valid on its own; an unknown id is left out (a newer build wrote it, or it is a role
   *  ADR 0100 retired: its successor is a role of its own). */
  private read(rows: unknown[]): AgentProfile[] {
    const out: AgentProfile[] = [];
    for (const value of rows) {
      const p = obj(value);
      if (typeof p.id !== 'string' || !CATALOG_IDS.includes(p.id) || out.some(x => x.id === p.id)) continue;
      const trial = p.trial === undefined ? undefined : obj(p.trial);
      if (typeof p.createdAt !== 'number' || !Number.isFinite(p.createdAt) || typeof p.updatedAt !== 'number' || !Number.isFinite(p.updatedAt)
        || !count(p.version) || !count(p.activeVersion) || p.activeVersion > p.version || !has(AUTHORS, p.lastEditedBy) || typeof p.userLocked !== 'boolean'
        || (trial && (!count(trial.version) || trial.version > p.version || !count(trial.baseline) || trial.baseline > p.version || typeof trial.startedAt !== 'number'))) throw new Error('Versione del ruolo non valida.');
      out.push({ ...this.face(p.id), ...this.behaviour(p, p.id, false), id: p.id, scope: isBackground(p.id) ? 'background' : 'role',
        createdAt: p.createdAt, updatedAt: p.updatedAt, version: p.version, activeVersion: p.activeVersion,
        ...(trial ? { trial: { version: trial.version as number, baseline: trial.baseline as number, startedAt: trial.startedAt as number } } : {}),
        lastEditedBy: p.lastEditedBy, userLocked: p.userLocked });
    }
    return out;
  }
  /** The fixed part of an entry: name, purpose and character. */
  private face(id: string): Pick<AgentProfile, 'name' | 'purpose' | 'avatar'> {
    if (isRoleId(id)) { const r = ROLE_DEFAULTS[id]; return { name: r.name, purpose: r.summary, avatar: { kind: 'character', value: id } }; }
    if (id === FLASH_ID) return { name: FLASH.name, purpose: FLASH.purpose, avatar: { kind: 'character', value: FLASH_ID } };
    return { name: PULSE.name, purpose: PULSE.purpose, avatar: { kind: 'character', value: 'pulse' } };
  }
  /** The engine a new or reset role starts on: the user's chosen engine (onboarding, Settings.orchestratorChats.harness)
   *  while it is usable, else a ready one, else any enabled and trusted one, else Claude (issue #96). */
  private defaultEngine(): Harness {
    const usable = this.d.models().filter(x => x.enabled && x.trusted && x.defaultModel && x.installed !== false && x.authenticated !== false);
    return (this.preferredUsable(usable) ?? usable.find(x => x.installed === true && x.authenticated === true) ?? usable[0])?.engine ?? 'claude';
  }
  private preferredUsable(usable = this.d.models().filter(x => x.enabled && x.trusted && x.defaultModel && x.installed !== false && x.authenticated !== false)): AgentModelChoice | undefined {
    const preferred = this.d.preferredEngine?.() ?? null;
    return preferred ? usable.find(x => x.engine === preferred) : undefined;
  }
  private defaults(id: string): Behaviour {
    if (id === PULSE_ID) {
      const p = this.d.pulsePreset?.() ?? { engine: this.defaultEngine(), model: null };
      return { instructions: PULSE.instructions, engine: p.engine, model: p.model, ...(p.effort ? { effort: p.effort } : {}), tools: { allow: [] }, permissionCeiling: 'plan',
        tier: 'light', tierMax: 'light', launches: [], skills: [] };
    }
    // Flash starts on the user's engine with the mid tier's model (as Lampo did, ADR 0105), reading only
    if (id === FLASH_ID) return { instructions: FLASH.instructions, engine: this.defaultEngine(), model: null, tools: structuredClone(FLASH_TOOLS), permissionCeiling: 'plan',
      tier: 'mid', tierMax: 'mid', launches: [], skills: [] };
    const r = ROLE_DEFAULTS[id as RoleId], engine = this.defaultEngine();
    return { instructions: r.instructions, engine, model: null, tools: { allow: engineOf(engine)?.kind === 'api' ? ['read'] : [...r.tools] }, permissionCeiling: r.ceiling,
      tier: r.tier, tierMax: r.tierMax, launches: [...r.launches], skills: [...r.skills] };
  }
  /** Every role and Pulse are always there: a missing entry is added with its defaults (never overwriting one). */
  private seed(): void {
    const missing = CATALOG_IDS.filter(id => !this.profiles.some(p => p.id === id));
    if (!missing.length) return;
    const at = this.now();
    const added = missing.map(id => ({ ...this.face(id), ...this.defaults(id), id, scope: isBackground(id) ? 'background' as const : 'role' as const,
      createdAt: at, updatedAt: at, version: 1, activeVersion: 1, lastEditedBy: 'default' as const, userLocked: false }) satisfies AgentProfile);
    try { this.commit(this.ordered([...this.profiles, ...added]), added.map(p => firstVersion(p, 'default', 'Ruolo predefinito', at))); }
    catch (e) { this.problem = this.store.problem ?? `Il catalogo dei ruoli non è stato scritto: ${errText(e)}`; this.profiles = this.ordered([...this.profiles, ...added]); }
  }
  /** ADR 0085: a role the user never edited that still has the restrictive defaults of ADR 0083 moves to the full ones
   *  (role-migrate.ts), as a new version by the default ("Permessi completi predefiniti"). Once, by construction: the
   *  new values no longer match the old ones. */
  private fullDefaults(): void {
    if (this.problem || this.store.problem) return;
    for (const old of [...this.profiles]) {
      const fields = fullDefaultsFor(old);
      if (!fields) continue;
      try { this.version(old, this.behaviour({ ...fields }, old.id, false, old), 'default', 'Permessi completi predefiniti (ADR 0085)'); }
      catch (e) { log.warn('agents', 'role not moved to full permissions', { cause: errText(e), hint: 'check that roles.json and role-history.json in the app data folder are writable', data: { role: old.id } }); }
    }
    // ADR 0100: a role the user never edited whose text still names Router, Judge or Scribe gets today's text
    for (const old of [...this.profiles]) {
      const fields = fiveRolesTextFor(old);
      if (!fields) continue;
      try { this.version(old, this.behaviour({ ...fields }, old.id, false, old), 'default', 'Cinque ruoli di lavoro (ADR 0100)'); }
      catch (e) { log.warn('agents', 'role text not moved to the five work roles', { cause: errText(e), hint: 'check that roles.json and role-history.json in the app data folder are writable', data: { role: old.id } }); }
    }
    // a later shipped text replaced since (role-migrate.ts SHIPPED_BEFORE, #145)
    for (const old of [...this.profiles]) {
      const fields = shippedTextFor(old);
      if (!fields) continue;
      try { this.version(old, this.behaviour({ ...fields }, old.id, false, old), 'default', 'Testo del ruolo aggiornato'); }
      catch (e) { log.warn('agents', 'role text not moved to the shipped one', { cause: errText(e), hint: 'check that roles.json and role-history.json in the app data folder are writable', data: { role: old.id } }); }
    }
  }
  private ordered(list: AgentProfile[]): AgentProfile[] { return [...list].sort((a, b) => CATALOG_IDS.indexOf(a.id) - CATALOG_IDS.indexOf(b.id)); }
  private writable(): void { const problem = this.problem ?? this.store.problem; if (problem) throw new Error(problem); }
  /** History first: a catalog never points to a version without its snapshot. */
  private commit(next: AgentProfile[], versions: AgentVersion[], states: Parameters<AgentHistory['commit']>[1] = []): void {
    if (versions.length || states.length) this.store.commit(versions, states);
    writeLocal(this.file, { format: 1, roles: next });
    this.profiles = next;
    this.d.emit?.(this.list());
  }
  private find(id: string): AgentProfile {
    const p = this.profiles.find(x => x.id === id);
    if (!p) throw new Error('Ruolo non trovato.');
    return p;
  }

  list(): AgentCatalog {
    this.rebind();
    return structuredClone({ profiles: this.profiles, models: this.d.models(), problem: this.problem ?? this.store.problem });
  }
  /** Engines, logins or models changed outside the catalog (cli:ready, a setting, an engine listing its models): the
   *  renderer gets the fresh catalog even when no role changed (issue #96). */
  refresh(): void { this.d.emit?.(this.list()); }
  /** A role still at its defaults moves to the default engine when its own became unusable (login discovery is
   *  asynchronous) or when the default is the user's chosen engine (issue #96); a role the user changed keeps its engine. */
  private rebind(): void {
    if (this.problem || this.store.problem) return;
    const models = this.d.models(), engine = this.defaultEngine(), preferred = this.preferredUsable()?.engine ?? null;
    const changed: AgentProfile[] = [];
    const next = this.profiles.map(p => {
      if (p.userLocked || p.lastEditedBy !== 'default' || p.trial || p.id === PULSE_ID || p.engine === engine) return p;
      const current = models.find(e => e.engine === p.engine);
      if (engine !== preferred && current?.enabled && current.trusted && current.installed !== false && current.authenticated !== false) return p;
      // still at its defaults: its tools follow the engine (the API engine reads only, the others get the role's defaults)
      const tools = isRoleId(p.id) ? { allow: engineOf(engine)?.kind === 'api' ? ['read' as const] : [...ROLE_DEFAULTS[p.id].tools] } : p.tools;
      const updated: AgentProfile = { ...p, engine, tools, version: p.version + 1, activeVersion: p.version + 1, updatedAt: Math.max(this.now(), p.updatedAt + 1) };
      changed.push(updated); return updated;
    });
    if (!changed.length) return;
    try {
      this.commit(next, changed.map(p => ({ ...firstVersion(p, 'default', 'Motore disponibile', p.updatedAt), version: p.version, parentVersion: this.profiles.find(o => o.id === p.id)?.activeVersion ?? null })),
        changed.map(p => ({ agentId: p.id, version: this.profiles.find(o => o.id === p.id)!.activeVersion, state: 'superseded' as const })));
    } catch (e) { log.warn('agents', 'role engine refresh failed', { cause: errText(e), hint: 'check that roles.json in the app data folder is writable' }); }
  }

  /** The editable fields of `value` (falling back to `base` for the ones it leaves out), checked. `current` also checks
   *  the engine and model against what is available now; `keep` lets an edit keep the model the role already runs with. */
  private behaviour(value: Record<string, unknown>, id: string, current: boolean, base?: Behaviour, keep = true): Behaviour {
    const p = { ...(base ?? {}), ...Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) } as Record<string, unknown>;
    const engine = text(p.engine, 60, 'Motore');
    if (!/^[a-z][a-z0-9_-]*$/.test(engine)) throw new Error('Motore non valido.');
    if (!(p.model === null || p.model === undefined || typeof p.model === 'string' && MODEL.test(p.model))) throw new Error('Modello non valido.');
    const model = (p.model ?? null) as string | null;
    if (p.effort !== undefined && p.effort !== null && !has(EFFORTS, p.effort)) throw new Error('Effort non valido.');
    if (current) {
      const e = this.d.models().find(x => x.engine === engine);
      if (!e) throw new Error('Il motore selezionato non è disponibile.');
      if (model !== null && !e.modelSelectable) throw new Error(e.modelReason ?? 'La scelta del modello non è supportata da questo motore. Usa il modello del livello.');
      // a model the role already runs with is kept as it is: only a new choice must be one the engine is known to have
      // (#128: Pulse's preset alias 'sonnet' is not in the observed list, and refused every rule its proposals added)
      const kept = keep && !!base && base.engine === engine && (base.model ?? null) === model;
      if (model !== null && !kept && !e.models.some(m => m.id === model)) throw new Error('Il modello non è tra quelli noti del motore. Aggiorna le disponibilità o usa il modello del livello.');
      if (p.effort && !e.effort) throw new Error('Questo motore non supporta la scelta dell’effort.');
    }
    // the API engine has no tools: a role on it reads only (every class allowed by default, ADR 0085, means nothing there)
    if (engineOf(engine)?.kind === 'api') p.tools = { allow: ['read'] };
    if (!(p.permissionCeiling === undefined || p.permissionCeiling === null || has(PERMISSION_CEILINGS, p.permissionCeiling))) throw new Error('Limite dei permessi non valido.');
    if (!(p.maxContext === undefined || p.maxContext === null || Number.isSafeInteger(p.maxContext) && (p.maxContext as number) >= MAX_CONTEXT_RANGE.min && (p.maxContext as number) <= MAX_CONTEXT_RANGE.max))
      throw new Error(`Contesto massimo: un numero intero di token da ${MAX_CONTEXT_RANGE.min} a ${MAX_CONTEXT_RANGE.max}, oppure vuoto (l’impostazione dell’app).`);
    if (!has(MODEL_TIERS, p.tier) || !has(MODEL_TIERS, p.tierMax) || tierRank(p.tier) > tierRank(p.tierMax)) throw new Error('Livello del modello non valido: il livello non supera il massimo.');
    // a role ADR 0100 retired, named by a stored profile or version, is dropped from the list (never an error on load)
    if (Array.isArray(p.launches)) p.launches = currentLaunches(p.launches as string[]);
    if (!Array.isArray(p.launches) || !p.launches.every(isWorkRole) || new Set(p.launches).size !== p.launches.length || (p.launches as string[]).includes(id)) throw new Error('Ruoli avviabili non validi: solo ruoli di lavoro, mai sé stesso.');
    if (id === PULSE_ID && (p.launches as unknown[]).length) throw new Error('Pulse non avvia ruoli.');
    if (id === FLASH_ID && (p.launches as unknown[]).length) throw new Error('Flash non avvia ruoli.');
    // Flash reads and answers, whatever is stored (ADR 0105, 0107): read and web tools, plan ceiling
    if (id === FLASH_ID) { p.tools = structuredClone(FLASH_TOOLS); p.permissionCeiling = 'plan'; }
    if (!Array.isArray(p.skills) || p.skills.length > 40 || !p.skills.every(packName) || new Set(p.skills).size !== p.skills.length) throw new Error('Abilità non valide: nomi di abilità del brain, al massimo 40.');
    return { instructions: text(p.instructions, 8000, 'Istruzioni', true), engine, model,
      ...(p.effort ? { effort: p.effort as Effort } : {}),
      tools: checkedTools(p.tools), permissionCeiling: (p.permissionCeiling ?? null) as PermissionCeiling | null,
      ...(p.knowhow !== undefined && p.knowhow !== null ? { knowhow: checkedKnowhow(p.knowhow) } : {}),
      ...(p.pack !== undefined && p.pack !== null ? { pack: checkedPackIdentity(p.pack) } : {}),
      ...(typeof p.maxContext === 'number' ? { maxContext: p.maxContext } : {}),
      tier: p.tier as ModelTier, tierMax: p.tierMax as ModelTier, launches: [...p.launches as string[]], skills: [...p.skills as string[]] };
  }
  /** The renderer's draft checked like a save, without saving (the editor's live check). */
  validateDraft(value: unknown, id: string): AgentDraft {
    this.writable(); const old = this.find(id);
    return { ...this.face(id), ...this.behaviour(obj(value), id, true, old) };
  }
  /** A new version when the behaviour changes; the same version otherwise. */
  private version(old: AgentProfile, next: Behaviour, author: AgentAuthor, reason: string, state: 'active' | 'trial' = 'active'): AgentProfile {
    const at = Math.max(this.now(), old.updatedAt + 1), version = old.version + 1;
    const profile: AgentProfile = { ...this.face(old.id), ...next, id: old.id, scope: old.scope, createdAt: old.createdAt, updatedAt: at, version, activeVersion: version,
      lastEditedBy: author, userLocked: author === 'default' ? false : author === 'user' ? true : old.userLocked,
      ...(state === 'trial' ? { trial: { version, baseline: old.activeVersion, startedAt: at } } : {}) };
    this.commit(this.profiles.map(p => p.id === old.id ? profile : p), [{ agentId: old.id, version, parentVersion: old.activeVersion, behaviour: behaviourOf(profile), author, reason: text(reason, 600, 'Motivo'), at, state }],
      state === 'active' ? [{ agentId: old.id, version: old.activeVersion, state: 'superseded' }] : []);
    this.knowhowChanged(old, profile);
    return structuredClone(profile);
  }

  /** The user's edit (Brain → Agenti), or the Orchestrator's on the user's ask (app_config, ADR 0149: `reason` says so
   *  in the history). */
  save(value: unknown, id: string, reason = 'Modificato dall’utente'): AgentProfile {
    this.writable();
    const old = this.find(id);
    const next = this.behaviour(obj(value), id, true, old);
    if (sameBehaviour(old, next)) return structuredClone(old);
    if (old.trial) throw new Error('C’è una prova in corso su questo ruolo: chiudila prima di cambiarne il comportamento.');
    const p = this.version(old, next, 'user', reason);
    this.d.onCustomized?.();
    return p;
  }
  /** "Ripristina predefinito": the shipped role again (its skills from packs and maintenance stay). */
  reset(id: string): AgentProfile {
    this.writable();
    const old = this.find(id);
    if (old.trial) throw new Error('C’è una prova in corso su questo ruolo: chiudila prima di ripristinarlo.');
    const next = { ...this.defaults(id), ...(old.knowhow ? { knowhow: old.knowhow } : {}), ...(old.pack ? { pack: old.pack } : {}) };
    if (sameBehaviour(old, next) && !old.userLocked) return structuredClone(old);
    return this.version(old, next, 'default', 'Ripristinato il ruolo predefinito');
  }
  history(id: string): AgentVersion[] { this.find(id); return this.store.list(id); }

  /** Ends the open trial: keep its version, or roll back to the baseline. */
  resolveTrial(id: string, decision: 'keep' | 'rollback'): AgentProfile {
    this.writable(); const p = this.find(id);
    if (!['keep', 'rollback'].includes(decision) || !p.trial) throw new Error('Nessuna prova da chiudere su questo ruolo.');
    const baseline = decision === 'rollback' ? this.store.get(id, p.trial.baseline) : undefined;
    if (decision === 'rollback' && !baseline) throw new Error('La versione di partenza non è più nella cronologia.');
    const { trial: _t, ...rest } = p; void _t;
    const profile: AgentProfile = { ...rest, ...(baseline ? this.behaviour(baseline.behaviour as unknown as Record<string, unknown>, id, false, { ...rest, knowhow: undefined, effort: undefined, maxContext: undefined }) : {}),
      activeVersion: baseline?.version ?? p.activeVersion, updatedAt: Math.max(this.now(), p.updatedAt + 1) };
    if (baseline && !baseline.behaviour.knowhow) delete profile.knowhow;
    const states: Parameters<AgentHistory['commit']>[1] = [{ agentId: id, version: p.activeVersion, state: decision === 'keep' ? 'kept' : 'rejected' }];
    if (baseline) states.push({ agentId: id, version: baseline.version, state: 'active' });
    this.commit(this.profiles.map(x => x.id === id ? profile : x), [], states);
    this.knowhowChanged(p, profile);
    return structuredClone(profile);
  }
  /** The user's approval of a queued proposal ("Da approvare": tier, tools, ceiling, engine, limits): a new version on
   *  trial against the active one, measured by the lifecycle (trials.ts) until it is kept or rolled back. Know-how and
   *  pack identity are never taken from the proposal. */
  approveTrial(id: string, value: unknown, reason: string): AgentProfile {
    this.writable();
    const old = this.find(id);
    if (old.trial) throw new Error('C’è una prova in corso su questo ruolo: chiudila prima di cambiarne il comportamento.');
    const { knowhow: _k, pack: _p, ...input } = obj(value); void _k; void _p;
    const next = { ...this.behaviour(input, id, true, old), ...(old.knowhow ? { knowhow: old.knowhow } : {}), ...(old.pack ? { pack: old.pack } : {}) };
    if (sameBehaviour(old, next)) throw new Error('La proposta non cambia il comportamento del ruolo.');
    const p = this.version(old, next, 'user', reason, 'trial');
    this.d.onCustomized?.();
    return p;
  }
  /** The user's Undo of a trial: its baseline is active again. */
  rejectTrial(id: string, baseline: number): AgentProfile {
    const p = this.find(id);
    if (!p.trial || p.trial.version !== p.activeVersion || p.trial.baseline !== baseline) throw new Error('Nessuna prova da annullare su questa versione.');
    return this.resolveTrial(id, 'rollback');
  }
  /** A maintenance job's change (ADR 0083: applied at once, logged with an Undo by brainmodel/changes.ts): only the role
   *  text (a lesson from the user's corrections or a review's finding) or its skills. Tools, permissions, engine, model
   *  tier and limits change only with the user's approval. Null when nothing changes; refused during an open trial. */
  maintain(id: string, patch: { instructions?: string; knowhow?: AgentProfile['knowhow'] }, reason: string): { profile: AgentProfile; before: number } | null {
    this.writable();
    const old = this.find(id);
    if (old.trial) throw new Error('Open trial: maintenance waits');
    if (Object.keys(patch).some(k => k !== 'instructions' && k !== 'knowhow')) throw new Error('Maintenance changes only the role text and the skills');
    const next = this.behaviour({ ...(patch.instructions !== undefined ? { instructions: patch.instructions } : {}), ...(patch.knowhow !== undefined ? { knowhow: patch.knowhow } : {}) }, id, false, old);
    if (sameBehaviour(old, next)) return null;
    return { profile: this.version(old, next, 'maintenance', reason), before: old.activeVersion };
  }
  /** Undo of a maintenance change: the version before it is active again (the user's click in a change log). */
  maintainRestore(id: string, version: number, expected: number): AgentProfile {
    const p = this.find(id);
    if (p.activeVersion !== expected) throw new Error('The role changed since: undo the newer change first');
    return this.restoreVersion(id, version, 'maintenance');
  }
  /** Makes an older version the one new runs use. The next edit records it as the parent. */
  restoreVersion(id: string, version: number, by: AgentAuthor = 'user'): AgentProfile {
    this.writable();
    const p = this.find(id);
    if (p.trial) throw new Error('C’è una prova in corso su questo ruolo: chiudila prima di cambiare versione.');
    if (!count(version) || version > p.version) throw new Error('Versione non valida.');
    if (version === p.activeVersion) return structuredClone(p);
    const entry = this.store.get(id, version);
    if (!entry) throw new Error('Questa versione non è più nella cronologia.');
    const { knowhow: _k, effort: _e, maxContext: _m, ...rest } = p; void _k; void _e; void _m;
    const profile: AgentProfile = { ...rest, ...this.behaviour(entry.behaviour as unknown as Record<string, unknown>, id, true, rest as Behaviour, false), activeVersion: version,
      updatedAt: Math.max(this.now(), p.updatedAt + 1), lastEditedBy: by, ...(by === 'user' ? { userLocked: true } : {}) };
    this.commit(this.profiles.map(x => x.id === id ? profile : x), [], [{ agentId: id, version: p.activeVersion, state: 'superseded' }, { agentId: id, version, state: 'active' }]);
    this.knowhowChanged(p, profile);
    if (by === 'user') this.d.onCustomized?.();
    return structuredClone(profile);
  }

  /** What a chat starts with. A role chat runs on the role's engine with its tier's model (a delegation may ask a tier up
   *  to tierMax); the Orchestrator keeps the session's engine and its card's model (when on that engine), else the
   *  session's; Flash runs on its card's engine and model; a chat without a role is plain. */
  resolve(req: NewChat): ResolvedRole {
    if (req.orchestrator) {
      const p = this.profiles.find(x => x.id === 'orchestrator');
      // its card's model when the card is on this engine (ADR 0107: the Orchestrator and Flash each have their own)
      if (p?.model && p.engine === req.harness) req = { ...req, model: p.model };
      return { request: req, owner: orchestratorOwner(req.harness, req.model ?? null, p), instructions: p?.instructions ?? ROLE_DEFAULTS.orchestrator.instructions,
        policy: p && (p.tools || p.permissionCeiling) ? { tools: p.tools ? structuredClone(p.tools) : null, ceiling: p.permissionCeiling } : null,
        skills: [], launches: p?.launches ?? [...ROLE_DEFAULTS.orchestrator.launches] };
    }
    // Flash (ADR 0107): its card's engine and model (else its tier's), its instructions; a plain owner (no run, no role
    // gate); ChatManager adds the fixed read-only frame and policy
    if (req.quick) {
      const p = this.profiles.find(x => x.id === FLASH_ID);
      if (!p) return { request: req, owner: plainOwner(req.harness, req.model ?? null), instructions: '', policy: null, skills: [], launches: [] };
      const model = p.model ?? this.d.tierModel?.(p.engine, p.tier) ?? null;
      const { model: _m, effort: _e, ...rest } = req; void _m; void _e;
      return { request: { ...rest, harness: p.engine, ...(model ? { model } : {}), ...(p.effort ? { effort: p.effort } : {}) }, owner: { ...plainOwner(p.engine, model), name: p.name },
        instructions: p.instructions, policy: { tools: structuredClone(FLASH_TOOLS), ceiling: 'plan' }, skills: [], launches: [] };
    }
    if (req.roleId === undefined) return { request: req, owner: plainOwner(req.harness, req.model ?? null), instructions: '', policy: null, skills: [], launches: [] };
    if (req.roleId === 'orchestrator') throw new Error('L’Orchestrator è il coordinatore: apri la sua chat, non una chat di lavoro.');
    if (isRetiredRoleId(req.roleId)) throw new Error(`Il ruolo ${String(req.roleId)} non c’è più (ADR 0100): il suo lavoro lo fa ${roleName(req.roleId)}. I ruoli: ${ROLE_IDS.filter(r => r !== 'orchestrator').join(', ')}.`);
    if (!isWorkRole(req.roleId)) throw new Error(`Ruolo sconosciuto: ${String(req.roleId)}. I ruoli: ${ROLE_IDS.filter(r => r !== 'orchestrator').join(', ')}.`);
    const p = this.find(req.roleId);
    if (req.roleVersion !== undefined && req.roleVersion !== p.activeVersion) throw new Error('Il ruolo è cambiato: rileggilo prima di avviarlo.');
    // known availability again at launch, never falling back to another engine or model
    this.behaviour({}, p.id, true, p, false);
    const e = this.d.models().find(x => x.engine === p.engine)!;
    if (!e.enabled || !e.trusted) throw new Error(`Il motore di ${p.name} è spento o va riconfermato nelle Impostazioni.`);
    if (req.tier !== undefined && (!has(MODEL_TIERS, req.tier) || tierRank(req.tier) > tierRank(p.tierMax))) throw new Error(`${p.name} arriva al massimo al livello ${p.tierMax}.`);
    const tier = cappedTier(req.tier ?? p.tier, p.tierMax);
    // the role's own model; else the routing table's row on its engine (unless the launch asked a tier); else its tier's
    // model. A review's independence is its clean session (it never sees its parent's reasoning), never another model
    // (ADR 0091)
    const row = p.model === null && req.tier === undefined ? this.d.tableModel?.(p.engine, req) ?? null : null;
    const picked = { model: p.model ?? row?.model ?? this.d.tierModel?.(p.engine, tier) ?? null };
    const effort = p.effort ?? row?.effort ?? req.effort;
    const { model: _m, effort: _e, ...rest } = req; void _m; void _e;
    const r = ROLE_DEFAULTS[p.id as RoleId];
    const instructions = `${ROLE_PREAMBLE}\n\nRole: ${p.name}.\n${p.instructions}\nOutput: ${r.output}`;
    return { request: { ...rest, harness: p.engine, ...(picked.model ? { model: picked.model } : {}), ...(effort ? { effort } : {}) }, owner: { ...ownerOf(p), model: picked.model },
      instructions, policy: p.tools || p.permissionCeiling ? { tools: p.tools ? structuredClone(p.tools) : null, ceiling: p.permissionCeiling } : null,
      ...(typeof p.maxContext === 'number' ? { maxContext: p.maxContext } : {}), skills: [...p.skills, ...(p.knowhow?.linked ?? [])].filter((s, i, a) => a.indexOf(s) === i), launches: [...p.launches],
      ...(row ? { modelFrom: 'table' as const } : {}), tier };
  }
}
