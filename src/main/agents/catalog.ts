// Validated local agent profiles, seeds and launch resolution, used by UI and chat creation.
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { checkedKnowhow, checkedPackIdentity } from '../../shared/agent-pack';
import type { Effort, NewChat, RoutingRow } from '../../shared/contract';
import { AGENT_CATEGORIES, AGENT_SYMBOLS, AGENT_TONES, MAX_CONTEXT_RANGE, PERMISSION_CEILINGS, type AgentAuthor, type AgentAvatar, type AgentCatalog, type AgentCategory, type AgentDraft, type AgentEvidenceRef, type AgentModelChoice, type AgentOrigin, type AgentOwnerSnapshot, type AgentProfile, type AgentProfileV1, type AgentToolPolicy, type AgentVersion, type PermissionCeiling, GENERAL_AGENT_ID, inProbation, type AgentProbation, type AgentProbationDecision, type AgentProbationSource } from '../../shared/agents';
import { checkImages } from '../chats/images';
import { readLocal, writeLocal } from './local-store';
import { boundedRaster } from './raster';
import { legacyAgentProfiles, legacyGuidance, legacyKindOf } from './legacy';
import { checkedManifest } from '../../shared/agent-manifest';
import { DEFAULT_MANIFESTS, DEFAULT_MANIFESTS_EN } from './manifest-defaults';
import { AgentHistory, behaviourOf, firstVersion, sameBehaviour, upgradeProfile } from './versions';
import { checkedTools, type AgentPolicy } from './tool-policy';
import { engineOf } from '../engines/registry';
import { ORCHESTRATOR_AGENT_ID, ORCHESTRATOR_INSTRUCTIONS } from './orchestrator-preset';
import { log, errText } from '../log';
import { LEGACY_ROLE_REPLACEMENTS, roleAgentPresets } from '../../shared/agent-presets';
import { presetDraft, presetHash } from './preset-support';
import { checkAuthorPolicy, checkAgentCwd, protectedAgent, withoutPackFields } from './author-policy';
import { PROBATION_CAP } from './probation';

const MODEL = /^[\w.:@/[\]][\w.:@/=[\],-]{0,119}$/;
const ID = /^[a-z][a-z0-9_-]{0,79}$/;
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const AUTHORS: readonly AgentAuthor[] = ['user', 'orchestrator', 'preset', 'migration', 'maintenance'];
const EVIDENCE: readonly AgentEvidenceRef['kind'][] = ['journal', 'chat', 'ai-error', 'cost', 'run', 'feedback'];
/** Launchable definitions; archived ones only count toward the file bound. */
export const MAX_ACTIVE_AGENTS = 64;
export const MAX_AGENTS = 256;
const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const count = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 1;
const has = <T>(list: readonly T[], v: unknown): v is T => (list as readonly unknown[]).includes(v);
/** A profile without its "Contesto massimo": merged under a validated draft, an omitted value stays cleared. */
const withoutMaxContext = <T extends { maxContext?: number | null }>(p: T): Omit<T, 'maxContext'> => { const { maxContext: _mc, ...rest } = p; void _mc; return rest; };
/** Validated draft with the v2 definition fields resolved (older clients omit them). */
type CheckedDraft = AgentDraft & { role: string; category: AgentCategory; tools: AgentToolPolicy | null; permissionCeiling: PermissionCeiling | null };
function text(v: unknown, max: number, label: string, empty = false): string {
  if (typeof v !== 'string' || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v) || (!empty && !v.trim())) throw new Error(`${label}: testo ${empty ? 'fino a' : 'da 1 a'} ${max} caratteri.`);
  return v.trim();
}
export interface AgentCatalogDeps {
  presetEvent?: (message: string) => void;
  enabledMcp?: () => readonly string[];
  approvedRoots?: () => readonly string[];
  pulsePreset?: () => { engine: string; model: string | null; effort?: Effort };
  language?: () => 'it' | 'en';
  userData: string;
  models: () => AgentModelChoice[];
  /** Main-owned raster decoder, never a URL fetch. Null/absent means image uploads are unavailable. */
  imageSize?: (data: Buffer) => { width: number; height: number } | null;
  emit?: (catalog: AgentCatalog) => void;
  now?: () => number;
  onCustomized?: () => void;
  legacyRoutes?: () => readonly RoutingRow[];
  legacyApiEngine?: () => string | null;
}
export interface PackInstall { value: AgentDraft; id: string; source: AgentProbationSource | { kind: 'learned-rule' }; update?: boolean; origin?: AgentOrigin }

/** Pure byte/header checks also protect chat snapshots before any renderer image allocation. */
function checkedImage(value: unknown): { avatar: AgentAvatar; data: Buffer; header: { width: number; height: number } } {
  const a = obj(value);
  if (a.kind !== 'image' || typeof a.dataUrl !== 'string' || a.dataUrl.length > 350_000) throw new Error('Scegli un simbolo oppure un’immagine PNG, JPEG o WebP fino a 256 KB.');
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(a.dataUrl);
  if (!match) throw new Error('Formato immagine non supportato.');
  const data = Buffer.from(match[2]!, 'base64');
  if (!data.length || data.length > 256_000 || data.toString('base64') !== match[2]) throw new Error('Immagine non valida o troppo grande.');
  checkImages([{ mimeType: match[1], data: match[2] }]);
  const header = boundedRaster(data, match[1]!);
  if (!header) throw new Error('L’immagine deve misurare tra 16 e 1024 pixel per lato.');
  return { avatar: { kind: 'image', dataUrl: a.dataUrl }, data, header };
}

/** No executable content, remote URL, SVG, HTML or arbitrary local path reaches the renderer. */
export function checkedAvatar(value: unknown, size?: AgentCatalogDeps['imageSize']): AgentAvatar {
  const a = obj(value);
  if (a.kind === 'symbol' && has(AGENT_SYMBOLS, a.value)) {
    if (a.tone !== undefined && !has(AGENT_TONES, a.tone)) throw new Error('Colore del simbolo non valido.');
    return { kind: 'symbol', value: a.value, ...(a.tone !== undefined ? { tone: a.tone } : {}) };
  }
  if (a.kind === 'symbol') throw new Error(`Simbolo non valido: ${AGENT_SYMBOLS.join(' | ')} (tone: ${AGENT_TONES.join(' | ')}).`);
  const { avatar, data, header } = checkedImage(value);
  const dims = size?.(data);
  if (!dims || !(dims.width === header.width && dims.height === header.height || dims.width === header.height && dims.height === header.width)) throw new Error('L’immagine deve essere leggibile e misurare tra 16 e 1024 pixel per lato.');
  return avatar;
}

function readOrigin(value: unknown): AgentOrigin {
  const o = obj(value);
  if (o.kind === 'user') return { kind: 'user' };
  if (o.kind === 'preset' && typeof o.presetId === 'string' && ID.test(o.presetId) && Number.isSafeInteger(o.presetRevision) && (o.presetRevision as number) >= 0) return { kind: 'preset', presetId: o.presetId, presetRevision: o.presetRevision as number };
  if (o.kind === 'orchestrator' && typeof o.reason === 'string' && o.reason.length <= 600 && Array.isArray(o.evidence) && o.evidence.length <= 20) {
    const evidence = o.evidence.map(obj);
    if (evidence.every(e => has(EVIDENCE, e.kind) && typeof e.ref === 'string' && e.ref.length <= 200 && typeof e.at === 'number' && Number.isFinite(e.at)))
      return { kind: 'orchestrator', reason: o.reason, evidence: evidence.map(e => ({ kind: e.kind as AgentEvidenceRef['kind'], ref: e.ref as string, at: e.at as number })) };
  }
  throw new Error('Origine Agente non valida.');
}

export function ownerOf(p: AgentProfile): AgentOwnerSnapshot {
  return { id: p.id, name: p.name, purpose: p.purpose, avatar: structuredClone(p.avatar), engine: p.engine, model: p.model, revision: p.updatedAt, source: 'catalog', version: p.activeVersion };
}
export function compatibleOwner(engine: string, model: string | null, legacy = false): AgentOwnerSnapshot {
  const key = createHash('sha256').update(`${engine}\n${model ?? ''}`).digest('hex').slice(0, 12);
  return { id: `${legacy ? 'legacy' : 'routed'}-${key}`, name: 'Assistente', purpose: legacy ? 'Sessione esistente, configurazione conservata' : 'Assistente per questa attività', avatar: { kind: 'symbol', value: 'briefcase' }, engine, model, revision: 1, source: legacy ? 'legacy' : 'routed' };
}
/** An Orchestrator's owner: the session's engine/model with the Orchestrator profile's face (name, purpose, avatar); still no
 *  catalog run. Without the profile, the preset's own face. Chats saved before this fix carry the "Assistente" one. */
export function orchestratorOwner(base: AgentOwnerSnapshot, p?: Pick<AgentProfile, 'name' | 'purpose' | 'avatar'>): AgentOwnerSnapshot {
  return { ...base, name: p?.name ?? 'Orchestrator', purpose: p?.purpose ?? ORCHESTRATOR_PURPOSE, avatar: p ? structuredClone(p.avatar) : { kind: 'symbol', value: 'compass' } };
}
const ORCHESTRATOR_PURPOSE = 'Coordinare gli agenti e restare disponibile per la persona';

