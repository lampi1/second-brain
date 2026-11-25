// The role catalog: the Orchestrator and the five work roles (shared/roles.ts), kept in
// <userData>/roles.json with every behaviour change as a version (role-history.json). The user edits a role's tools,
// ceiling, engine, model and presets, launches, skills and instructions (Brain → Agenti); "Ripristina predefinito" goes back to
// the shipped role. No role is ever created or removed by the user; a retired role's stored entry (Router, Judge, Scribe,
// ADR 0100) is left out on load and a launches list naming one drops it, so an older roles.json still loads. resolve() turns a role id into what a chat starts with: engine,
// model (the card's or the preset's; a card with none takes the brain registry's), the composed instructions, the tool policy. Used by ChatManager, the IPC
// handlers (index.ts), the packs (pack/flows.ts) and the maintenance jobs (brainmodel/).
import type { AgentContextSnapshot } from '../../shared/agent-context';
import path from 'node:path';
import { checkedKnowhow, checkedPackIdentity, packName } from '../../shared/agent-pack';
import type { Effort, Harness, NewChat } from '../../shared/contract';
import { BEHAVIOUR_FIELDS, MAX_CONTEXT_RANGE, PERMISSION_CEILINGS, effortOn, type AgentAuthor, type AgentCatalog, type AgentDraft, type AgentModelChoice, type AgentOwnerSnapshot, type AgentProfile, type AgentVersion, type EngineChoice, type PermissionCeiling } from '../../shared/agents';
import { MODEL_TIERS, ROLE_DEFAULTS, ROLE_IDS, currentLaunches, currentRoleId, isDelegatorRole, isRetiredRoleId, isRoleId, isWorkRole, roleName, rolePreamble, tierRank, type ModelTier, type RoleId } from '../../shared/roles';
import { characterOf, isCharacterId } from '../../shared/characters';
import { readLocal, writeLocal } from './local-store';
import { AgentHistory, behaviourOf, firstVersion, sameBehaviour, versionedChanges } from './versions';
import { checkedTools, type AgentPolicy } from './tool-policy';
import { CARD_MODEL, PRESET_IDS, type PresetId, cardPresets, checkedPresets, choosePreset, presetAskOf, presetOrderProblem, type Delegator, type FullPresets, type PresetAsk, type PresetChoice, type RolePresets, type UnitPrice } from '../../shared/model-presets';
import { checkedLevels, headPresets, levelNamed, levelsOf, pickInLevel, type FullLevels, type LevelModel, type RoleLevels, type Room, type SkipNote } from '../../shared/model-levels';
import { randomUUID } from 'node:crypto';
import { fiveRolesTextFor, fullDefaultsFor, shippedTextFor, skillAlignmentFor } from './role-migrate';
import { engineOf } from '../engines/registry';
import { log, errText } from '../log';

const MODEL = CARD_MODEL;
const ID = /^[a-z][a-z0-9_-]{0,79}$/;
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const AUTHORS: readonly AgentAuthor[] = ['default', 'user', 'maintenance'];
const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const count = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 1;
const has = <T>(list: readonly T[], v: unknown): v is T => (list as readonly unknown[]).includes(v);
// a stored entry this build does not know (a retired one) is left out on load
const CATALOG_IDS: readonly string[] = [...ROLE_IDS];

function text(v: unknown, max: number, label: string, empty = false): string {
  if (typeof v !== 'string' || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v) || (!empty && !v.trim())) throw new Error(`${label}: testo ${empty ? 'fino a' : 'da 1 a'} ${max} caratteri.`);
  return v.trim();
}

/** A stored card's parked choices (AgentProfile.parked): one out of shape is left out, never an error on load. */
function parkedOf(v: unknown): Record<string, EngineChoice> | undefined {
  const out: Record<string, EngineChoice> = {};
  for (const [engine, value] of Object.entries(obj(v))) {
    const c = obj(value);
    if (!ID.test(engine) || !(c.model === null || typeof c.model === 'string' && MODEL.test(c.model)) || !(c.effort === undefined || has(EFFORTS, c.effort))) continue;
    try {
      const presets = checkedPresets(c.presets);
      out[engine] = { model: c.model, ...(c.effort ? { effort: c.effort } : {}), ...(presets ? { presets } : {}), ...(c.fast === true ? { fast: true } : {}) };
    } catch { /* out of shape: left out */ }
  }
  return Object.keys(out).length ? out : undefined;
}

export interface AgentCatalogDeps {
  userData: string;
  models: () => AgentModelChoice[];
  /** the engine the user chose at setup (Settings.orchestratorChats.harness): untouched roles follow it while it is usable */
  preferredEngine?: () => string | null;
  /** the model a card's internal tier means on an engine (agents/model-tier.ts with the registry): the Base of a card
   *  with no model of its own; null = the engine's own default */
  tierModel?: (engine: Harness, tier: ModelTier) => string | null;
  /** one price per token of a model (input + output, the one price table): the presets' order on save and the ceiling of
   *  a delegation (ADR 0336); absent = neither is checked */
  price?: UnitPrice;
  /** how much an engine's plan has left now (ADR 0347: the usage panel and the credit book); absent = unknown */
  room?: (engine: Harness, model: string | null, asker?: string) => Room;
  /** a chat starts on (engine, model) whose plan is on probation: this chat is its one try (ADR 0354) */
  claim?: (engine: Harness, model: string | null, owner: string) => void;
  /** why a role chat may not start on an engine now (off, the Orchestrators may not use it); null = it may */
  engineBlock?: (engine: Harness) => string | null;
  emit?: (catalog: AgentCatalog) => void;
  now?: () => number;
  onCustomized?: () => void;
}
/** How a launch reads the levels: `asker` = the chat that asks (its own probe counts as free), `skip` = engine:model keys
 *  a move already failed on, `holdLevel` = no delegator's ceiling (a chat that moves keeps its level), `claim` = this resolve
 *  starts the chat (ChatManager.create's resolveAgent, a credit move): a pool on probation is its one try. */
export interface ResolveOptions { asker?: string; skip?: readonly string[]; holdLevel?: boolean; claim?: boolean }
/** What a role's card gives a chat of that role now, for a preset (credit-wait.ts): its pick and why. */
export interface CardPick { engine: Harness; model: string | null; effort: Effort | null; preset: PresetId; allOut: boolean; skipped: SkipNote[]; route: string; rooms: NonNullable<PresetChoice['rooms']> }
/** What a chat starts with: the request with the role's engine, model and effort, its owner snapshot, the composed
 *  instructions and the tool policy; skills = the role's default skills; launches = the roles it may delegate to. */
