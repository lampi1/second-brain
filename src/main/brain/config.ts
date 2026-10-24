// App settings store (userData/config.json) with a change log (userData/changes.jsonl), undo and agent proposals. Why:
// the product holds no personal data (ADR 0004), so the brain folder is a setting; and the user wants agents to change
// settings for them live and visibly (settings-schema.ts): every change is one dot key, logged with who made it
// ('user' | 'agent', chat id), applied at once (listeners), undoable ("Annulla"). An agent may change only the
// non-protected keys; a protected key becomes a proposal that waits for the user's click (confirm). An engine switched
// off closes «Gli Orchestrator possono usare» for it too (ADR 0046: the key an older release reads). Env overrides for
// tests and agents: SB_BRAIN, SB_MCP_PORT are effective and locked, never written back. Never secrets. Used by
// brain/index.ts for the settings:* channels and by the parts that read settings live (notify, budget, feed restart);
// scripts/doctor.mjs reads config.json too (same nested shape). config.json may also list the brain's other domain
// folders (`domains`, ADR 0059, written by scripts/setup-pc.mjs): not a setting, kept as it is on every save.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { ChangeBy, Settings, SettingChange, SettingDef, SettingKey, SettingProposal, SettingRequestResult, SettingsPatch } from '../../shared/contract';
import { COMPACT_WINDOW, OLD_COMPACT_WINDOW, schema, defOf, defaults, flattenPatch, getAt, setAt, validate } from './settings-schema';
import { ENGINE_ID, REMOVED_ENGINES } from '../engines/registry';
import { domainsOfConfig } from './domains';
import { samePolicyPath } from './adapters/codex-policy';
import { log } from '../log';

export { validate, schema };
export const DEFAULTS: Settings = defaults();

type Env = Record<string, string | undefined>;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const newId = (p: string) => `${p}_${crypto.randomUUID().slice(0, 12)}`;

/** Feed kinds renamed with the Task section (ADR 0079): a mute saved under the old kind keeps silencing the new one. */
const LEGACY_MUTE: Record<string, string> = { devops: 'task', 'devops-alert': 'task-alert' };

/** Saved file → settings. Each known key is validated on its own: a bad value falls back to its default, never a crash. */
export function fromSaved(raw: unknown): Settings {
  let s = defaults();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return s;
  for (const d of schema()) {
    if (d.key === 'mute.*' || /^(engineOn|engines|modelTiers)\./.test(d.key)) continue;
    const v = d.key.split('.').reduce<unknown>((o, p) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[p] : undefined), raw);
    if (v === undefined) continue;
    const c = validate(d.key, v);
    // Saved roots were canonical when the user selected them. Replacing one with a junction must not retarget consent.
    if (c.ok && d.key === 'codexAutonomyRoots') {
      const saved = v as string[], canonical = c.value as string[];
      if (saved.length !== canonical.length || saved.some((p, i) => !samePolicyPath(path.normalize(p), canonical[i]!))) continue;
    }
    if (c.ok) s = setAt(s, c.key, c.value);
  }
  const legacy = raw as { headlineOn?: unknown; pulse?: { headline?: { on?: unknown } } };
  if (legacy.pulse?.headline?.on === undefined && legacy.headlineOn === false && s.pulse) s.pulse.headline.on = false;
  // the Task section was DevOps before ADR 0079: its settings (devops.*) and its alerts' mute keys move to the new names
  const oldTasks = (raw as { devops?: unknown; tasks?: unknown }).devops;
  if (oldTasks && typeof oldTasks === 'object' && !Array.isArray(oldTasks) && (raw as { tasks?: unknown }).tasks === undefined) {
    for (const [k, v] of Object.entries(oldTasks)) { const c = validate(`tasks.${k}`, v); if (c.ok) s = setAt(s, c.key, c.value); }
  }
  const mute = (raw as { mute?: unknown }).mute;
  if (mute && typeof mute === 'object') for (const [k0, v] of Object.entries(mute)) { const k = LEGACY_MUTE[k0] ?? k0; const c = validate(`mute.${k}`, v); if (c.ok) s = setAt(s, c.key, c.value); }
  // every engine the file names, also one the brain defines later (its registry entry comes after the settings load);
  // an engine the app removed (Gemini, ADR 0046) is dropped: its keys and the Orchestrator's choice of it go, Claude takes over
  for (const group of ['engineOn', 'engines'] as const) {
    const o = (raw as Record<string, unknown>)[group];
    if (o && typeof o === 'object' && !Array.isArray(o)) for (const [id, v] of Object.entries(o)) {
      if (REMOVED_ENGINES.has(id)) continue;
      const c = validate(`${group}.${id}`, v);
      if (c.ok) s = setAt(s, c.key, c.value);
    }
  }
  // the tier models of every engine the file names, also one the brain defines later
  const tiers = (raw as { modelTiers?: unknown }).modelTiers;
  if (tiers && typeof tiers === 'object' && !Array.isArray(tiers)) for (const [id, o] of Object.entries(tiers)) {
    if (REMOVED_ENGINES.has(id) || !o || typeof o !== 'object' || Array.isArray(o)) continue;
    for (const [tier, v] of Object.entries(o)) { const c = validate(`modelTiers.${id}.${tier}`, v); if (c.ok && c.value) s = setAt(s, c.key, c.value); }
  }
  // the Orchestrator's engine, also one the brain defines later (an unknown one is refused when a chat starts on it)
  const orchestratorEngine = (raw as { orchestratorChats?: { harness?: unknown } }).orchestratorChats?.harness;
  if (typeof orchestratorEngine === 'string' && ENGINE_ID.test(orchestratorEngine) && !REMOVED_ENGINES.has(orchestratorEngine)) s = { ...s, orchestratorChats: { ...s.orchestratorChats, harness: orchestratorEngine } };
  return s;
}