/** Bounded validation for snapshots read from chats.json; model/engine never replace the effective session facts. */
export function readOwner(v: unknown): AgentOwnerSnapshot | null {
  const a = obj(v), avatar = obj(a.avatar);
  if (typeof a.id !== 'string' || !ID.test(a.id) || typeof a.name !== 'string' || !a.name.trim() || a.name.length > 80 || typeof a.purpose !== 'string' || a.purpose.length > 400 || typeof a.engine !== 'string' || !/^[a-z][a-z0-9_-]{0,59}$/.test(a.engine) || !(a.model === null || typeof a.model === 'string' && MODEL.test(a.model)) || typeof a.revision !== 'number' || !Number.isFinite(a.revision) || !['catalog', 'legacy', 'routed'].includes(String(a.source)) || !(a.version === undefined || count(a.version))) return null;
  // Restored data is untrusted even if the original catalog upload was validated.
  let icon: AgentAvatar;
  // A symbol or tone this build does not know (a newer app wrote it) keeps the chat readable with the default look.
  if (avatar.kind === 'symbol') icon = has(AGENT_SYMBOLS, avatar.value) ? { kind: 'symbol', value: avatar.value, ...(has(AGENT_TONES, avatar.tone) ? { tone: avatar.tone } : {}) } : { kind: 'symbol', value: 'briefcase' };
  else if (avatar.kind === 'image') { try { icon = checkedImage(avatar).avatar; } catch { return null; } }
  else return null;
  return { id: a.id, name: a.name, purpose: a.purpose, engine: a.engine, model: a.model as string | null, revision: a.revision, source: a.source as AgentOwnerSnapshot['source'], avatar: icon, ...(a.version !== undefined ? { version: a.version as number } : {}) };
}

const ROLES = [
  ['general', 'Generale', 'Organizzare il lavoro e preparare risultati utili', 'Chiarisci il risultato atteso. Distingui fatti, ipotesi e proposte. Rispetta permessi e dati personali.', 'briefcase'],
  ['research', 'Ricerca', 'Raccogliere e verificare informazioni e fonti', 'Verifica fonti e date; cita PR, CI e attività collegate distinguendo stato osservato e informazioni non verificate. Usa solo strumenti e account disponibili; segnala le lacune senza inventare risultati.', 'search'],
  ['writing', 'Scrittura e documenti', 'Preparare testi e documenti chiari per il destinatario', 'Chiarisci destinatario, formato e tono. Prepara storie utente con criteri verificabili, bug riproducibili, note di rilascio e aggiornamenti basati su fonti. Distingui bozza, pubblicazione e invio; rispetta le regole del brain e i permessi disponibili.', 'pen'],
  ['analysis', 'Analisi', 'Interpretare dati e confrontare alternative', 'Collega criteri di accettazione a casi di test, copertura e lacune; documenta bug con passi, atteso, osservato e gravità. Valuta rischi tecnici, qualità e costi con fonti, periodo, unità e incertezze. Per il rilascio separa raccomandazione e approvazione della persona; non inventare misure o verifiche.', 'chart'],
  ['planning', 'Pianificazione', 'Tradurre obiettivi in passi concreti', 'Prepara backlog, refinement, priorità e dipendenze motivati. Coordina una checklist di rilascio con CI osservata, blocchi, responsabili e recupero; rendi esplicite le decisioni della persona. Non promettere scadenze non concordate né modificare sistemi condivisi senza rispettare le regole del brain e i permessi.', 'compass'],
  ['development', 'Sviluppo', 'Progettare, modificare e verificare software', 'Leggi le regole del repository e del brain selezionato, comprese le Regole delle azioni; preserva i cambi esistenti. Segui branch, commit, PR, review, CI, rilascio e deploy con diff, comandi, esiti reali e recupero; prepara ADR con alternative e rischi. Esegui test manuali e automatici autorizzati, riproduci i bug e verifica fix e regressioni. Ricontrolla target, regole e permessi prima di agire; senza strumenti o account segnala la lacuna, senza installare o sostituire di nascosto né dichiarare successi non verificati.', 'code'],
] as const;
/** The seed's name before it became the agent of agentless chats: a pristine copy is renamed, never as Brother's edit. */
const LEGACY_GENERAL_NAME = 'Assistente';
const GENERAL_LOCKED = 'Il Generale non si può archiviare: è l’Agente delle chat avviate senza sceglierne uno.';