export interface ResolvedRole {
  launchContext?: AgentContextSnapshot;
  request: NewChat; owner: AgentOwnerSnapshot; instructions: string; policy: AgentPolicy | null;
  maxContext?: number; skills: string[]; launches: string[];
  /** the model tier a role chat runs on */
  tier?: ModelTier;
  /** the preset it runs on and what chose it (ADR 0336): the run's record and the delegator's warnings */
  presetChoice?: PresetChoice;
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
type Behaviour = Pick<AgentProfile, 'instructions' | 'engine' | 'model' | 'effort' | 'tools' | 'permissionCeiling' | 'knowhow' | 'pack' | 'maxContext' | 'tier' | 'tierMax' | 'presets' | 'levels' | 'codeMode' | 'fast' | 'launches' | 'skills'>;

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
    this.allowAll();
  }

  private now(): number { return this.d.now?.() ?? Date.now(); }
  /** Entries this build knows, each valid on its own; an unknown id is left out (a newer build wrote it, or it is a role
   *  ADR 0100 retired: its successor is a role of its own). */
  private read(rows: unknown[]): AgentProfile[] {
    const out: AgentProfile[] = [];
    for (const value of rows) {
      const p = obj(value);
      if (typeof p.id !== 'string' || !CATALOG_IDS.includes(p.id) || out.some(x => x.id === p.id)) continue;
      const trial = p.trial === undefined ? undefined : obj(p.trial), parked = parkedOf(p.parked);
      if (typeof p.createdAt !== 'number' || !Number.isFinite(p.createdAt) || typeof p.updatedAt !== 'number' || !Number.isFinite(p.updatedAt)
        || !count(p.version) || !count(p.activeVersion) || p.activeVersion > p.version || !has(AUTHORS, p.lastEditedBy) || typeof p.userLocked !== 'boolean'
        || (trial && (!count(trial.version) || trial.version > p.version || !count(trial.baseline) || trial.baseline > p.version || typeof trial.startedAt !== 'number'))) throw new Error('Versione del ruolo non valida.');
      out.push({ ...this.face(p.id), ...this.behaviour(p, p.id, false), id: p.id, scope: 'role',
        createdAt: p.createdAt, updatedAt: p.updatedAt, version: p.version, activeVersion: p.activeVersion,
        ...(trial ? { trial: { version: trial.version as number, baseline: trial.baseline as number, startedAt: trial.startedAt as number } } : {}),
        ...(parked ? { parked } : {}), lastEditedBy: p.lastEditedBy, userLocked: p.userLocked });
    }
    return out;
  }
  /** The fixed part of an entry: name, purpose and character. */
  private face(id: string): Pick<AgentProfile, 'name' | 'purpose' | 'avatar'> {
    if (isRoleId(id)) { const r = ROLE_DEFAULTS[id]; return { name: r.name, purpose: r.summary, avatar: { kind: 'character', value: id } }; }
    throw new Error('Ruolo non trovato.');
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
    const r = ROLE_DEFAULTS[id as RoleId], engine = this.defaultEngine();
    return { instructions: r.instructions, engine, model: null, tools: { allow: engineOf(engine)?.kind === 'api' ? ['read'] : [...r.tools] }, permissionCeiling: r.ceiling,
      tier: r.tier, tierMax: r.tierMax, launches: [...r.launches], skills: [...r.skills] };
  }
  /** Every role is always there: a missing entry is added with its defaults (never overwriting one). */
  private seed(): void {
    const missing = CATALOG_IDS.filter(id => !this.profiles.some(p => p.id === id));
    if (!missing.length) return;
    const at = this.now();
    const added = missing.map(id => ({ ...this.face(id), ...this.defaults(id), id, scope: 'role' as const,
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
      try { this.version(old, this.behaviour({ ...fields }, old.id, false, old), 'default', 'Permessi completi predefiniti (ADR 0085)', 'active', true); }
      catch (e) { log.warn('agents', 'role not moved to full permissions', { cause: errText(e), hint: 'check that roles.json and role-history.json in the app data folder are writable', data: { role: old.id } }); }
    }
    // ADR 0100: a role the user never edited whose text still names Router, Judge or Scribe gets today's text
    for (const old of [...this.profiles]) {
      const fields = fiveRolesTextFor(old);
      if (!fields) continue;
      try { this.version(old, this.behaviour({ ...fields }, old.id, false, old), 'default', 'Cinque ruoli di lavoro (ADR 0100)', 'active', true); }
      catch (e) { log.warn('agents', 'role text not moved to the five work roles', { cause: errText(e), hint: 'check that roles.json and role-history.json in the app data folder are writable', data: { role: old.id } }); }
    }
    // a later shipped text replaced since (role-migrate.ts SHIPPED_BEFORE, #145)
    for (const old of [...this.profiles]) {
      const shipped = shippedTextFor(old), aligned = skillAlignmentFor(old);
      const fields = shipped || aligned ? { ...shipped, ...aligned } : null;
      if (!fields) continue;
      try { this.version(old, this.behaviour({ ...fields }, old.id, false, old), 'default', 'Istruzioni e skill del ruolo aggiornate', 'active', true); }
      catch (e) { log.warn('agents', 'role text not moved to the shipped one', { cause: errText(e), hint: 'check that roles.json and role-history.json in the app data folder are writable', data: { role: old.id } }); }
    }
  }
  /** Every role may do everything (ADR 0347): a role the user once narrowed reads with every tool and no ceiling (in
   *  memory: the file follows at its next save). The API engine keeps its read-only limit (it has no tools). */
  private allowAll(): void {
    this.profiles = this.profiles.map(p => !isRoleId(p.id) ? p
      : { ...p, tools: engineOf(p.engine)?.kind === 'api' ? { allow: ['read'] } : { allow: [...ROLE_DEFAULTS[p.id].tools] }, permissionCeiling: null });
  }
  private ordered(list: AgentProfile[]): AgentProfile[] { return [...list].sort((a, b) => CATALOG_IDS.indexOf(a.id) - CATALOG_IDS.indexOf(b.id)); }
  private writable(): void { const problem = this.problem ?? this.store.problem; if (problem) throw new Error(problem); }
  /** History first: a catalog never points to a version without its snapshot. */
  private commit(next: AgentProfile[], versions: AgentVersion[], states: Parameters<AgentHistory['commit']>[1] = [], amends: Parameters<AgentHistory['commit']>[2] = []): void {
    if (versions.length || states.length || amends.length) this.store.commit(versions, states, amends);
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
  /** The one-off move of the retired model Settings onto the cards (agents/legacy-cards.ts): in place, like an engine
   *  rebind (no new version: the role runs what it ran). A card the next start could not read (read()) keeps its old
   *  values. Returns the roles it changed; throws when it cannot write. */
  migrateLegacy(changed: (profiles: readonly AgentProfile[]) => AgentProfile[]): string[] {
    this.writable();
    const updated = changed(this.profiles).filter(p => {
      try { this.behaviour(p as unknown as Record<string, unknown>, p.id, false); return true; }
      catch (e) { log.warn('agents', 'model settings not moved onto a role card', { cause: errText(e), hint: 'the card keeps its values: choose its model in Agenti', data: { role: p.id } }); return false; }
    }).map(p => ({ ...p, updatedAt: Math.max(this.now(), p.updatedAt + 1) }));
    if (!updated.length) return [];
    const byId = new Map(updated.map(p => [p.id, p]));
    this.commit(this.profiles.map(p => byId.get(p.id) ?? p), [], [], updated.map(p => ({ agentId: p.id, version: p.activeVersion, behaviour: behaviourOf(p), at: p.updatedAt, by: 'default' as const, reason: 'Impostazioni dei modelli spostate sulla scheda' })));
    return updated.map(p => p.id);
  }
  /** A role card's launch switches (Code Mode, ADR 0331; Cursor's fast): read by the chat manager at every engine start.
   *  An unknown id (no role, a retired one) = both off; the Orchestrator never runs in Code Mode. */
  launchFlags(id: string | undefined): { codeMode: boolean; fast: boolean } {
    const p = id ? this.profiles.find(x => x.id === id) : undefined;
    return { codeMode: p?.codeMode === true && p.id !== 'orchestrator', fast: p?.fast === true };
  }
  /** A role still at its defaults moves to the default engine when its own became unusable (login discovery is
   *  asynchronous) or when the default is the user's chosen engine (issue #96); a role the user changed keeps its engine. */
  private rebind(): void {
    if (this.problem || this.store.problem) return;
    const models = this.d.models(), engine = this.defaultEngine(), preferred = this.preferredUsable()?.engine ?? null;
    const changed: AgentProfile[] = [];
    const next = this.profiles.map(p => {
      if (p.userLocked || p.lastEditedBy !== 'default' || p.trial || p.engine === engine) return p;
      const current = models.find(e => e.engine === p.engine);
      if (engine !== preferred && current?.enabled && current.trusted && current.installed !== false && current.authenticated !== false) return p;
      // still at its defaults: its tools follow the engine (the API engine reads only, the others get the role's defaults)
      const tools = isRoleId(p.id) ? { allow: engineOf(engine)?.kind === 'api' ? ['read' as const] : [...ROLE_DEFAULTS[p.id].tools] } : p.tools;
      // in place (ADR 0186): an engine the app rebinds is not a change the role made, so no new version
      // model, effort, presets and fast belong to the engine it leaves (the new one would refuse them at launch): parked
      // with that engine, and what was parked for the new one comes back
      const { model, effort, presets, fast, parked, ...rest } = p, { [engine]: back, ...others } = parked ?? {};
      const left = { ...others, ...(model !== null || effort || presets || fast ? { [p.engine]: { model, ...(effort ? { effort } : {}), ...(presets ? { presets } : {}), ...(fast ? { fast } : {}) } } : {}) };
      const updated: AgentProfile = { ...rest, model: null, ...back, ...(Object.keys(left).length ? { parked: left } : {}), engine, tools, updatedAt: Math.max(this.now(), p.updatedAt + 1) };
      changed.push(updated); return updated;
    });
    if (!changed.length) return;
    try {
      this.commit(next, [], [], changed.map(p => ({ agentId: p.id, version: p.activeVersion, behaviour: behaviourOf(p), at: p.updatedAt, by: 'default' as const, reason: 'Motore disponibile' })));
      log.info('agents', 'role engine rebound in place', { data: { roles: changed.map(p => `${p.id}@${p.activeVersion}`).join(', '), engine } });
    } catch (e) { log.warn('agents', 'role engine refresh failed', { cause: errText(e), hint: 'check that roles.json in the app data folder is writable' }); }
  }

  /** The editable fields of `value` (falling back to `base` for the ones it leaves out), checked. `current` also checks
   *  the engine and model against what is available now; `keep` lets an edit keep the model the role already runs with. */
  private behaviour(value: Record<string, unknown>, id: string, current: boolean, base?: Behaviour, keep = true): Behaviour {
    const p = { ...(base ?? {}), ...Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) } as Record<string, unknown>;
    let levels = checkedLevels(p.levels);
    if (levels && value.levels !== undefined) {
      // the lists are what the user edits (ADR 0347): the card's engine, model, effort and presets follow their heads,
      // so every reader of the card's own model (the map's «previsto», app_config, the strips) still reads the first
      const b = levels.base?.[0];
      if (b) { p.engine = b.engine; p.model = b.model; if (b.effort) p.effort = b.effort; else delete p.effort; }
      const head = (id: 'min' | 'max') => { const x = levels![id]?.[0]; return x && x.model && x.engine === p.engine ? { model: x.model, ...(x.effort ? { effort: x.effort } : {}) } : undefined; };
      const min = head('min'), max = head('max');
      p.presets = min || max ? { ...(min ? { min } : {}), ...(max ? { max } : {}) } : undefined;
    }
    // a change of the card's own model or presets without lists (app_config, an older editor) moves the heads of the
    // lists with it; done once the engine's fallbacks below have settled the model and effort (a new engine drops the
    // old engine's model, it is never carried into the list)
    const followHeads = !!levels && !!base && value.levels === undefined && (value.engine !== undefined || value.model !== undefined || value.effort !== undefined || value.presets !== undefined);
    let headsMoved = false;
    const moveHeads = (engine: string, model: string | null, presets: RolePresets | undefined) => {
      if (!followHeads || headsMoved || !levels) return;
      headsMoved = true;
      const put = (list: LevelModel[] | undefined, x: LevelModel) => [x, ...(list ?? []).filter((y, i) => i > 0 && (y.engine !== x.engine || y.model !== x.model))];
      const next: RoleLevels = { ...levels };
      if (value.engine !== undefined || value.model !== undefined || value.effort !== undefined)
        next.base = put(levels.base, { engine, model, ...(typeof p.effort === 'string' ? { effort: p.effort as Effort } : {}) });
      for (const id of ['min', 'max'] as const) {
        const now = presets?.[id], was = (base!.presets as RolePresets | undefined)?.[id];
        if (value.presets !== undefined && now && JSON.stringify(now) !== JSON.stringify(was ?? null) && next[id]?.length)
          next[id] = put(next[id], { engine, model: now.model, ...(now.effort ? { effort: now.effort } : {}) });
      }
      levels = next;
    };
    const engine = text(p.engine, 60, 'Motore');
    if (!/^[a-z][a-z0-9_-]*$/.test(engine)) throw new Error('Motore non valido.');
    if (!(p.model === null || p.model === undefined || typeof p.model === 'string' && MODEL.test(p.model))) throw new Error('Modello non valido.');
    let model = (p.model ?? null) as string | null;
    if (p.effort !== undefined && p.effort !== null && !has(EFFORTS, p.effort)) throw new Error('Effort non valido.');
    let presets = checkedPresets(p.presets);
    if (current) {
      const e = this.d.models().find(x => x.engine === engine);
      if (!e) throw new Error('Il motore selezionato non è disponibile.');
      // a new engine with the old engine's model or effort carried along unchanged (an edit that only sets the engine):
      // what the new engine does not know falls back to the level's model / no effort, never a refusal that leaves the
      // role stuck on its old engine (owner, 2026-11-01: opencode → cursor refused whatever the model)
      if (base && base.engine !== engine) {
        if (model !== null && model === (base.model ?? null) && !(e.modelSelectable && e.models.some(m => m.id === model))) { model = null; p.model = null; }
        if (p.effort && p.effort === base.effort && !e.effort) delete p.effort;
      }
      if (model !== null && !e.modelSelectable) throw new Error(e.modelReason ?? 'La scelta del modello non è supportata da questo motore. Usa il modello del livello.');
      // a model the role already runs with is kept as it is: only a new choice must be one the engine is known to have
      // (#128: a preset alias such as 'sonnet' is not in the observed list)
      const kept = keep && !!base && base.engine === engine && (base.model ?? null) === model;
      // the known ids go in the refusal: an agent setting a role without them retried blind (20 times, #327)
      if (model !== null && !kept && !e.models.some(m => m.id === model)) {
        const ids = e.models.map(m => m.id), shown = ids.slice(0, 30).join(', ') + (ids.length > 30 ? ', …' : '');
        throw new Error(`Il modello «${model}» non è tra quelli noti del motore ${engine}. ${ids.length ? `Modelli noti: ${shown}.` : 'Nessun modello noto.'} Usa uno di questi, oppure nessun modello (quello del livello).`);
      }
      if (p.effort && !e.effort) throw new Error('Questo motore non supporta la scelta dell’effort.');
      // the presets live on the card's one engine (ADR 0336): carried along unchanged to another engine they are dropped
      // (the card goes back to its Base only), a new or changed one must be a model that engine is known to have
      if (presets && base && base.engine !== engine && JSON.stringify(presets) === JSON.stringify(base.presets ?? null)) presets = undefined;
      for (const [id, x] of Object.entries(presets ?? {}) as [string, { model: string | null; effort?: Effort }][]) {
        if (!e.modelSelectable) throw new Error(e.modelReason ?? 'Questo motore non applica una scelta di modello: niente preset Minimo o Massimo.');
        const was = base && base.engine === engine ? (base.presets as RolePresets | undefined)?.[id as 'min' | 'max'] : undefined;
        if (!(keep && was?.model === x.model) && !e.models.some(m => m.id === x.model)) throw new Error(`Preset ${id === 'min' ? 'Minimo' : 'Massimo'}: il modello «${x.model}» non è tra quelli noti del motore ${engine}.`);
        if (x.effort && !e.effort) throw new Error('Questo motore non supporta la scelta dell’effort.');
      }
      moveHeads(engine, model, presets);
      // on a save (not at launch): Minimo <= Base <= Massimo by price, when the prices are known
      const problem = presets && this.d.price && Object.keys(value).length ? presetOrderProblem(cardPresets({ model, ...(p.effort ? { effort: p.effort as Effort } : {}), presets }, this.d.tierModel?.(engine, p.tier as ModelTier) ?? null), this.d.price) : null;
      if (problem) throw new Error(problem);
      // each model of the lists (ADR 0347) on a save: a known engine, and a model it is known to have (one already on
      // the card is kept as it is, #128); at launch the pick skips what is not usable instead
      if (levels && Object.keys(value).length) {
        // what the card already ran with: its lists, else its own model and presets on its engine (an alias such as
        // 'sonnet', a model from the legacy migration)
        const was = base ? levelsOf(base, cardPresets(base, this.d.tierModel?.(base.engine, base.tier) ?? null)) : null;
        const had = new Set(was ? PRESET_IDS.flatMap(id => was[id]).map(x => `${x.engine}\u0000${x.model ?? ''}`) : []);
        for (const [id, list] of Object.entries(levels) as [PresetId, LevelModel[]][]) for (const x of list) {
          const en = this.d.models().find(m => m.engine === x.engine);
          const where = `${id === 'min' ? 'Minimo' : id === 'max' ? 'Massimo' : 'Base'}`;
          if (!en) throw new Error(`${where}: il motore ${x.engine} non è disponibile.`);
          if (x.model !== null && !en.modelSelectable) throw new Error(`${where}: ${en.modelReason ?? `${en.label} non applica una scelta di modello.`}`);
          if (x.model !== null && !(keep && had.has(`${x.engine}\u0000${x.model}`)) && !en.models.some(m => m.id === x.model)) throw new Error(`${where}: il modello «${x.model}» non è tra quelli noti di ${en.label}.`);
          if (x.effort && !en.effort) throw new Error(`${where}: ${en.label} non supporta la scelta dell’effort.`);
          // the effort levels a model is known to take (its engine's list or the registry's row, #468), as the page offers them
          const takes = x.model !== null && x.effort && !had.has(`${x.engine}\u0000${x.model}`) ? en.models.find(m => m.id === x.model)?.efforts : undefined;
          if (takes && x.effort && !takes.includes(x.effort)) throw new Error(`${where}: ${x.model} su ${en.label} non prende l’effort ${x.effort} (prende: ${takes.join(', ') || 'nessuno'}).`);
        }
      }
    }
    moveHeads(engine, model, presets);
    // every role may do everything (owner, 2026-11-24: «i permessi degli agenti toglili, voglio tutto concesso sempre»,
    // ADR 0347): the stored tools and ceiling go back to the role's defaults (every class, no ceiling) on a save; on load
    // allowAll() does it in memory, after the migrations that read the stored values
    if (current && isRoleId(id)) { p.tools = { allow: [...ROLE_DEFAULTS[id].tools] }; p.permissionCeiling = null; }
    // the API engine has no tools: a role on it reads only (every class allowed by default, ADR 0085, means nothing there)
    if (engineOf(engine)?.kind === 'api') p.tools = { allow: ['read'] };
    if (!(p.permissionCeiling === undefined || p.permissionCeiling === null || has(PERMISSION_CEILINGS, p.permissionCeiling))) throw new Error('Limite dei permessi non valido.');
    if (!(p.maxContext === undefined || p.maxContext === null || Number.isSafeInteger(p.maxContext) && (p.maxContext as number) >= MAX_CONTEXT_RANGE.min && (p.maxContext as number) <= MAX_CONTEXT_RANGE.max))
      throw new Error(`Contesto massimo: un numero intero di token da ${MAX_CONTEXT_RANGE.min} a ${MAX_CONTEXT_RANGE.max}, oppure vuoto (l’impostazione dell’app).`);
    if (!has(MODEL_TIERS, p.tier) || !has(MODEL_TIERS, p.tierMax) || tierRank(p.tier) > tierRank(p.tierMax)) throw new Error('Livello del modello non valido: il livello non supera il massimo.');
    if (!(p.codeMode === undefined || p.codeMode === null || typeof p.codeMode === 'boolean')) throw new Error('Code Mode: sì o no.');
    if (!(p.fast === undefined || p.fast === null || typeof p.fast === 'boolean')) throw new Error('Fast: sì o no.');
    // never the Orchestrator (ADR 0331: it delegates, it does not run code)
    if (p.codeMode === true && id === 'orchestrator') throw new Error('Code Mode non vale per l’Orchestrator: delega il lavoro, non esegue codice.');
    // a role ADR 0100 retired, named by a stored profile or version, is dropped from the list (never an error on load)
    if (Array.isArray(p.launches)) p.launches = currentLaunches(p.launches as string[]);
    // only the Orchestrator and the Strategist delegate (2026-11-23): another role's launches are always empty, so a
    // stale roles.json, an old version restored or a draft from an older editor never gives one children
    if (!isDelegatorRole(id)) p.launches = [];
    if (!Array.isArray(p.launches) || !p.launches.every(isWorkRole) || new Set(p.launches).size !== p.launches.length || (p.launches as string[]).includes(id)) throw new Error('Ruoli avviabili non validi: solo ruoli di lavoro, mai sé stesso.');
    if (!Array.isArray(p.skills) || p.skills.length > 40 || !p.skills.every(packName) || new Set(p.skills).size !== p.skills.length) throw new Error('Abilità non valide: nomi di abilità del brain, al massimo 40.');
    return { instructions: text(p.instructions, 8000, 'Istruzioni', true), engine, model,
      ...(p.effort ? { effort: p.effort as Effort } : {}),
      tools: checkedTools(p.tools), permissionCeiling: (p.permissionCeiling ?? null) as PermissionCeiling | null,
      ...(p.knowhow !== undefined && p.knowhow !== null ? { knowhow: checkedKnowhow(p.knowhow) } : {}),
      ...(p.pack !== undefined && p.pack !== null ? { pack: checkedPackIdentity(p.pack) } : {}),
      ...(typeof p.maxContext === 'number' ? { maxContext: p.maxContext } : {}),
      tier: p.tier as ModelTier, tierMax: p.tierMax as ModelTier, ...(presets ? { presets } : {}), ...(levels ? { levels } : {}),
      ...(p.codeMode === true ? { codeMode: true } : {}), ...(p.fast === true ? { fast: true } : {}), launches: [...p.launches as string[]], skills: [...p.skills as string[]] };
  }
  /** The renderer's draft checked like a save, without saving (the editor's live check). */
  validateDraft(value: unknown, id: string): AgentDraft {
    this.writable(); const old = this.find(id);
    return { ...this.face(id), ...this.behaviour(obj(value), id, true, old) };
  }
  /** A new version when the role's text or skills change (ADR 0186, 0284), recording which; any other change, and
   *  every migration (`migration`), updates the active version in place: its number, and so its run statistics, stay. */
  private version(old: AgentProfile, next: Behaviour, author: AgentAuthor, reason: string, state: 'active' | 'trial' = 'active', migration = false): AgentProfile {
    const at = Math.max(this.now(), old.updatedAt + 1), changed = migration ? [] : versionedChanges(old, next);
    // a trial always compares two versions, whatever it changes (its rollback restores the baseline as a whole)
    const inPlace = !changed.length && state !== 'trial';
    const who = { lastEditedBy: author, userLocked: author === 'default' ? false : author === 'user' ? true : old.userLocked };
    if (inPlace) {
      // the profile's other fields stay; its behaviour is `next` as a whole (a field `next` leaves out is gone, as in a new version)
      const rest = Object.fromEntries(Object.entries(old).filter(([k]) => !(BEHAVIOUR_FIELDS as readonly string[]).includes(k)));
      const profile = { ...rest, ...next, ...who, updatedAt: at } as AgentProfile;
      this.commit(this.profiles.map(p => p.id === old.id ? profile : p), [], [], [{ agentId: old.id, version: old.activeVersion, behaviour: behaviourOf(profile), at, by: author, reason: text(reason, 600, 'Motivo') }]);
      this.knowhowChanged(old, profile);
      return structuredClone(profile);
    }
    const version = old.version + 1;
    // a trial of a model or a tier alone is still a version (it is compared with its baseline): it keeps those names
    if (!changed.length && state === 'trial') changed.push(...(old.engine !== next.engine || (old.model ?? null) !== (next.model ?? null) || old.effort !== next.effort || JSON.stringify(old.presets ?? null) !== JSON.stringify(next.presets ?? null) ? ['model' as const] : []), ...(old.tier !== next.tier || old.tierMax !== next.tierMax ? ['tier' as const] : []));
    const profile: AgentProfile = { ...this.face(old.id), ...next, id: old.id, scope: old.scope, createdAt: old.createdAt, updatedAt: at, version, activeVersion: version, ...who,
      ...(state === 'trial' ? { trial: { version, baseline: old.activeVersion, startedAt: at } } : {}) };
    this.commit(this.profiles.map(p => p.id === old.id ? profile : p), [{ agentId: old.id, version, parentVersion: old.activeVersion, behaviour: behaviourOf(profile), author, reason: text(reason, 600, 'Motivo'), at, state, changed }],
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
  /** "Ripristina predefinito": the shipped role again (its skills from packs and maintenance stay), with nothing parked
   *  for an engine it left. */
  reset(id: string): AgentProfile {
    this.writable();
    const { parked, ...old } = this.find(id);
    if (old.trial) throw new Error('C’è una prova in corso su questo ruolo: chiudila prima di ripristinarlo.');
    const next = { ...this.defaults(id), ...(old.knowhow ? { knowhow: old.knowhow } : {}), ...(old.pack ? { pack: old.pack } : {}) };
    if (sameBehaviour(old, next) && !old.userLocked && !parked) return structuredClone(old);
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
    const profile: AgentProfile = { ...rest, ...(baseline ? this.behaviour(baseline.behaviour as unknown as Record<string, unknown>, id, false, { ...rest, knowhow: undefined, effort: undefined, maxContext: undefined, presets: undefined, codeMode: undefined, fast: undefined }) : {}),
      activeVersion: baseline?.version ?? p.activeVersion, updatedAt: Math.max(this.now(), p.updatedAt + 1) };
    if (baseline && !baseline.behaviour.knowhow) delete profile.knowhow;
    // presets a trial added go with it (ADR 0336)
    if (baseline && !(baseline.behaviour as { presets?: unknown }).presets) delete profile.presets;
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
  maintain(id: string, patch: { instructions?: string; skills?: string[]; knowhow?: AgentProfile['knowhow'] }, reason: string): { profile: AgentProfile; before: number } | null {
    this.writable();
    const old = this.find(id);
    if (old.trial) throw new Error('Open trial: maintenance waits');
    if (Object.keys(patch).some(k => k !== 'instructions' && k !== 'knowhow' && k !== 'skills')) throw new Error('Maintenance changes only the role text and the skills');
    const next = this.behaviour({ ...(patch.skills !== undefined ? { skills: patch.skills } : {}), ...(patch.instructions !== undefined ? { instructions: patch.instructions } : {}), ...(patch.knowhow !== undefined ? { knowhow: patch.knowhow } : {}) }, id, false, old);
    // only a new version can be undone by going back to the one before (maintainRestore): no versioned change = nothing
    if (sameBehaviour(old, next) || !versionedChanges(old, next).length) return null;
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
    // a version is its text and skills (ADR 0186, 0284): going back to one keeps today's tools, permission ceiling,
    // launches and limits, so an undo never widens what the user narrowed since, and today's engine, model, effort and
    // tier (they all change in place)
    const kept = { tools: p.tools, permissionCeiling: p.permissionCeiling, launches: p.launches, ...(typeof p.maxContext === 'number' ? { maxContext: p.maxContext } : {}),
      engine: p.engine, model: p.model, tier: p.tier, tierMax: p.tierMax, ...(p.effort !== undefined ? { effort: p.effort } : {}), ...(p.presets ? { presets: p.presets } : {}),
      codeMode: p.codeMode === true, fast: p.fast === true };
    const target = { ...(entry.behaviour as unknown as Record<string, unknown>), ...kept };
    if (typeof p.maxContext !== 'number') delete target.maxContext;
    if (p.effort === undefined) delete target.effort;
    if (!p.presets) delete target.presets;
    const profile: AgentProfile = { ...rest, ...this.behaviour(target, id, true, rest as Behaviour), activeVersion: version,
      updatedAt: Math.max(this.now(), p.updatedAt + 1), lastEditedBy: by, ...(by === 'user' ? { userLocked: true } : {}) };
    // the version's own record takes what was kept, as any in-place change of the active version does: a trial's
    // rollback and the nightly sampling read that record, and it would still say the model and tools of long ago
    const amends = sameBehaviour(entry.behaviour, profile) ? [] : [{ agentId: id, version, behaviour: behaviourOf(profile), at: profile.updatedAt, by, reason: 'Versione ripristinata: modello, livello, strumenti e limiti restano quelli di oggi' }];
    this.commit(this.profiles.map(x => x.id === id ? profile : x), [], [{ agentId: id, version: p.activeVersion, state: 'superseded' }, { agentId: id, version, state: 'active' }], amends);
    this.knowhowChanged(p, profile);
    if (by === 'user') this.d.onCustomized?.();
    return structuredClone(profile);
  }

  /** What a chat starts with. A role chat runs on the role's engine with one of its card's three presets (ADR 0336:
   *  the delegator's pick, Base when none); the Orchestrator keeps the session's engine and its card's model (when on
   *  that engine), else the session's; a chat without a role is plain. The model the user named for one run
   *  (`userModel`, ADR 0296) must be one of the card's presets; it picks that preset for that chat only. */
  resolve(req: NewChat, o: ResolveOptions = {}): ResolvedRole {
    if (req.orchestrator) {
      const p = this.profiles.find(x => x.id === 'orchestrator');
      // its card's model and effort when the card is on this engine (ADR 0107; the Settings' «Chat aperte
      // dall'Orchestrator» models moved onto the card, 2026-11-23)
      // its Base list (#468): the first model of the list on the chat's engine (the user orders them on its page)
      const own = p?.levels?.base?.find(x => x.engine === req.harness);
      if (own) {
        if (own.model) req = { ...req, model: own.model };
        if (own.effort && req.effort === undefined) req = { ...req, effort: own.effort };
      } else {
        if (p?.model && p.engine === req.harness) req = { ...req, model: p.model };
        if (p?.effort && p.engine === req.harness && req.effort === undefined) req = { ...req, effort: p.effort };
      }
      return { request: req, owner: orchestratorOwner(req.harness, req.model ?? null, p), instructions: p?.instructions ?? ROLE_DEFAULTS.orchestrator.instructions,
        policy: p && (p.tools || p.permissionCeiling) ? { tools: p.tools ? structuredClone(p.tools) : null, ceiling: p.permissionCeiling } : null,
        skills: [...new Set([...(p?.skills ?? ROLE_DEFAULTS.orchestrator.skills), ...(p?.knowhow?.linked ?? [])])], launches: p?.launches ?? [...ROLE_DEFAULTS.orchestrator.launches] };
    }
    if (req.roleId === undefined) return { request: req, owner: plainOwner(req.harness, req.model ?? null), instructions: '', policy: null, skills: [], launches: [] };
    if (req.roleId === 'orchestrator') throw new Error('L’Orchestrator è il coordinatore: apri la sua chat, non una chat di lavoro.');
    if (isRetiredRoleId(req.roleId)) throw new Error(`Il ruolo ${String(req.roleId)} non c’è più (ADR 0100): il suo lavoro lo fa ${roleName(req.roleId)}. I ruoli: ${ROLE_IDS.filter(r => r !== 'orchestrator').join(', ')}.`);
    if (!isWorkRole(req.roleId)) throw new Error(`Ruolo sconosciuto: ${String(req.roleId)}. I ruoli: ${ROLE_IDS.filter(r => r !== 'orchestrator').join(', ')}.`);
    const p = this.find(req.roleId);
    if (req.roleVersion !== undefined && req.roleVersion !== p.activeVersion) throw new Error('Il ruolo è cambiato: rileggilo prima di avviarlo.');
    // known availability again at launch, never falling back to another engine or model
    this.behaviour({}, p.id, true, p, false);
    // the preset of this task (ADR 0336): the delegator's pick among the card's three, Base without a reason, never
    // priced above the delegator's own model; never another engine, never a free model
    const levels = this.levelsFor(p);
    const presets = headPresets(levels);
    const ask = presetAskOf({ preset: req.preset, presetWhy: req.presetWhy, taskKind: req.taskKind }, '');
    const asked = choosePreset({ presets, ask, ...(req.delegator ? { delegator: req.delegator } : {}), price: this.d.price ?? (() => null) });
    const tier = p.tier;
    // the user's own pick for this run (ADR 0296): one of the models of the card's levels (not held to the delegator's
    // ceiling: the user asked), on its own engine
    const user = req.userModel ?? null;
    let choice: PresetChoice = asked;
    let candidates: LevelModel[] = levels[asked.preset];
    if (user) {
      const named = levelNamed(levels, user.model, user.engine);
      if (!named) throw new Error(`${p.name}: ${user.model}${user.engine ? ` su ${user.engine}` : ''} non è tra i modelli dei suoi livelli (${PRESET_IDS.map(id => `${id}: ${levels[id].map(x => x.model ?? `predefinito di ${x.engine}`).join(', ')}`).join(' · ')}). Aggiungilo nella pagina del ruolo (Agenti → ${p.name} → Modelli per livello).`);
      const effortOf = user.effort ?? named.at.effort;
      const { effort: _x, asked: _y, ...kept } = asked; void _x; void _y;
      choice = { ...kept, preset: named.preset, model: named.at.model, ...(effortOf ? { effort: effortOf } : {}), ...(named.preset !== (ask.preset ?? 'base') ? { asked: ask.preset ?? 'base' } : {}),
        warnings: [...asked.warnings, `the user asked for ${user.model}: level ${named.preset}`] };
      candidates = [{ ...named.at, ...(effortOf ? { effort: effortOf } : {}) }];
    }
    // the model of the level (ADR 0347): the first whose engine is on and whose plan has room, in the user's order
    const got = this.pickIn(candidates, user || o.holdLevel ? undefined : req.delegator, o.asker, o.skip);
    if (!got) throw new Error(user ? `${user.model} non può partire: ${this.unusable(candidates[0]!) ?? 'motore non pronto'}.`
      : `Nessun modello del livello ${choice.preset} di ${p.name} può partire: ${candidates.map(x => `${x.model ?? 'predefinito'} su ${x.engine} (${this.unusable(x)})`).join(', ')}. Accendi un motore dal menu ⚙ o aggiungi un modello al livello.`);
    const engine = got.chosen.engine;
    const e = this.d.models().find(x => x.engine === engine)!;
    // a review's independence is its clean session (it never sees its parent's reasoning), never another model (ADR 0091)
    const picked = { model: got.chosen.model };
    // the effort the model really takes (ADR 0211): a level it lacks becomes the nearest lower one, none when it takes none
    const effort = effortOn(got.chosen.effort ?? (user ? null : req.effort ?? null), picked.model ? e.models.find(m => m.id === picked.model)?.efforts : undefined) ?? undefined;
    { const { effort: _h, ...noEffort } = choice; void _h; choice = { ...noEffort, model: picked.model, engine, route: got.reason, ...(effort ? { effort } : {}), ...(got.skipped.length ? { skipped: got.skipped } : {}), ...(got.allOut ? { allOut: true as const, rooms: got.considered.filter(c => c.usable).map(c => ({ engine: c.at.engine, model: c.at.model, why: c.room.why, until: c.room.resetsAt })) } : {}) }; }
    // the plan of the chosen model is on probation (ADR 0354): this launch is its one try; the next launches skip it
    if (o.claim === true && got.considered.find(c => c.at === got.chosen)?.room.state === 'probation') this.d.claim?.(engine, picked.model, o.asker ?? `launch:${randomUUID()}`);
    const { model: _m, effort: _e, userModel: _u, preset: _p, presetWhy: _w, taskKind: _k, delegator: _d, ...rest } = req; void _m; void _e; void _u; void _p; void _w; void _k; void _d;
    const r = ROLE_DEFAULTS[p.id as RoleId];
    const instructions = `${rolePreamble(p.id)}\n\nRole: ${p.name}.\n${p.instructions}\nOutput: ${r.output}`;
    return { request: { ...rest, harness: engine, ...(picked.model ? { model: picked.model } : {}), ...(effort ? { effort } : {}) }, owner: { ...ownerOf(p), engine, model: picked.model },
      // everything allowed (ADR 0347): only the API engine's own limit (it has no tools) is a policy
      instructions, policy: engineOf(engine)?.kind === 'api' ? { tools: { allow: ['read'] }, ceiling: null } : null,
      ...(typeof p.maxContext === 'number' ? { maxContext: p.maxContext } : {}), skills: [...p.skills, ...(p.knowhow?.linked ?? [])].filter((s, i, a) => a.indexOf(s) === i), launches: isDelegatorRole(p.id) ? [...p.launches] : [],
      tier, presetChoice: choice };
  }

  /** The three lists of a role's card (ADR 0347): its own lists, else its preset of each level on its engine. */
  levelsFor(p: AgentProfile): FullLevels {
    const l = levelsOf(p, cardPresets(p, this.d.tierModel?.(p.engine, p.tier) ?? null));
    // a model left to the engine is the role's tier model there, as for the card's own model (ADR 0210)
    const fill = (x: LevelModel): LevelModel => x.model === null ? { ...x, model: this.d.tierModel?.(x.engine, p.tier) ?? null } : x;
    return { min: l.min.map(fill), base: l.base.map(fill), max: l.max.map(fill) };
  }
  /** Whether a role's levels have the model the user named (ADR 0296): only then does it hold for that role's chat. */
  namesModel(roleId: string, user: { model: string; engine?: Harness }): boolean {
    try { return !!levelNamed(this.levelsFor(this.find(roleId)), user.model, user.engine); } catch { return false; }
  }
  /** The three presets of a role's card (ADR 0336): the head of each level's list (ADR 0347). */
  presetsOf(p: AgentProfile): FullPresets { return headPresets(this.levelsFor(p)); }
  /** The room of every model of a role's levels now (the role page's «ora userebbe»): the same pick a launch makes. */
  levelRoute(roleId: string): Record<PresetId, { engine: string; model: string | null; index: number; reason: string; state: Room['state'] } | null> {
    const levels = this.levelsFor(this.find(roleId));
    const one = (id: PresetId) => {
      const g = this.pickIn(levels[id]);
      return g ? { engine: g.chosen.engine, model: g.chosen.model, index: levels[id].indexOf(g.chosen), reason: g.reason, state: g.considered.find(c => c.at === g.chosen)?.room.state ?? 'unknown' } : null;
    };
    return { min: one('min'), base: one('base'), max: one('max') };
  }
  /** Why a model of a level may not start now; null = it may. */
  private unusable(x: LevelModel): string | null {
    const e = this.d.models().find(m => m.engine === x.engine);
    if (!e) return 'motore sconosciuto';
    if (!e.enabled || !e.trusted) return `${e.label} è spento`;
    if (x.model !== null && !e.modelSelectable) return e.modelReason ?? `${e.label} non applica una scelta di modello`;
    return this.d.engineBlock?.(x.engine) ?? null;
  }
  /** The pick in a level. With a delegator's price ceiling (ADR 0336), a model priced above it is passed over while
   *  another of the level fits (or has no known price): a fallback is held to the ceiling as the head is. */
  private pickIn(list: readonly LevelModel[], delegator?: Delegator, asker?: string, skip?: readonly string[]) {
    const price = this.d.price, own = delegator?.model ?? null, cap = own && price ? price(own) : null;
    const over = (x: LevelModel) => cap !== null && !!x.model && (price!(x.model) ?? -1) > cap;
    const skipped = (x: LevelModel) => skip?.includes(`${x.engine}:${x.model ?? ''}`) ? 'non è partito prima: si prova il successivo' : null;
    const fits = cap !== null && list.some(x => !over(x) && this.unusable(x) === null && !skipped(x));
    return pickInLevel(list, x => this.unusable(x) ?? skipped(x) ?? (fits && over(x) ? `costa più del modello di chi delega (${own})` : null), x => this.d.room?.(x.engine, x.model, asker) ?? { state: 'unknown', why: '', resetsAt: null }, { now: this.now() });
  }
  /** What a role's card gives a chat of that role now, for a preset (ADR 0346: a chat that waited on its credits
   *  follows its card): the card's engine and that preset's model and effort, as a launch would get them (resolve's
   *  guards; nothing started). Throws as resolve does: engine off, a model the engine cannot apply. */
  cardNow(roleId: string, ask: PresetAsk, o: { asker?: string; skip?: readonly string[] } = {}): CardPick {
    const p = this.find(roleId);
    // a chat that moves keeps its level: no delegator's price ceiling (it could lower the preset, ADR 0354 point 8)
    const r = this.resolve({ harness: p.engine, cwd: '', roleId, ...ask } as NewChat, { holdLevel: true, ...(o.asker ? { asker: o.asker } : {}), ...(o.skip ? { skip: o.skip } : {}) });
    const c = r.presetChoice;
    return { engine: r.request.harness, model: r.request.model ?? null, effort: r.request.effort ?? null, preset: c?.preset ?? 'base', allOut: !!c?.allOut, skipped: c?.skipped ?? [], route: c?.route ?? '', rooms: c?.rooms ?? [] };
  }
  /** The preset a delegation of `roleId` would get (resolve's guards, nothing started), with the engine and model its
   *  level would start on now. */
  presetChoice(roleId: string, ask: PresetAsk, delegator?: Delegator): PresetChoice {
    const p = this.find(roleId), levels = this.levelsFor(p);
    const c = choosePreset({ presets: headPresets(levels), ask, ...(delegator ? { delegator } : {}), price: this.d.price ?? (() => null) });
    const g = this.pickIn(levels[c.preset], delegator);
    if (!g) return c;
    const { effort: _h, ...rest } = c; void _h;
    return { ...rest, engine: g.chosen.engine, model: g.chosen.model, route: g.reason, ...(g.chosen.effort ? { effort: g.chosen.effort } : {}) };
  }
}

/** The user's own model for a piece of work (`userModel` on the chat the Orchestrator opened, ADR 0296) holds for the
 *  chats opened under it, when their role's levels have that model (ADR 0354): the nearest ancestor that carries one
 *  decides. An agent never passes one itself (agent_delegate has no such field). Used by wiring.ts resolveAgent. */
export function inheritUserModel<R extends Pick<NewChat, 'userModel' | 'parentId' | 'roleId' | 'orchestrator'>>(
  req: R, chats: readonly { id: string; parentId?: string | null; userModel?: NewChat['userModel'] }[], names: (roleId: string, m: NonNullable<NewChat['userModel']>) => boolean): R & Pick<NewChat, 'userModel'> {
  if (req.userModel || !req.parentId || !req.roleId || req.orchestrator) return req;
  const byId = new Map(chats.map(c => [c.id, c])), seen = new Set<string>();
  for (let x = byId.get(req.parentId); x && !seen.has(x.id); x = x.parentId ? byId.get(x.parentId) : undefined) {
    seen.add(x.id);
    if (x.userModel) return names(req.roleId, x.userModel) ? { ...req, userModel: x.userModel } : req;
  }
  return req;
}