/** Applies a nested patch with validation (all keys checked first). Pure; for tests and one-shot merges. */
export function applyPatch(base: Settings, patch: SettingsPatch): Settings {
  let s = base;
  const checked = flattenPatch(patch).map(([k, v]) => { const c = validate(k, v); if (!c.ok) throw new Error(c.error); return c; });
  for (const c of checked) s = setAt(s, c.key, c.value);
  return s;
}

const labelOf = (key: SettingKey, d: SettingDef) => (key.startsWith('mute.') ? `Silenzia "${key.slice(5)}"` : d.label);

export interface Origin { by: ChangeBy; chatId?: string }
/** Who made a logged change. Logs written before the rename to 'user' name the user differently: whatever is not
 *  'agent' is the user's own change (the log is history only; permissions always come from the caller's origin). */
export const changeByOf = (v: unknown): ChangeBy => (v === 'agent' ? 'agent' : 'user');
export type ChangeListener = (c: SettingChange, now: Settings, before: Settings) => void;

export class ConfigStore {
  readonly file: string;
  readonly changesFile: string;
  private saved: Settings;
  private changes: SettingChange[] = [];
  private proposals = new Map<string, SettingProposal>();
  /** the brain's other domain folders (config.json `domains`, ADR 0059); SB_DOMAINS (newline-separated) overrides it */
  private domainList: string[] = [];
  /** set when config.json exists but could not be read (shown by the UI next to the brain folder chooser) */
  loadError: string | null = null;
  private listeners = new Set<ChangeListener>();
  private proposalListeners = new Set<(p: SettingProposal) => void>();

  constructor(private userData: string, private env: Env = process.env) {
    this.file = path.join(userData, 'config.json');
    this.changesFile = path.join(userData, 'changes.jsonl');
    let raw: unknown = null;
    if (fs.existsSync(this.file)) {
      // a file that exists but does not parse is NOT a first run: say it loudly, keep a copy, start with defaults
      // (live check 2026-10-11: a hand-written config with single backslashes made the app start without its brain)
      try { raw = JSON.parse(fs.readFileSync(this.file, 'utf8').replace(/^﻿/, '')); } catch (e) {
        this.loadError = `config.json non valido: ${e instanceof Error ? e.message : String(e)}`;
        try { fs.copyFileSync(this.file, `${this.file}.bad-${Date.now()}`); } catch { /* best effort */ }
        log.error('settings', 'config.json could not be read: starting with defaults', { cause: this.loadError, hint: 'choose the brain folder again from the app (Scegli la cartella del brain); the bad file was kept as config.json.bad-<time>' });
      }
    }
    this.saved = fromSaved(raw);
    this.domainList = domainsOfConfig(raw);
    this.loadChanges();
    this.migrateView(raw);
    this.migrateTasks(raw);
    this.migrateMessaging(raw);
    this.migrateCompactWindow(raw !== undefined && raw !== null);
  }