export class AgentCatalogService {
  private readonly file: string;
  private readonly store: AgentHistory;
  /** Active and archived definitions, in file order. */
  private profiles: AgentProfile[] = [];
  private problem: string | null = null;
  private legacyRouting: AgentCatalog['legacyRouting'] = { preserved: true, imported: 0, remaining: 0 };
  /** Set by the agent packs: a version change that swaps the know-how republishes its editable brain copy. */
  private knowhowListener: ((profile: AgentProfile, previousHash: string | undefined) => void) | null = null;
  onKnowhowChange(listener: (profile: AgentProfile, previousHash: string | undefined) => void): void { this.knowhowListener = listener; }
  private knowhowChanged(before: AgentProfile, after: AgentProfile): void {
    if (before.knowhow?.hash !== after.knowhow?.hash) this.knowhowListener?.(structuredClone(after), before.knowhow?.hash);
  }
  constructor(private readonly d: AgentCatalogDeps) {
    // v2 lives in its own file: agents.json (v1) stays as it was, so a rolled-back build still reads its catalog.
    this.file = path.join(d.userData, 'agents.v2.json');
    this.store = new AgentHistory(d.userData);
    let pending: AgentVersion[] | null = null;
    try {
      const current = readLocal(this.file), raw = current ?? readLocal(path.join(d.userData, 'agents.json'));
      if (raw !== undefined) {
        const a = obj(raw);
        if (current !== undefined) {
          if (a.version !== 2) throw new Error('Catalogo Agenti non valido.');
          this.profiles = this.readV2(a);
        } else if (a.version === 1) {
          const v1 = this.readV1(a);
          this.profiles = v1.map(({ profile, pristine }) => upgradeProfile(profile, pristine));
          pending = this.profiles.map(p => firstVersion(p, 'migration', 'Versione esistente prima delle versioni', this.now()));
        } else throw new Error('Catalogo Agenti non valido.');
        const migration = obj(a.legacyRouting);
        if (Number.isSafeInteger(migration.imported) && Number(migration.imported) >= 0 && Number.isSafeInteger(migration.remaining) && Number(migration.remaining) >= 0) this.legacyRouting = { preserved: true, imported: Number(migration.imported), remaining: Number(migration.remaining) };
      } else {
        this.fresh = true;
        const defaults = this.defaults(), legacy = legacyAgentProfiles(d.legacyRoutes?.() ?? [], this.now(), { apiEngine: d.legacyApiEngine?.() ?? null });
        const imported = legacy.profiles.slice(0, Math.max(0, MAX_ACTIVE_AGENTS - defaults.length)).map(p => upgradeProfile(p, false));
        this.profiles = [...defaults, ...imported];
        this.legacyRouting = { preserved: true, imported: imported.length, remaining: legacy.skipped + legacy.profiles.length - imported.length };
        pending = [...defaults.map(p => firstVersion(p, 'preset', 'Agente iniziale', this.now())), ...imported.map(p => firstVersion(p, 'migration', 'Importato dal routing', this.now()))];
      }
    } catch { this.problem = 'Il catalogo locale non è leggibile. Il file è conservato; correggilo prima di salvare nuovi Agenti.'; return; }
    if (d.pulsePreset && !this.profiles.some(p => p.id === 'default-pulse') && this.profiles.length < MAX_AGENTS && this.profiles.filter(p => p.status === 'active').length < MAX_ACTIVE_AGENTS) {
      const at = this.now();
      const pulse = upgradeProfile({ id: 'default-pulse', name: 'Battito', purpose: 'Idee, consigli, promemoria, collegamenti e frase della Dashboard',
        instructions: 'Usa soltanto il digest fornito. Cita le fonti. Proponi poche carte concrete, senza inventare fatti. Non eseguire azioni.',
        role: 'Tiene vivo il cervello', category: 'personal', tools: { allow: [] }, permissionCeiling: 'plan',
        avatar: { kind: 'symbol', value: 'eye' }, ...d.pulsePreset(), createdAt: at, updatedAt: at }, true, 'preset');
      pulse.routable = false;
      this.profiles.push(pulse); pending = [...(pending ?? []), firstVersion(pulse, 'preset', 'Battito iniziale', at)];
    }
    // Additive seed migration: retain every existing definition, including customized presets.
    if (!this.profiles.some(p => p.id === ORCHESTRATOR_AGENT_ID) && this.profiles.length < MAX_AGENTS && this.profiles.filter(p => p.status === 'active').length < MAX_ACTIVE_AGENTS) {
      const coordinator = this.orchestratorSeed(this.defaults()[0]);
      if (coordinator) {
        this.profiles.push(coordinator);
        pending = [...(pending ?? []), firstVersion(coordinator, 'preset', 'Orchestrator iniziale', coordinator.createdAt)];
      }
    }
    if (pending) {
      // History, then catalog: a retry after any failure redoes the same steps (history replaces same versions).
      try {
        const body = this.body(this.profiles);
        this.store.commit(pending);
        writeLocal(this.file, body);
      } catch { this.problem = this.store.problem ?? 'Il catalogo Agenti non è stato aggiornato sul disco. Il file è conservato; le modifiche sono sospese.'; return; }
    }
    this.ensureGeneral(this.renamed);
    this.renamed = false;
    this.installPresets();
    this.completeLegacy();
  }
  /** Profiles imported from the routing table before ADR 0078 carry no whenToUse and no instructions, so the classifier
   *  could hardly tell them apart: each untouched one (never edited since the import) gets its kind's guidance as a new
   *  version by the migration. The kind is its source row's (same id from today's table), else read from its name. */
  private completeLegacy(): void {
    if (this.problem || this.store.problem) return;
    try {
      const fresh = legacyAgentProfiles(this.d.legacyRoutes?.() ?? [], this.now(), { apiEngine: this.d.legacyApiEngine?.() ?? null }).profiles;
      const versions: AgentVersion[] = [], states: Parameters<AgentHistory['commit']>[1] = [];
      const next = this.profiles.map(p => {
        if (!p.id.startsWith('legacy-') || p.lastEditedBy !== 'migration' || p.trial || p.instructions.trim() || p.manifest?.whenToUse?.trim() || !p.purpose.startsWith('Importazione legacy')) return p;
        const row = fresh.find(f => f.id === p.id);
        const kind = legacyKindOf(p.name);
        const guide = row ? { whenToUse: row.manifest?.whenToUse ?? '', instructions: row.instructions } : kind ? legacyGuidance(kind, p.name.split(' · ').slice(1).join(' · ').split(', ').filter(Boolean)) : null;
        if (!guide?.whenToUse || !guide.instructions) return p;
        const at = Math.max(this.now(), p.updatedAt + 1), version = p.version + 1;
        const profile: AgentProfile = { ...p, instructions: guide.instructions, manifest: checkedManifest({ ...(p.manifest ?? {}), whenToUse: guide.whenToUse }), version, activeVersion: version, updatedAt: at };
        versions.push({ agentId: p.id, version, parentVersion: p.activeVersion, behaviour: behaviourOf(profile), author: 'migration', reason: 'Profilo importato completato: quando usarlo e istruzioni brevi (ADR 0078)', at, state: 'active' });
        states.push({ agentId: p.id, version: p.activeVersion, state: 'superseded' });
        return profile;
      });
      if (versions.length) this.commit(next, versions, states);
    } catch (e) { log.warn('agents', 'legacy agent profiles not completed', { cause: errText(e), hint: 'they keep working; the classifier just scores them on their names' }); }
  }
  /** One conservative startup transaction; corrupt usage data prevents retirement, never implies no usage. */
  private installPresets(): void {
    if (this.problem || this.store.problem) return;
    try {
      let next = [...this.profiles];
      const versions: AgentVersion[] = [], states: Parameters<AgentHistory['commit']>[1] = [], events: string[] = [];
      for (const preset of roleAgentPresets()) {
        const old = next.find(p => p.id === preset.id);
        if (old && (old.origin.kind !== 'preset' || old.origin.presetId !== preset.id || old.origin.presetRevision >= preset.presetRevision || old.status === 'archived' || old.trial || old.userLocked || old.presetHash !== presetHash(old))) continue;
        if (!old && (next.length >= MAX_AGENTS || next.filter(p => p.status === 'active').length >= MAX_ACTIVE_AGENTS)) continue;
        const draft = presetDraft(preset, this.d.models(), this.d.legacyRoutes?.() ?? [], old);
        if (!draft) continue;
        const at = Math.max(this.now(), (old?.updatedAt ?? 0) + 1), version = (old?.version ?? 0) + 1;
        const profile: AgentProfile = { ...upgradeProfile({ ...draft, id: preset.id, createdAt: old?.createdAt ?? at, updatedAt: at }, true, 'preset'),
          ...(old ? { name: old.name, purpose: old.purpose, role: old.role, avatar: old.avatar, category: old.category } : {}),
          origin: { kind: 'preset', presetId: preset.id, presetRevision: preset.presetRevision }, version, activeVersion: version, presetHash: presetHash(draft) };
        next = old ? next.map(p => p.id === old.id ? profile : p) : [...next, profile];
        versions.push({ ...firstVersion(profile, 'preset', 'Preset installato o aggiornato', at), version, parentVersion: old?.activeVersion ?? null });
        if (old) { states.push({ agentId: old.id, version: old.activeVersion, state: 'superseded' }); events.push(`${profile.name}: preset aggiornato`); }
      }
      let used: Set<string> | null = null;
      try {
        const raw = readLocal(path.join(this.d.userData, 'chats.json'));
        const chats = raw === undefined ? [] : obj(raw).chats;
        if (Array.isArray(chats) && chats.every(c => c && typeof c === 'object')) {
          used = new Set(chats.map(c => obj(obj(c).agent).id).filter((id): id is string => typeof id === 'string'));
          const runs = readLocal(path.join(this.d.userData, 'agent-runs.json'));
          if (runs !== undefined) {
            const records = obj(runs);
            if (!Array.isArray(records.runs) || records.rollups !== undefined && !Array.isArray(records.rollups)) used = null;
            else for (const run of [...records.runs, ...(records.rollups as unknown[] | undefined ?? [])]) {
              const id = obj(run).agentId;
              if (typeof id === 'string') used.add(id);
            }
          }
        }
      } catch { used = null; /* Unknown usage: retain every legacy definition. */ }
      if (used) next = next.map(p => {
        const replacement = LEGACY_ROLE_REPLACEMENTS[p.id];
        const seed = ROLES.find(([id]) => p.id === `default-${id}`);
        if (!replacement || !seed || !next.some(n => n.id === replacement && n.status === 'active') || p.status !== 'active' || p.userLocked || p.trial || used.has(p.id)
          || p.name !== seed[1] || p.purpose !== seed[2] || p.instructions !== seed[3] || p.role !== seed[2]
          || p.model !== null || p.effort !== undefined || p.avatar.kind !== 'symbol' || p.avatar.value !== seed[4] || p.avatar.tone !== undefined
          || p.manifest !== undefined && ![DEFAULT_MANIFESTS[seed[0]], DEFAULT_MANIFESTS_EN[seed[0]]].some(m => sameBehaviour({ ...p, manifest: m }, p))
          || p.tools !== null || p.permissionCeiling !== null || p.version !== 1 || p.createdAt !== p.updatedAt) return p;
        events.push(`${p.name}: sostituito dai nuovi preset`);
        return { ...p, status: 'archived', archivedAt: this.now() };
      });
      if (versions.length || events.length) {
        this.commit(next, versions, states);
        // A new catalog retires seeds Brother never saw: no notice about agents he never had.
        if (!this.fresh) for (const event of events) this.d.presetEvent?.(event);
      }
    } catch (e) { this.problem = `Aggiornamento preset sospeso: ${errText(e)}`; }
  }
  private presetUpdates(): NonNullable<AgentCatalog['presetUpdates']> {
    return this.profiles.flatMap(p => {
      if (p.status !== 'active' || p.origin.kind !== 'preset') return [];
      const origin = p.origin;
      const preset = roleAgentPresets().find(s => s.id === origin.presetId && s.presetRevision > origin.presetRevision);
      if (!preset) return [];
      const draft = presetDraft(preset, this.d.models(), [], p)!;
      const before = behaviourOf(p), after = behaviourOf(draft);
      const differences = (Object.keys(after) as (keyof typeof after)[]).filter(field => JSON.stringify(before[field]) !== JSON.stringify(after[field])).map(field => ({ field, before: before[field] ?? null, after: after[field] ?? null }));
      return differences.length ? [{ agentId: p.id, presetRevision: preset.presetRevision, draft, differences }] : [];
    });
  }
  /** No catalog file existed at startup: the legacy seeds were created in this same load. */
  private fresh = false;
  /** readV2 renamed the pristine seed "Assistente" to "Generale" in memory: written once, with no version or lock. */
  private renamed = false;
  /**
   * The agent of agentless chats is always there and active: an archived one (an older build, a hand edit) is restored, a
   * missing one is recreated from its seed. Null when that is impossible (unreadable catalog, no default engine, limits).
   */
  private ensureGeneral(persist = false): AgentProfile | null {
    const g = this.profiles.find(p => p.id === GENERAL_AGENT_ID);
    if (this.problem || this.store.problem) return g?.status === 'active' ? g : null;
    try {
      if (g?.status === 'active') {
        if (persist) writeLocal(this.file, this.body(this.profiles));
        return g;
      }
      const active = this.profiles.filter(p => p.status === 'active').length;
      if (active >= MAX_ACTIVE_AGENTS) return null;
      if (g) {
        const { archivedAt: _a, ...rest } = g;
        void _a;
        const profile: AgentProfile = { ...rest, status: 'active', updatedAt: Math.max(this.now(), g.updatedAt + 1) };
        this.commit(this.profiles.map(x => x.id === g.id ? profile : x), []);
        return profile;
      }
      if (this.profiles.length >= MAX_AGENTS) return null;
      const seed = this.defaults().find(p => p.id === GENERAL_AGENT_ID);
      if (!seed) return null;
      this.commit([seed, ...this.profiles], [firstVersion(seed, 'preset', 'Agente Generale ricreato', this.now())]);
      return seed;
    } catch (e) {
      log.warn('agents', 'the Generale agent could not be restored', { cause: errText(e), hint: 'agentless chats start without a run until the catalog is writable' });
      return null;
    }
  }
  private now(): number { return this.d.now?.() ?? Date.now(); }
  private identity(p: Record<string, unknown>, ids: Set<string>): void {
    if (typeof p.id !== 'string' || !ID.test(p.id) || ids.has(p.id) || typeof p.createdAt !== 'number' || !Number.isFinite(p.createdAt) || typeof p.updatedAt !== 'number' || !Number.isFinite(p.updatedAt)) throw new Error('Identità Agente non valida.');
    ids.add(p.id);
  }
  /** v1 records; `pristine` marks identifiable untouched system seeds, which also gain their manifest as before. */
  private readV1(a: Record<string, unknown>): { profile: AgentProfileV1; pristine: boolean }[] {
    if (!Array.isArray(a.profiles) || a.profiles.length > MAX_ACTIVE_AGENTS) throw new Error('Catalogo Agenti non valido.');
    const ids = new Set<string>();
    return a.profiles.map(value => {
      const p = obj(value);
      this.identity(p, ids);
      const draft = this.validate(p, false);
      const role = ROLES.find(([id, name, purpose, instructions]) => p.id === `default-${id}` && (draft.name === name || id === 'general' && draft.name === LEGACY_GENERAL_NAME) && draft.purpose === purpose && draft.instructions === instructions);
      const manifests = this.d.language?.() === 'en' ? DEFAULT_MANIFESTS_EN : DEFAULT_MANIFESTS;
      const profile: AgentProfileV1 = { ...draft, ...(role ? { name: role[1] } : {}), ...(draft.manifest === undefined && role ? { manifest: checkedManifest(manifests[role[0]]) } : {}), id: p.id as string, createdAt: p.createdAt as number, updatedAt: p.updatedAt as number };
      // v1 never stored a category: let the migration derive it from the seed role.
      if (p.category === undefined) delete profile.category;
      return { profile, pristine: role !== undefined };
    });
  }
  private readV2(a: Record<string, unknown>): AgentProfile[] {
    if (!Array.isArray(a.profiles) || a.profiles.length > MAX_AGENTS) throw new Error('Catalogo Agenti non valido.');
    const ids = new Set<string>();
    const profiles = a.profiles.map(value => {
      const p = obj(value);
      this.identity(p, ids);
      const draft = this.validate(p, false);
      const trial = p.trial === undefined ? undefined : obj(p.trial);
      const probation = p.probation === undefined ? undefined : obj(p.probation);
      // the pristine seed renamed "Generale" (AGENTS-DESIGN §4.7): not Brother's edit, so no version and no lock
      if (p.id === GENERAL_AGENT_ID && p.userLocked === false && draft.name === LEGACY_GENERAL_NAME) { draft.name = ROLES[0][1]; this.renamed = true; }
      if (!count(p.version) || !count(p.activeVersion) || p.activeVersion > p.version || !has(AUTHORS, p.lastEditedBy) || typeof p.userLocked !== 'boolean' || !has(['active', 'archived'] as const, p.status)
        || (p.status === 'archived' ? typeof p.archivedAt !== 'number' || !Number.isFinite(p.archivedAt) : p.archivedAt !== undefined)
        || (trial && (!count(trial.version) || trial.version > p.version || !count(trial.baseline) || trial.baseline > p.version || typeof trial.startedAt !== 'number' || !Number.isFinite(trial.startedAt)))) throw new Error('Versione Agente non valida.');
      return { ...draft, ...(p.id === 'default-pulse' || p.id === ORCHESTRATOR_AGENT_ID ? { routable: false } : {}), id: p.id as string, createdAt: p.createdAt as number, updatedAt: p.updatedAt as number, origin: readOrigin(p.origin), version: p.version, activeVersion: p.activeVersion,
        ...(trial ? { trial: { version: trial.version as number, baseline: trial.baseline as number, startedAt: trial.startedAt as number } } : {}),
        ...(probation ? { probation: this.checkedProbation(probation) } : {}),
        lastEditedBy: p.lastEditedBy, userLocked: p.userLocked, status: p.status, ...(typeof p.presetHash === 'string' && /^[a-f0-9]{64}$/.test(p.presetHash) ? { presetHash: p.presetHash } : {}), ...(p.status === 'archived' ? { archivedAt: p.archivedAt as number } : {}) };
    });
    if (profiles.filter(p => p.status === 'active').length > MAX_ACTIVE_AGENTS) throw new Error('Troppi Agenti attivi.');
    return profiles;
  }
  private defaults(): AgentProfile[] {
    const choices = this.d.models();
    const usable = choices.filter(x => x.enabled && x.trusted && x.defaultModel && x.installed !== false && x.authenticated !== false);
    const e = usable.find(x => x.installed === true && x.authenticated === true) ?? usable[0];
    if (!e) return [];
    const at = this.now();
    const manifests = this.d.language?.() === 'en' ? DEFAULT_MANIFESTS_EN : DEFAULT_MANIFESTS;
    return ROLES.map(([id, name, purpose, instructions, icon]) => upgradeProfile({ id: `default-${id}`, name, purpose, instructions, manifest: checkedManifest(manifests[id]), engine: e.engine, model: null, avatar: { kind: 'symbol', value: icon }, createdAt: at, updatedAt: at }, true, 'preset'));
  }
  /** The coordinator seed follows the starters' engine, so login discovery rebinds and seeds it like them. */
  private orchestratorSeed(base: AgentProfile | undefined): AgentProfile | null {
    if (!base) return null;
    const at = this.now();
    const coordinator = upgradeProfile({ id: ORCHESTRATOR_AGENT_ID, name: 'Orchestrator', purpose: ORCHESTRATOR_PURPOSE,
      instructions: ORCHESTRATOR_INSTRUCTIONS, engine: base.engine, model: null, avatar: { kind: 'symbol', value: 'compass' }, createdAt: at, updatedAt: at }, true, 'preset');
    // Same origin shape as the packaged role presets: its own id, revision 1 (not a legacy-* seed).
    return { ...coordinator, origin: { kind: 'preset', presetId: ORCHESTRATOR_AGENT_ID, presetRevision: 1 }, routable: false };
  }
  /** Size-checked before any history write, so a refused save leaves no version behind. */
  private body(next: AgentProfile[]) {
    const body = { version: 2, profiles: next, legacyRouting: this.legacyRouting };
    if (Buffer.byteLength(JSON.stringify(body, null, 2), 'utf8') + 1 > 8_000_000) throw new Error('Il catalogo è troppo grande. Riduci le immagini prima di aggiungere altri Agenti.');
    return body;
  }
  private writable(): void {
    const problem = this.problem ?? this.store.problem;
    if (problem) throw new Error(problem);
  }
  /** History first: a catalog never points to a version without its snapshot. */
  private commit(next: AgentProfile[], versions: AgentVersion[], states: Parameters<AgentHistory['commit']>[1] = []): void {
    const body = this.body(next);
    if (versions.length || states.length) this.store.commit(versions, states);
    writeLocal(this.file, body);
    this.profiles = next;
    this.d.emit?.(this.list());
  }
  private find(id: string): AgentProfile {
    const p = this.profiles.find(x => x.id === id);
    if (!p) throw new Error('Agente non trovato.');
    return p;
  }
  list(): AgentCatalog {
    this.refreshDefaults();
    return structuredClone({ presetUpdates: this.presetUpdates(), profiles: this.profiles.filter(p => p.status === 'active'), archived: this.profiles.filter(p => p.status === 'archived'), models: this.d.models(), problem: this.problem ?? this.store.problem, legacyRouting: this.legacyRouting,
      imageGeneration: { available: false as const, reason: 'Nessun servizio di generazione immagini è collegato. Scegli un simbolo o carica un’immagine.' } });
  }
  /** Rebind only pristine, never-edited seeds and presets after asynchronous login discovery. Customized versions stay pinned. */
  private refreshDefaults(): void {
    if (this.problem || this.store.problem) return;
    const starters = this.defaults(), coordinator = this.orchestratorSeed(starters[0]);
    if (!coordinator) return;
    const seeds = [...starters, coordinator];
    const models = this.d.models(), routes = this.d.legacyRoutes?.() ?? [];
    const changed: AgentProfile[] = [];
    const next = this.profiles.map(p => {
      const current = models.find(e => e.engine === p.engine);
      const seed = seeds.find(s => s.id === p.id);
      const origin = p.origin;
      // A preset is rebound only while it is exactly the packaged revision (its fingerprint still matches).
      const preset = !seed && origin.kind === 'preset' && !p.trial && p.presetHash === presetHash(p)
        ? roleAgentPresets().find(r => r.id === origin.presetId && r.presetRevision === origin.presetRevision) : undefined;
      const target = seed ?? (preset ? presetDraft(preset, models, routes) : null);
      if (!target || target.engine === p.engine) return p;
      const preferred = models.find(e => e.engine === target.engine);
      const readyAlternative = preferred?.installed === true && preferred.authenticated === true;
      if (current?.enabled && current.trusted && current.installed !== false && current.authenticated !== false
        && (current.authenticated === true || !readyAlternative)) return p;
      if (p.origin.kind !== 'preset' || p.userLocked || p.lastEditedBy !== 'preset' || p.status !== 'active') return p;
      const updated: AgentProfile = { ...p, engine: target.engine, version: p.version + 1, activeVersion: p.version + 1, updatedAt: Math.max(this.now(), p.updatedAt + 1) };
      if (preset) { updated.model = target.model; updated.effort = target.effort; updated.presetHash = presetHash(updated); }
      changed.push(updated); return updated;
    });
    // Seed the starters only into a catalog born without any (no engine was usable then). A catalog that already holds a
    // starter keeps the user's choice: a starter they never had or removed is not brought back. Generale does not count:
    // ensureGeneral recreates it on its own (an agentless chat), possibly before this first seeding.
    const unseeded = !next.some(p => p.id !== GENERAL_AGENT_ID && starters.some(s => s.id === p.id));
    // The Orchestrator is an additive seed: it arrives whenever it is missing and an engine is usable.
    for (const seed of unseeded ? seeds : [coordinator]) if (!next.some(p => p.id === seed.id) && next.length < MAX_AGENTS && next.filter(p => p.status === 'active').length < MAX_ACTIVE_AGENTS) { next.push(seed); changed.push(seed); }
    if (changed.length) {
      try {
        this.commit(next, changed.map(p => ({ ...firstVersion(p, 'preset', 'Motore iniziale disponibile', this.now()), version: p.version,
          parentVersion: this.profiles.find(old => old.id === p.id)?.activeVersion ?? null })),
        changed.flatMap(p => { const old = this.profiles.find(x => x.id === p.id); return old ? [{ agentId: old.id, version: old.activeVersion, state: 'superseded' as const }] : []; }));
      }
      catch (e) { log.warn('agents', 'starter engine refresh failed', { cause: errText(e), hint: 'check the local catalog is writable' }); return; }
      // A catalog seeded only now gets its presets now, and retires the starters it never showed silently.
      if (unseeded) { this.fresh = true; this.installPresets(); }
    }
  }
  private validate(value: unknown, current: boolean): CheckedDraft {
    const p = obj(value);
    const engine = text(p.engine, 60, 'Motore');
    if (!/^[a-z][a-z0-9_-]*$/.test(engine)) throw new Error('Motore non valido.');
    if (!(p.model === null || typeof p.model === 'string' && MODEL.test(p.model))) throw new Error('Modello non valido.');
    if (p.effort !== undefined && !(EFFORTS as readonly unknown[]).includes(p.effort)) throw new Error('Effort non valido.');
    if (current) {
      const e = this.d.models().find(x => x.engine === engine);
      if (!e) throw new Error('Il motore selezionato non è disponibile nel catalogo.');
      if (p.model !== null && !e.modelSelectable) throw new Error(e.modelReason ?? 'La scelta del modello non è supportata da questo adattatore. Usa il default CLI.');
      if (p.model === null ? !e.defaultModel : !e.models.some(m => m.id === p.model)) throw new Error('Il modello non è tra quelli noti del motore. Aggiorna le disponibilità o scegli il default CLI.');
      if (p.effort !== undefined && !e.effort) throw new Error('Questo motore non supporta la scelta dell’effort.');
      // the API engine has no tools: a policy that lists any beyond reading describes something it cannot do
      const tools = obj(p.tools).allow;
      if (engineOf(engine)?.kind === 'api' && Array.isArray(tools) && tools.some(c => c !== 'read')) throw new Error('Il motore API non ha strumenti: lascia solo la lettura o scegli un altro motore.');
    }
    const manifest = checkedManifest(p.manifest);
    const purpose = text(p.purpose, 400, 'Scopo');
    if (p.category !== undefined && !has(AGENT_CATEGORIES, p.category)) throw new Error(`Categoria non valida: ${AGENT_CATEGORIES.join(' | ')}.`);
    if (!(p.permissionCeiling === undefined || p.permissionCeiling === null || has(PERMISSION_CEILINGS, p.permissionCeiling))) throw new Error('Limite dei permessi non valido.');
    if (!(p.maxContext === undefined || p.maxContext === null || Number.isSafeInteger(p.maxContext) && (p.maxContext as number) >= MAX_CONTEXT_RANGE.min && (p.maxContext as number) <= MAX_CONTEXT_RANGE.max))
      throw new Error(`Contesto massimo: un numero intero di token da ${MAX_CONTEXT_RANGE.min} a ${MAX_CONTEXT_RANGE.max}, oppure vuoto (l’impostazione dell’app).`);
    return { name: text(p.name, 80, 'Nome'), purpose, instructions: text(p.instructions, 8000, 'Istruzioni', true), engine, model: p.model as string | null,
      ...(manifest !== undefined ? { manifest } : {}),
      ...(p.knowhow !== undefined ? { knowhow: checkedKnowhow(p.knowhow) } : {}),
      ...(p.pack !== undefined ? { pack: checkedPackIdentity(p.pack) } : {}),
      ...(p.effort !== undefined ? { effort: p.effort as Effort } : {}), avatar: checkedAvatar(p.avatar, this.d.imageSize),
      role: p.role === undefined || p.role === '' ? purpose : text(p.role, 160, 'Ruolo'), category: (p.category ?? 'other') as AgentCategory,
      tools: checkedTools(p.tools), permissionCeiling: (p.permissionCeiling ?? null) as PermissionCeiling | null,
      ...(typeof p.maxContext === 'number' ? { maxContext: p.maxContext } : {}) };
  }
  /** Brother's edit. A behaviour change becomes a new active version; a cosmetic one (name, avatar, role…) saves in place. */
  validateDraft(value: unknown): AgentDraft { this.writable(); return this.validate(value, true); }
  save(value: unknown, id?: string, createdId?: string): AgentProfile {
    this.writable();
    const old = id === undefined ? undefined : this.find(id);
    if (old?.status === 'archived') throw new Error('Ripristina l’Agente prima di modificarlo.');
    const input = obj(value);
    // Old clients omit additive fields: keep the stored ones. An explicit empty manifest or null policy clears them.
    const kept = old ? Object.fromEntries((['manifest', 'role', 'category', 'tools', 'permissionCeiling', 'knowhow', 'pack', 'maxContext'] as const).filter(k => input[k] === undefined && old[k] !== undefined).map(k => [k, old[k]])) : {};
    const draft = this.validate({ ...input, ...kept }, true);
    if (createdId !== undefined && (!ID.test(createdId) || this.profiles.some(p => p.id === createdId))) throw new Error('Agent id already exists');
    if (!old && this.profiles.filter(p => p.status === 'active').length >= MAX_ACTIVE_AGENTS) throw new Error(`Il catalogo contiene già ${MAX_ACTIVE_AGENTS} Agenti attivi. Archiviane uno prima di crearne un altro.`);
    if (!old && this.profiles.length >= MAX_AGENTS) throw new Error(`Il catalogo ha raggiunto ${MAX_AGENTS} Agenti, archiviati compresi.`);
    const at = Math.max(this.now(), (old?.updatedAt ?? 0) + 1);
    let profile: AgentProfile, versions: AgentVersion[] = [], states: Parameters<AgentHistory['commit']>[1] = [];
    if (!old) {
      profile = { ...draft, id: createdId ?? `agent-${randomUUID()}`, createdAt: at, updatedAt: at, origin: { kind: 'user' }, version: 1, activeVersion: 1, lastEditedBy: 'user', userLocked: true, status: 'active' };
      versions = [firstVersion(profile, 'user', 'Creato da Brother', at)];
    } else {
      const { manifest: _m, effort: _e, maxContext: _mc, ...rest } = old;
      void _m; void _e; void _mc;
      profile = { ...rest, ...draft, updatedAt: at, lastEditedBy: 'user', userLocked: true };
      if (!sameBehaviour(draft, old)) {
        if (old.trial) throw new Error('C’è una prova in corso su questo Agente: chiudila prima di cambiarne il comportamento.');
        const version = old.version + 1;
        profile = { ...profile, version, activeVersion: version };
        versions = [{ agentId: old.id, version, parentVersion: old.activeVersion, behaviour: behaviourOf(draft), author: 'user', reason: 'Modificato da Brother', at, state: 'active' }];
        states = [{ agentId: old.id, version: old.activeVersion, state: 'superseded' }];
      }
      // Brother's edit ends a probation as kept (AGENTS-DESIGN §4.7 "Brother wins")
      if (inProbation(old)) {
        profile = { ...profile, probation: { ...old.probation!, keptBy: 'brother' } };
        states = [...states, { agentId: old.id, version: old.activeVersion, probation: this.decision('kept', 'brother', 'Modificato da Brother', at) }];
      }
    }
    this.commit(old ? this.profiles.map(p => p.id === old.id ? profile : p) : [...this.profiles, profile], versions, states);
    this.d.onCustomized?.();
    return structuredClone(profile);
  }
  duplicate(id: string): AgentProfile {
    const p = this.find(id);
    return this.save({ ...p, name: `${p.name.slice(0, 72)} (copia)` });
  }
  /** Separate automatic writer: callers cannot smuggle user authority through save(). */
  author(value: unknown, options: { reason: string; evidence: AgentEvidenceRef[]; id?: string; presetId?: string; requestItemId?: string; probation?: boolean; baseline?: number }): AgentProfile {
    this.writable();
    const old = options.id ? this.find(options.id) : undefined;
    if (old && (protectedAgent(old) || old.status !== 'active')) throw new Error('Protected or archived agent: propose the change instead.');
    const draft = this.validate(old ? { ...old, ...withoutPackFields(value) } : withoutPackFields(value), true);
    checkAuthorPolicy(draft, this.d.enabledMcp?.() ?? []);
    const base = old ?? (options.presetId ? this.profiles.find(x => x.id === options.presetId) : undefined);
    if (!old && (!base || base.origin.kind !== 'preset' || base.status !== 'active')) throw new Error(`Choose an active base preset: ${this.profiles.filter(x => x.origin.kind === 'preset' && x.status === 'active' && x.routable !== false && x.id !== ORCHESTRATOR_AGENT_ID).map(x => x.id).join(' | ') || 'none available'}.`);
    if (base?.tools && draft.tools?.allow.some(c => !base.tools!.allow.includes(c))) throw new Error('Automatic tools must be a subset of the base policy.');
    const at = Math.max(this.now(), (old?.updatedAt ?? 0) + 1);
    const reason = text(options.reason, 600, 'Reason');
    const origin = readOrigin({ kind: 'orchestrator', reason, evidence: options.evidence });
    if (!old) {
      if (!options.requestItemId) throw new Error('A verified task message is required.');
      if (this.profiles.length >= MAX_AGENTS || this.profiles.filter(p => p.status === 'active').length >= MAX_ACTIVE_AGENTS) throw new Error('Agent catalog limit reached.');
      const p: AgentProfile = { ...draft, id: `agent-${randomUUID()}`, createdAt: at, updatedAt: at, origin, version: 1, activeVersion: 1, lastEditedBy: 'orchestrator', userLocked: false, status: 'active', ...(options.probation ? { probation: { since: at, requestItemId: options.requestItemId } } : {}) };
      this.commit([...this.profiles, p], [firstVersion(p, 'orchestrator', reason, at)]);
      return structuredClone(p);
    }
    const changed = !sameBehaviour(old, draft);
    if (changed && old.trial) throw new Error('Finish the current trial first.');
    if (changed && this.history(old.id).some(v => v.author === 'orchestrator' && new Date(v.at).toDateString() === new Date(at).toDateString())) throw new Error('At most one behavioural change per agent per day.');
    if (changed && (options.baseline ?? 0) < 5) throw new Error('At least five verified baseline runs are required; propose the change instead.');
    const version = changed ? old.version + 1 : old.version;
    const p: AgentProfile = { ...withoutMaxContext(old), ...draft, updatedAt: at, lastEditedBy: 'orchestrator', version, activeVersion: changed ? version : old.activeVersion, ...(changed ? { trial: { version, baseline: old.activeVersion, startedAt: at } } : {}) };
    this.commit(this.profiles.map(x => x.id === p.id ? p : x), changed ? [{ agentId: p.id, version, parentVersion: old.activeVersion, behaviour: behaviourOf(draft), author: 'orchestrator', reason, at, state: 'trial' }] : []);
    return structuredClone(p);
  }

