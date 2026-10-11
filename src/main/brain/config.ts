// App settings store (userData/config.json) with a change log (userData/changes.jsonl), undo and agent proposals. Why:
// the product holds no personal data (ADR 0004), so the brain folder is a setting; and the user wants agents to change
// settings for them live and visibly (settings-schema.ts): every change is one dot key, logged with who made it
// ('user' | 'agent', chat id), applied at once (listeners), undoable ("Annulla"). An agent may change only the
// non-protected keys; a protected key becomes a proposal that waits for the user's click (confirm). Env overrides for
// tests and agents: SB_BRAIN, SB_MCP_PORT are effective and locked, never written back. Never secrets. Used by
// brain/index.ts for the settings:* channels and by the parts that read settings live (notify, budget, feed restart);
// scripts/doctor.mjs reads config.json too (same nested shape).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { ChangeBy, Settings, SettingChange, SettingDef, SettingKey, SettingProposal, SettingRequestResult, SettingsPatch } from '../../shared/contract';
import { SCHEMA, defOf, defaults, flattenPatch, getAt, setAt, validate } from './settings-schema';

export { validate, SCHEMA };
export const DEFAULTS: Settings = defaults();

type Env = Record<string, string | undefined>;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const newId = (p: string) => `${p}_${crypto.randomUUID().slice(0, 12)}`;

/** Saved file → settings. Each known key is validated on its own: a bad value falls back to its default, never a crash. */
export function fromSaved(raw: unknown): Settings {
  let s = defaults();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return s;
  for (const d of SCHEMA) {
    if (d.key === 'mute.*') continue;
    const v = d.key.split('.').reduce<unknown>((o, p) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[p] : undefined), raw);
    if (v === undefined) continue;
    const c = validate(d.key, v);
    if (c.ok) s = setAt(s, c.key, c.value);
  }
  const mute = (raw as { mute?: unknown }).mute;
  if (mute && typeof mute === 'object') for (const [k, v] of Object.entries(mute)) { const c = validate(`mute.${k}`, v); if (c.ok) s = setAt(s, c.key, c.value); }
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
  private listeners = new Set<ChangeListener>();
  private proposalListeners = new Set<(p: SettingProposal) => void>();

  constructor(private userData: string, private env: Env = process.env) {
    this.file = path.join(userData, 'config.json');
    this.changesFile = path.join(userData, 'changes.jsonl');
    let raw: unknown = null;
    try { raw = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* first run */ }
    this.saved = fromSaved(raw);
    this.loadChanges();
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

  schema(): SettingDef[] { return SCHEMA.map(d => ({ ...d })); }

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

  /** One key from anyone. The user: applied. Agent: applied if not protected, else a proposal for the user's click. */
  request(key: unknown, value: unknown, origin: Origin & { reason?: string }): SettingRequestResult {
    const c = validate(key, value);
    if (!c.ok) return { error: c.error };
    try { this.assertUnlocked(c.key); } catch (e) { return { error: (e as Error).message }; }
    const d = defOf(c.key)!;
    if (origin.by === 'agent' && d.protected) return { proposal: this.propose(c.key, c.value, origin) };
    const ch = this.apply(c.key, c.value, origin);
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
      this.assertUnlocked(c.key);
      // applied first: if saving fails the proposal stays pending and can be confirmed again
      ch = this.apply(c.key, c.value, { by: 'user', ...(p.chatId ? { chatId: p.chatId } : {}) }, { proposalId: p.id, force: true });
    }
    p.status = accept ? 'accepted' : 'rejected';
    for (const fn of this.proposalListeners) fn({ ...p });
    return ch;
  }

  /** Restores the value before a change, as a new change (undoOf); the original is marked undone. */
  undo(changeId: string, origin: Origin = { by: 'user' }): SettingChange {
    const orig = this.changes.find(c => c.id === changeId);
    if (!orig) throw new Error('modifica non trovata');
    if (orig.undone) throw new Error('modifica già annullata');
    if (origin.by === 'agent' && defOf(orig.key)?.protected) throw new Error("impostazione protetta: solo l'utente può annullarla");
    const c = validate(orig.key, orig.before);
    if (!c.ok) throw new Error(c.error);
    this.assertUnlocked(c.key);
    const ch = this.apply(c.key, c.value, origin, { undoOf: orig.id, force: true })!;
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
    return ch;
  }

  /** Write to a temp file, then rename over config.json. On Windows the rename can fail for a moment (EPERM/EBUSY
   *  while an antivirus or the indexer holds the file): retry briefly, then write the file directly. */
  private save(s: Settings): void {
    fs.mkdirSync(this.userData, { recursive: true });
    const text = JSON.stringify(s, null, 2);
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