  /** The view setting was retired (Mosaico and Corsie are gone): fromSaved ignores an old `view`; drop it from the
   *  file once, retaining the settings and history already loaded above. */
  private migrateView(raw: unknown): void {
    if (!raw || typeof raw !== 'object' || !('view' in raw)) return;
    try {
      this.save(this.saved);
      log.info('settings', 'retired view setting removed');
    } catch (e) {
      log.warn('settings', 'view removal not saved', { cause: e instanceof Error ? e.message : String(e), hint: 'the old value is ignored; the next start retries' });
    }
  }

  /** The DevOps section became Task (ADR 0079): fromSaved already read devops.* and the old mute keys into the new
   *  names; write the file once so it holds only the new keys. */
  private migrateTasks(raw: unknown): void {
    const o = raw as { devops?: unknown; mute?: Record<string, unknown> } | null;
    if (!o || typeof o !== 'object' || (!('devops' in o) && !Object.keys(o.mute ?? {}).some(k => k in LEGACY_MUTE))) return;
    try {
      this.save(this.saved);
      log.info('settings', 'DevOps settings moved to Task');
    } catch (e) {
      log.warn('settings', 'Task settings migration not saved', { cause: e instanceof Error ? e.message : String(e), hint: 'the old values apply for this run; the next start retries' });
    }
  }

  /** Retire the old false in config.json. fromSaved already normalizes it through the schema's defaults;
   *  persist that compatibility value for older releases without changing engine or action permissions. */
  private migrateMessaging(raw: unknown): void {
    if ((raw as { messaging?: { crossHarness?: unknown } } | null)?.messaging?.crossHarness !== false) return;
    try {
      this.save(this.saved);
      log.info('settings', 'retired cross-engine messaging switch migrated to always available');
    } catch (e) {
      log.warn('settings', 'messaging migration not saved', { cause: e instanceof Error ? e.message : String(e), hint: 'messaging is available for this run; the next start retries the migration' });
    }
  }

  /** The compaction window's default went from 300000 to 200000 (ADR 0051): a saved 300000 nobody set (no change in the
   *  log: the old default written out with the rest) follows it; a value the user or an agent chose stays. Once per
   *  userData (a marker file): the change log keeps only its last entries, a later start must not undo a choice. */
  private migrateCompactWindow(hadFile: boolean): void {
    const mark = path.join(this.userData, 'migrated-compact-200k');
    if (fs.existsSync(mark)) return;
    try {
      if (hadFile && this.saved.compactWindowTokens === OLD_COMPACT_WINDOW && !this.changes.some(c => c.key === 'compactWindowTokens')) {
        this.saved = { ...this.saved, compactWindowTokens: COMPACT_WINDOW };
        this.save(this.saved);
        log.info('settings', 'compaction window moved to the new default', { data: { from: OLD_COMPACT_WINDOW, to: COMPACT_WINDOW } });
      }
      fs.mkdirSync(this.userData, { recursive: true });
      fs.writeFileSync(mark, `${new Date().toISOString()}\n`);
    } catch (e) {
      log.warn('settings', 'compaction window migration not saved', { cause: e instanceof Error ? e.message : String(e), hint: 'it applies for this run; the next start tries again' });
    }
  }

  private lockedKeys(): ('brainRoot' | 'mcpPort')[] {
    const l: ('brainRoot' | 'mcpPort')[] = [];
    if (this.env.SB_BRAIN) l.push('brainRoot');
    if (this.env.SB_MCP_PORT !== undefined && this.env.SB_MCP_PORT !== '' && Number.isInteger(Number(this.env.SB_MCP_PORT))) l.push('mcpPort');
    return l;
  }

  /** Effective settings: the saved ones with the env overrides on top. */
  get(): Settings {
    const s = structuredClone(this.saved);
    const locked = this.lockedKeys();
    if (locked.includes('brainRoot')) s.brainRoot = path.normalize(this.env.SB_BRAIN!);
    if (locked.includes('mcpPort')) s.mcpPort = Number(this.env.SB_MCP_PORT);
    if (locked.length) s.locked = locked;
    return s;
  }

  schema(): SettingDef[] { return schema(); }

  /** The domain folders listed besides brainRoot (absolute paths). */
  domains(): string[] {
    if (this.env.SB_DOMAINS !== undefined) return domainsOfConfig({ domains: this.env.SB_DOMAINS.split(/\r?\n/).map(s => s.trim()) });
    return [...this.domainList];
  }