  /** Rollback is also an automatic write: protected definitions and unsafe historical policies stay protected. */
  authorRollback(id: string, version: number): AgentProfile {
    this.writable();
    const old = this.find(id), entry = this.store.get(id, version);
    if (old.origin.kind !== 'orchestrator' || protectedAgent(old) || old.status !== 'active') throw new Error('Only owned, unlocked active agents may be rolled back.');
    if (!entry || !count(version) || version >= old.activeVersion) throw new Error('Choose an earlier version.');
    // A version without know-how restores none: the newer skill files must not survive the rollback.
    const draft = this.validate({ ...old, manifest: undefined, effort: undefined, knowhow: undefined, maxContext: undefined, ...entry.behaviour }, true);
    checkAuthorPolicy(draft, this.d.enabledMcp?.() ?? []);
    const { trial: _trial, knowhow: _k, ...rest } = old; void _trial; void _k;
    const p: AgentProfile = { ...rest, ...draft, activeVersion: version, updatedAt: Math.max(this.now(), old.updatedAt + 1), lastEditedBy: 'orchestrator' };
    this.commit(this.profiles.map(x => x.id === id ? p : x), [], [{ agentId: id, version: old.activeVersion, state: old.trial ? 'rejected' : 'superseded' }, { agentId: id, version, state: 'active' }]);
    this.knowhowChanged(old, p);
    return structuredClone(p);
  }