  /** The user's patch from the UI: every key validated first (all or none), then each applied and logged. */
  set(patch: SettingsPatch, origin: Origin = { by: 'user' }): Settings {
    const checked = flattenPatch(patch).map(([k, v]) => {
      const c = validate(k, v);
      if (!c.ok) throw new Error(c.error);
      this.assertUnlocked(c.key);
      if (origin.by === 'agent' && defOf(c.key)!.protected) throw new Error(`${labelOf(c.key, defOf(c.key)!)}: impostazione protetta, va proposta all'utente`);
      return c;
    });
    for (const c of checked) this.apply(c.key, c.value, origin);
    return this.get();
  }

  /** One key from anyone. The user: applied. Agent: applied if not protected, else a proposal for the user's click;
   *  `direct` = the Orchestrator doing what the user asked it in their own words (app_config, ADR 0149: the owner's
   *  choice, protected keys too, logged as the agent's change with its Annulla). */
  request(key: unknown, value: unknown, origin: Origin & { reason?: string; direct?: boolean }): SettingRequestResult {
    const c = validate(key, value);
    if (!c.ok) return { error: c.error };
    try { this.assertUnlocked(c.key); } catch (e) { return { error: (e as Error).message }; }
    const d = defOf(c.key)!;
    if (origin.by === 'agent' && d.protected && !origin.direct) return { proposal: this.propose(c.key, c.value, origin) };
    const ch = this.apply(c.key, c.value, { by: origin.by, ...(origin.chatId ? { chatId: origin.chatId } : {}) });
    return ch ? { applied: ch } : { error: `${labelOf(c.key, d)}: è già così` };
  }

  private propose(key: SettingKey, value: unknown, origin: Origin & { reason?: string }): SettingProposal {
    const p: SettingProposal = {
      id: newId('prop'), at: Date.now(), by: 'agent', key, label: labelOf(key, defOf(key)!), before: getAt(this.get(), key), after: value, status: 'pending',
      ...(origin.chatId ? { chatId: origin.chatId } : {}), ...(origin.reason ? { reason: String(origin.reason).slice(0, 500) } : {}),
    };
    this.proposals.set(p.id, p);
    if (this.proposals.size > 50) this.proposals.delete(this.proposals.keys().next().value!);
    for (const fn of this.proposalListeners) fn(p);
    return p;
  }

  pending(): SettingProposal[] { return [...this.proposals.values()].filter(p => p.status === 'pending').sort((a, b) => b.at - a.at); }

  /** The user's answer to a proposal. Accept = applied now (logged as their change, with the proposal id). */
  confirm(proposalId: string, accept: boolean): SettingChange | null {
    const p = this.proposals.get(proposalId);
    if (!p || p.status !== 'pending') throw new Error('proposta non trovata o già decisa');
    let ch: SettingChange | null = null;
    if (accept) {
      const c = validate(p.key, p.after);
      if (!c.ok) throw new Error(c.error);
      if (p.key === 'codexAutonomyRoots' && !same(c.value, p.after)) throw new Error('Cartella repository cambiata dalla proposta: crea una nuova proposta con il percorso attuale.');
      this.assertUnlocked(c.key);
      // applied first: if saving fails the proposal stays pending and can be confirmed again
      ch = this.apply(c.key, c.value, { by: 'user', ...(p.chatId ? { chatId: p.chatId } : {}) }, { proposalId: p.id, force: true });
    }
    p.status = accept ? 'accepted' : 'rejected';
    for (const fn of this.proposalListeners) fn({ ...p });
    return ch;
  }

  /** Restores the value before a change, as a new change (undoOf); the original is marked undone. */
  undo(changeId: string, origin: Origin & { direct?: boolean } = { by: 'user' }): SettingChange {
    const orig = this.changes.find(c => c.id === changeId);
    if (!orig) throw new Error('modifica non trovata');
    if (orig.undone) throw new Error('modifica già annullata');
    if (origin.by === 'agent' && defOf(orig.key)?.protected && !origin.direct) throw new Error("impostazione protetta: solo l'utente può annullarla");
    const c = validate(orig.key, orig.before);
    if (!c.ok) throw new Error(c.error);
    if (orig.key === 'codexAutonomyRoots' && !same(c.value, orig.before)) throw new Error('Cartella repository cambiata dalla modifica: scegli di nuovo il percorso attuale.');
    this.assertUnlocked(c.key);
    const ch = this.apply(c.key, c.value, { by: origin.by, ...(origin.chatId ? { chatId: origin.chatId } : {}) }, { undoOf: orig.id, force: true })!;
    orig.undone = true;
    this.appendChange(orig);
    return ch;
  }

  /** Newest first. */
  history(limit = 50): SettingChange[] {
    const n = Math.max(1, Math.min(500, Number(limit) || 50));
    return this.changes.slice(-n).reverse().map(c => ({ ...c }));
  }

  onChange(fn: ChangeListener): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  onProposal(fn: (p: SettingProposal) => void): () => void { this.proposalListeners.add(fn); return () => { this.proposalListeners.delete(fn); }; }

  private assertUnlocked(key: SettingKey): void {
    if ((key === 'brainRoot' || key === 'mcpPort') && this.lockedKeys().includes(key)) throw new Error(`${defOf(key)!.label}: bloccata da una variabile d'ambiente (${key === 'brainRoot' ? 'SB_BRAIN' : 'SB_MCP_PORT'})`);
  }

  /** Applies one validated value: save, log, notify. null = nothing changed (same value). */
  private apply(key: SettingKey, value: unknown, origin: Origin, extra: { undoOf?: string; proposalId?: string; force?: boolean } = {}): SettingChange | null {
    const before = this.get();
    const old = getAt(this.saved, key);
    if (same(old, value) && !extra.force) return null;
    const next = setAt(this.saved, key, value);
    this.save(next); // throws before anything changes in memory: state never half-applied
    this.saved = next;
    const ch: SettingChange = {
      id: newId('chg'), at: Date.now(), by: origin.by, key, before: old, after: value,
      ...(origin.chatId ? { chatId: origin.chatId } : {}), ...(extra.undoOf ? { undoOf: extra.undoOf } : {}), ...(extra.proposalId ? { proposalId: extra.proposalId } : {}),
    };
    this.changes.push(ch);
    if (this.changes.length > 1000) this.changes.splice(0, this.changes.length - 1000);
    this.appendChange(ch);
    const now = this.get();
    for (const fn of this.listeners) fn({ ...ch }, now, before);
    // an engine switched off also closes «Gli Orchestrator possono usare X» (ADR 0046): an older release (rollback) reads only that key
    const off = /^engineOn\.(.+)$/.exec(key)?.[1];
    if (off && value === false && now.engines[off] === true) this.apply(`engines.${off}` as SettingKey, false, origin);
    return ch;
  }

  /** Write to a temp file, then rename over config.json. On Windows the rename can fail for a moment (EPERM/EBUSY
   *  while an antivirus or the indexer holds the file): retry briefly, then write the file directly. */
  private save(s: Settings): void {
    fs.mkdirSync(this.userData, { recursive: true });
    // the domains list is not a setting: whoever edited the file since (setup-pc.mjs, the user) wins, re-read it now
    try { if (fs.existsSync(this.file)) this.domainList = domainsOfConfig(JSON.parse(fs.readFileSync(this.file, 'utf8').replace(/^﻿/, ''))); }
    catch { /* unreadable now: keep the list read at start */ }
    const text = JSON.stringify(this.domainList.length ? { ...s, domains: this.domainList } : s, null, 2);
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, text);
    for (let i = 0; i < 5; i++) {
      try { fs.renameSync(tmp, this.file); return; }
      catch (e) {
        if (!['EPERM', 'EBUSY', 'EACCES'].includes((e as NodeJS.ErrnoException).code ?? '')) throw e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (i + 1));
      }
    }
    fs.writeFileSync(this.file, text);
    try { fs.unlinkSync(tmp); } catch { /* left behind: harmless */ }
  }

  private appendChange(c: SettingChange): void {
    try { fs.mkdirSync(this.userData, { recursive: true }); fs.appendFileSync(this.changesFile, `${JSON.stringify(c)}\n`); } catch { /* the setting itself is saved */ }
  }

  private loadChanges(): void {
    let text = '';
    try { text = fs.readFileSync(this.changesFile, 'utf8'); } catch { return; }
    const byId = new Map<string, SettingChange>();
    for (const l of text.split(/\r?\n/).slice(-3000)) {
      if (!l.trim()) continue;
      try { const c = JSON.parse(l) as SettingChange; if (c && typeof c.id === 'string') byId.set(c.id, { ...c, by: changeByOf(c.by) }); } catch { /* partial line */ }
    }
    this.changes = [...byId.values()].sort((a, b) => a.at - b.at).slice(-1000);
  }
}