  /** Persisted probation: one cause, either the task message that asked for the agent or the reviewed pack it came from. */
  private checkedProbation(value: unknown): AgentProbation {
    const p = obj(value), source = p.source === undefined ? undefined : obj(p.source), request = p.requestItemId;
    if (typeof p.since !== 'number' || !Number.isFinite(p.since) || !(p.keptBy === undefined || p.keptBy === 'brother')
      || !(request === undefined || typeof request === 'string' && !!request.trim() && request.length <= 200)
      || (request === undefined) === (source === undefined) || (source && source.kind !== 'import')) throw new Error('Prova dell’Agente non valida.');
    const pack = source ? checkedPackIdentity({ id: source.packId, revision: source.revision }) : undefined;
    return { since: p.since, ...(typeof request === 'string' ? { requestItemId: request } : {}),
      ...(pack ? { source: { kind: 'import' as const, packId: pack.id, revision: pack.revision } } : {}), ...(p.keptBy ? { keptBy: 'brother' as const } : {}) };
  }
  /** Main-only pack metadata update; never accepts a renderer-authored provenance object. */
  packIdentity(id: string, pack: AgentProfile['pack']): void {
    this.writable(); const old = this.find(id);
    const profile = { ...old, pack: checkedPackIdentity(pack) };
    this.commit(this.profiles.map(p => p.id === id ? profile : p), []);
  }
  /** Reviewed import/learning: untrusted author. A new agent starts the shared probation (keep/retire, AGENTS-DESIGN §4.7);
   *  a change to an existing one becomes a trial. */
  applyPack(value: AgentDraft, id: string, source: PackInstall['source'], update = false, origin?: AgentOrigin): AgentProfile {
    return this.applyPacks([{ value, id, source, update, origin }])[0]!;
  }
  validatePacks(items: PackInstall[]): void { this.preparePacks(items); }
  applyPacks(items: PackInstall[]): AgentProfile[] {
    const { profiles, entries, installed } = this.preparePacks(items);
    this.commit(profiles, entries); return structuredClone(installed);
  }
  private preparePacks(items: PackInstall[]) {
    const profiles = [...this.profiles], entries: AgentVersion[] = [], installed: AgentProfile[] = [];
    for (const { value, id, source, update = false, origin } of items) {
    this.writable();
    if (!ID.test(id)) throw new Error('Invalid imported identity');
    const old = profiles.find(p => p.id === id);
    if (update !== !!old || old?.trial || old?.status === 'archived' || (!old && source.kind !== 'import')) throw new Error('Import collision changed; inspect again');
    if (!old && profiles.filter(p => p.status === 'active' && inProbation(p)).length >= PROBATION_CAP) throw new Error('PROBATION_CAP');
    if (!old && (profiles.filter(p => p.status === 'active').length >= MAX_ACTIVE_AGENTS || profiles.length >= MAX_AGENTS)) throw new Error('Agent catalog full');
    const draft = this.validate(value, true), at = Math.max(this.now(), (old?.updatedAt ?? 0) + 1), version = (old?.version ?? 0) + 1;
    const probation = old ? old.probation : source.kind === 'import' ? this.checkedProbation({ since: at, source }) : undefined;
    const profile: AgentProfile = { ...draft, id, role: draft.role, category: draft.category, tools: draft.tools, permissionCeiling: draft.permissionCeiling,
      createdAt: old?.createdAt ?? at, updatedAt: at, origin: origin ?? old?.origin ?? { kind: 'user' }, version, activeVersion: version,
      lastEditedBy: 'orchestrator', userLocked: old?.userLocked ?? false, status: 'active', ...(old?.routable === false ? { routable: false } : {}), ...(probation ? { probation } : {}),
      ...(old ? { trial: { version, baseline: old.activeVersion, startedAt: at } } : {}) };
    const entry: AgentVersion = { agentId: id, version, parentVersion: old?.activeVersion ?? null, behaviour: behaviourOf(draft), author: 'orchestrator', reason: source.kind === 'import' ? 'Imported agent pack' : 'Approved learned rule', at, state: old ? 'trial' : 'active' };
    if (old) profiles[profiles.findIndex(p => p.id === id)] = profile; else profiles.push(profile);
    entries.push(entry); installed.push(profile);
    }
    this.body(profiles);
    return { profiles, entries, installed };
  }
  /** Ends the open trial of a pack update or an approved learned rule: keep its version, or roll back to the baseline. */
  resolveTrial(id: string, decision: 'keep' | 'rollback'): AgentProfile {
    this.writable(); const p = this.find(id);
    if (!['keep', 'rollback'].includes(decision) || !p.trial) throw new Error('No agent trial to resolve');
    const { trial, knowhow: _k, manifest: _m, effort: _e, maxContext: _mc, ...rest } = p;
    void _k; void _m; void _e; void _mc;
    const baseline = decision === 'rollback' ? this.store.get(id, trial.baseline) : undefined;
    if (decision === 'rollback' && !baseline) throw new Error('Missing trial baseline');
    const at = Math.max(this.now(), p.updatedAt + 1);
    const profile: AgentProfile = { ...rest, ...this.validate({ ...rest, ...behaviourOf(baseline?.behaviour ?? p) }, true),
      activeVersion: baseline?.version ?? p.activeVersion, updatedAt: at };
    const states: Parameters<AgentHistory['commit']>[1] = [{ agentId: id, version: p.activeVersion, state: decision === 'keep' ? 'kept' : 'rejected' }];
    if (baseline) states.push({ agentId: id, version: baseline.version, state: 'active' });
    this.commit(this.profiles.map(x => x.id === id ? profile : x), [], states);
    this.knowhowChanged(p, profile);
    return structuredClone(profile);
  }
  /** A behavioural change applied as a trial (an Orchestrator agent_update, applied at once since ADR 0082 unless it touches
   *  tools, permissions or the engine; a cheaper-model trial; the user's approval of a queued proposal): a new version on
   *  trial against the active one, measured by the lifecycle (trials.ts) until it is kept or rolled back. Callers:
   *  AgentAuthoring (applyNow, decide) and the lifecycle's decide; know-how and pack identity are never taken from the
   *  proposal. */
  approveTrial(id: string, value: unknown, reason: string): AgentProfile {
    this.writable();
    const old = this.find(id);
    if (old.status !== 'active') throw new Error('Ripristina l’Agente prima di modificarlo.');
    if (old.trial) throw new Error('C’è una prova in corso su questo Agente: chiudila prima di cambiarne il comportamento.');
    const { knowhow: _k, pack: _p, ...input } = obj(value); void _k; void _p;
    const draft = this.validate({ ...old, ...withoutPackFields(input) }, true);
    if (sameBehaviour(old, draft)) throw new Error('La proposta non cambia il comportamento dell’Agente.');
    const at = Math.max(this.now(), old.updatedAt + 1), version = old.version + 1;
    const p: AgentProfile = { ...withoutMaxContext(old), ...draft, knowhow: old.knowhow, updatedAt: at, lastEditedBy: 'user', version, activeVersion: version, trial: { version, baseline: old.activeVersion, startedAt: at } };
    if (p.knowhow === undefined) delete p.knowhow;
    this.commit(this.profiles.map(x => x.id === id ? p : x), [{ agentId: id, version, parentVersion: old.activeVersion, behaviour: behaviourOf(p), author: 'orchestrator', reason: text(reason, 600, 'Reason'), at, state: 'trial' }]);
    this.d.onCustomized?.();
    return structuredClone(p);
  }
  /** Out of the launch list and the active limit; definition and history stay. */
  archive(id: string): AgentProfile {
    if (id === 'default-pulse') throw new Error('Battito si spegne nelle Impostazioni, non si archivia.');
    this.writable();
    const p = this.find(id);
    if (id === GENERAL_AGENT_ID) throw new Error(GENERAL_LOCKED);
    if (p.status === 'archived') return structuredClone(p);
    if (p.trial) throw new Error('C’è una prova in corso su questo Agente: chiudila prima di archiviarlo.');
    const at = Math.max(this.now(), p.updatedAt + 1);
    const profile: AgentProfile = { ...p, status: 'archived', archivedAt: at, updatedAt: at };
    this.commit(this.profiles.map(x => x.id === id ? profile : x), []);
    return structuredClone(profile);
  }
  /** A restore is Brother's choice: a retired probation agent comes back kept, or the evaluator would retire it again. */
  restore(id: string): AgentProfile {
    this.writable();
    const p = this.find(id);
    if (p.status === 'active') return structuredClone(p);
    if (this.profiles.filter(x => x.status === 'active').length >= MAX_ACTIVE_AGENTS) throw new Error(`Ci sono già ${MAX_ACTIVE_AGENTS} Agenti attivi. Archiviane uno prima di ripristinare questo.`);
    const { archivedAt: _a, ...rest } = p;
    void _a;
    const at = Math.max(this.now(), p.updatedAt + 1);
    const judged = inProbation(p);
    const profile: AgentProfile = { ...rest, status: 'active', updatedAt: at, ...(judged ? { probation: { ...p.probation!, keptBy: 'brother' as const } } : {}) };
    this.commit(this.profiles.map(x => x.id === id ? profile : x), [], judged ? [{ agentId: id, version: p.activeVersion, probation: this.decision('kept', 'brother', 'Ripristinato da Brother', at) }] : []);
    return structuredClone(profile);
  }
  private decision(decision: AgentProbationDecision['decision'], by: AgentProbationDecision['by'], reason: string, at: number): AgentProbationDecision {
    return { decision, by, reason: reason.slice(0, 600), at };
  }
  /**
   * Ends a probation as kept (AGENTS-DESIGN §4.7). Brother's Tieni marks it `keptBy: 'brother'`; the evaluator removes it,
   * so the agent becomes a normal catalog agent. The decision goes on the active version's history entry.
   */
  keep(id: string, by: AgentProbationDecision['by'] = 'brother', reason?: string): AgentProfile {
    this.writable();
    const p = this.find(id);
    if (!inProbation(p)) throw new Error('Questo Agente non è in prova.');
    if (p.status === 'archived') throw new Error('L’Agente è già stato ritirato: ripristinalo per tenerlo.');
    const at = Math.max(this.now(), p.updatedAt + 1);
    const { probation: _p, ...rest } = p;
    void _p;
    const profile: AgentProfile = by === 'brother' ? { ...p, probation: { ...p.probation!, keptBy: 'brother' }, updatedAt: at } : { ...rest, updatedAt: at };
    this.commit(this.profiles.map(x => x.id === id ? profile : x), [], [{ agentId: id, version: p.activeVersion, probation: this.decision('kept', by, reason ?? (by === 'brother' ? 'Tenuto da Brother' : 'Prova superata'), at) }]);
    return structuredClone(profile);
  }
  /** Ends a probation as retired: archived at once, `probation` kept for the 14-day no-recreate check. */
  retire(id: string, reason: string, by: AgentProbationDecision['by'] = 'brother'): AgentProfile {
    this.writable();
    if (id === GENERAL_AGENT_ID) throw new Error(GENERAL_LOCKED);
    const p = this.find(id);
    if (!inProbation(p)) throw new Error('Questo Agente non è in prova: archivialo invece di ritirarlo.');
    if (p.status === 'archived') return structuredClone(p);
    if (p.trial) throw new Error('C’è una prova in corso su questo Agente: chiudila prima di ritirarlo.');
    const why = typeof reason === 'string' && reason.trim() ? reason.trim() : by === 'brother' ? 'Ritirato da Brother' : 'Prova non superata';
    const at = Math.max(this.now(), p.updatedAt + 1);
    const profile: AgentProfile = { ...p, status: 'archived', archivedAt: at, updatedAt: at };
    this.commit(this.profiles.map(x => x.id === id ? profile : x), [], [{ agentId: id, version: p.activeVersion, probation: this.decision('retired', by, why, at) }]);
    return structuredClone(profile);
  }
  history(id: string): AgentVersion[] {
    this.find(id);
    return this.store.list(id);
  }
  /** Brother's Undo of an automatic behavioural change: the trial version is rejected and its baseline is active again. */
  rejectTrial(id: string, baseline: number): AgentProfile {
    this.writable();
    const p = this.find(id);
    if (!p.trial || p.trial.version !== p.activeVersion || p.trial.baseline !== baseline) throw new Error('Nessuna prova da annullare su questa versione.');
    const entry = this.store.get(id, baseline);
    if (!entry) throw new Error('Questa versione non è più nella cronologia.');
    const { manifest: _m, effort: _e, maxContext: _mc, trial: _t, knowhow: _k, ...rest } = p;
    void _m; void _e; void _mc; void _t; void _k;
    const draft = this.validate({ ...rest, ...entry.behaviour }, true);
    const at = Math.max(this.now(), p.updatedAt + 1);
    const profile: AgentProfile = { ...rest, ...draft, activeVersion: baseline, updatedAt: at, lastEditedBy: 'user', userLocked: true };
    this.commit(this.profiles.map(x => x.id === id ? profile : x), [], [{ agentId: id, version: p.activeVersion, state: 'rejected' }, { agentId: id, version: baseline, state: 'active' }]);
    this.knowhowChanged(p, profile);
    this.d.onCustomized?.();
    return structuredClone(profile);
  }
  /** A maintenance job's change (ADR 0077: no approval for agent changes, every change logged with a rollback by
   *  brainmodel/changes.ts): only the role text (a lesson from the user's corrections) or the declared skills
   *  (know-how). Tools, permissions, engine and model are never changed here (tools, permissions and engine are the user's,
   *  ADR 0082; model and effort change through the Orchestrator's agent_update, as a trial).
   *  A new active version authored "maintenance"; null when nothing changes. Refused during an open trial. */
  maintain(id: string, patch: { instructions?: string; knowhow?: AgentProfile['knowhow'] }, reason: string): { profile: AgentProfile; before: number } | null {
    this.writable();
    const old = this.find(id);
    if (old.status !== 'active') throw new Error('Archived agent');
    if (old.trial) throw new Error('Open trial: maintenance waits');
    if (Object.keys(patch).some(k => k !== 'instructions' && k !== 'knowhow')) throw new Error('Maintenance changes only the role and the skills');
    const { manifest: _m, effort: _e, ...rest } = old; void _m; void _e;
    const draft = this.validate({ ...old, ...(patch.instructions !== undefined ? { instructions: patch.instructions } : {}), ...(patch.knowhow !== undefined ? { knowhow: patch.knowhow } : {}) }, true);
    if (sameBehaviour(old, draft)) return null;
    const at = Math.max(this.now(), old.updatedAt + 1), version = old.version + 1;
    const profile: AgentProfile = { ...rest, ...draft, updatedAt: at, lastEditedBy: 'maintenance', version, activeVersion: version };
    if (profile.knowhow === undefined) delete profile.knowhow;
    this.commit(this.profiles.map(x => x.id === id ? profile : x), [{ agentId: id, version, parentVersion: old.activeVersion, behaviour: behaviourOf(draft), author: 'maintenance', reason: text(reason, 600, 'Reason'), at, state: 'active' }],
      [{ agentId: id, version: old.activeVersion, state: 'superseded' }]);
    this.knowhowChanged(old, profile);
    return { profile: structuredClone(profile), before: old.activeVersion };
  }
  /** Undo of a maintenance change: the version before it is active again (the user's click in a change log). */
  maintainRestore(id: string, version: number, expected: number): AgentProfile {
    this.writable();
    const p = this.find(id);
    if (p.activeVersion !== expected) throw new Error('The agent changed since: undo the newer change first');
    if (p.trial || p.status !== 'active') throw new Error('Open trial or archived agent');
    const entry = this.store.get(id, version);
    if (!entry) throw new Error('Version no longer in the history');
    const { manifest: _m, effort: _e, knowhow: _k, ...rest } = p; void _m; void _e; void _k;
    const draft = this.validate({ ...rest, ...entry.behaviour }, true);
    const at = Math.max(this.now(), p.updatedAt + 1);
    const profile: AgentProfile = { ...rest, ...draft, activeVersion: version, updatedAt: at, lastEditedBy: 'maintenance' };
    this.commit(this.profiles.map(x => x.id === id ? profile : x), [], [{ agentId: id, version: p.activeVersion, state: 'rejected' }, { agentId: id, version, state: 'active' }]);
    this.knowhowChanged(p, profile);
    return structuredClone(profile);
  }
  /** Makes an older version the one new runs use. The next edit records it as the parent. */
  restoreVersion(id: string, version: number): AgentProfile {
    this.writable();
    const p = this.find(id);
    if (p.status === 'archived') throw new Error('Ripristina l’Agente prima di cambiarne la versione.');
    if (p.trial) throw new Error('C’è una prova in corso su questo Agente: chiudila prima di cambiare versione.');
    if (!count(version) || version > p.version) throw new Error('Versione non valida.');
    if (version === p.activeVersion) return structuredClone(p);
    const entry = this.store.get(id, version);
    if (!entry) throw new Error('Questa versione non è più nella cronologia.');
    const { manifest: _m, effort: _e, maxContext: _mc, knowhow: _k, ...rest } = p;
    void _m; void _e; void _mc; void _k;
    // Same availability checks as a save: an engine or model that is gone is refused, never replaced.
    const draft = this.validate({ ...rest, ...entry.behaviour }, true);
    const at = Math.max(this.now(), p.updatedAt + 1);
    const judged = inProbation(p);
    const profile: AgentProfile = { ...rest, ...draft, activeVersion: version, updatedAt: at, lastEditedBy: 'user', userLocked: true, ...(judged ? { probation: { ...p.probation!, keptBy: 'brother' as const } } : {}) };
    this.commit(this.profiles.map(x => x.id === id ? profile : x), [], [{ agentId: id, version: p.activeVersion, state: 'superseded', ...(judged ? { probation: this.decision('kept', 'brother', 'Versione cambiata da Brother', at) } : {}) }, { agentId: id, version, state: 'active' }]);
    this.knowhowChanged(p, profile);
    this.d.onCustomized?.();
    return structuredClone(profile);
  }
  /** maxContext = the agent's "Contesto massimo" (tokens) for its chat's engine, absent = the user's setting (#80). */
  resolve(req: NewChat): { request: NewChat; owner: AgentOwnerSnapshot; instructions: string; policy: AgentPolicy | null; assets?: { pluginDir: string; skillRoot: string }; maxContext?: number } {
    if (req.agentId === ORCHESTRATOR_AGENT_ID && !req.orchestrator) throw new Error('Orchestrator è il coordinatore: apri la chat Orchestrator, non una chat di lavoro.');
    if (req.agentId === undefined) {
      const compatible = { request: req, owner: compatibleOwner(req.harness, req.model ?? null), instructions: '', policy: null };
      // The Orchestrator is no agent's run (no run, no metrics): it keeps the selected harness/model and takes only the
      // preset's instructions and policy.
      if (req.orchestrator) {
        const p = this.profiles.find(x => x.id === ORCHESTRATOR_AGENT_ID && x.status === 'active');
        if (!p) return { ...compatible, owner: orchestratorOwner(compatible.owner), instructions: ORCHESTRATOR_INSTRUCTIONS };
        return { ...compatible, owner: orchestratorOwner(compatible.owner, p), instructions: p.instructions,
          policy: p.tools || p.permissionCeiling ? { tools: p.tools ? structuredClone(p.tools) : null, ceiling: p.permissionCeiling ?? null } : null };
      }
      const g = this.ensureGeneral();
      if (!g) {
        log.warn('agents', 'Generale is unavailable: the chat starts without an agent run', { hint: this.problem ?? this.store.problem ?? 'no default engine to recreate it from' });
        return compatible;
      }
      // engine, model and effort stay the chat's (Brother's choice or the routing table); a null ceiling = his settings
      return { request: req, owner: { ...ownerOf(g), engine: req.harness, model: req.model ?? null }, instructions: g.instructions,
        policy: g.tools || g.permissionCeiling ? { tools: g.tools ? structuredClone(g.tools) : null, ceiling: g.permissionCeiling ?? null } : null,
        ...(typeof g.maxContext === 'number' ? { maxContext: g.maxContext } : {}) };
    }
    const p = this.profiles.find(x => x.id === req.agentId);
    if (!p) throw new Error('L’Agente selezionato non esiste più. Scegline un altro.');
    if (req.agentVersion !== undefined && req.agentVersion !== p.activeVersion) throw new Error('Agent version changed. Read the definition again before starting.');
    if (p.status === 'archived') throw new Error('L’Agente selezionato è archiviato. Ripristinalo o scegline un altro.');
    // Validate known availability again at launch, without falling back to another engine/model.
    this.validate(p, true);
    if (p.lastEditedBy === 'orchestrator') {
      checkAuthorPolicy(p, this.d.enabledMcp?.() ?? []);
      checkAgentCwd(req.cwd, this.d.approvedRoots?.() ?? []);
    }
    const e = this.d.models().find(x => x.engine === p.engine)!;
    if (!e.enabled || !e.trusted) throw new Error('Il motore dell’Agente è spento o deve essere riconfermato nelle Impostazioni.');
    // Agent first (ADR 0078): the profile decides; where it names no model (or no effort) the chat may bring one, the
    // routing table's default for this kind of work. A named value that differs from the profile's is refused.
    if (req.harness !== p.engine || req.model !== undefined && p.model !== null && req.model !== p.model || req.effort !== undefined && p.effort !== undefined && req.effort !== p.effort) throw new Error('La configurazione della nuova chat non corrisponde all’Agente scelto.');
    const { model: _model, effort: _effort, ...rest } = req;
    void _model; void _effort;
    const model = p.model ?? req.model, effort = p.effort ?? req.effort;
    return { request: { ...rest, ...(model ? { model } : {}), ...(effort ? { effort } : {}) }, owner: ownerOf(p), instructions: p.instructions, policy: p.tools || p.permissionCeiling ? { tools: p.tools ? structuredClone(p.tools) : null, ceiling: p.permissionCeiling ?? null } : null,
      ...(typeof p.maxContext === 'number' ? { maxContext: p.maxContext } : {}) };
  }
}
