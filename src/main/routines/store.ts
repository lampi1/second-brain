// The app's routine package store (ADR 0175, 0176): one folder per routine under `<userData>/routines/<id>/` with
// `routine.json` (embedded secrets included, never in the brain) and `assets/`, plus the app's own `app.json` (the
// trigger switch). Import unpacks a zip there, export zips the folder back: the same zip the terminal `routine` CLI
// reads. Every save lets the host fill the secret placeholders it can answer (secret-fill.ts). Used by routines/service.ts and, to save authored packages, by the Orchestrator's routine tools.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseRoutinePackage, ROUTINE_FILE, SECRET_PLACEHOLDER, writeRoutinePackage, type RoutinePackage } from '../../../packages/routine-runtime/src/index';
import { readZip, writeZip, type PackFiles } from '../agents/pack/zip';

export { SECRET_PLACEHOLDER };
const isSet = (v: string | undefined): v is string => !!v && v !== SECRET_PLACEHOLDER;
const originOf = (url: string) => { try { return new URL(url).origin; } catch { return url; } };

export interface SecretSlot { slot: string; kind: 'login' | 'devopsPat' | 'testDb'; field: 'user' | 'password' | 'token'; label: string; set: boolean }
/** Every secret slot of a package (values never leave this module). */
export function secretSlots(pkg: RoutinePackage): SecretSlot[] {
  const out: SecretSlot[] = [];
  (pkg.credentials ?? []).forEach((c, i) => {
    const host = (() => { try { return new URL(c.loginUrl).host; } catch { return c.loginUrl; } })();
    out.push({ slot: `login:${i}:user`, kind: 'login', field: 'user', label: host, set: isSet(c.user) });
    out.push({ slot: `login:${i}:password`, kind: 'login', field: 'password', label: host, set: isSet(c.password) });
  });
  if (pkg.secrets?.devopsPat !== undefined) out.push({ slot: 'devopsPat', kind: 'devopsPat', field: 'token', label: 'DevOps PAT', set: isSet(pkg.secrets.devopsPat) });
  const dbs = pkg.secrets?.testDbs ?? {};
  for (const id of new Set([...(pkg.routine.testDbs ?? []).map(d => d.id), ...Object.keys(dbs)])) {
    const db = pkg.routine.testDbs?.find(d => d.id === id), label = db ? `${db.server}/${db.database}` : id;
    out.push({ slot: `testDb:${id}:user`, kind: 'testDb', field: 'user', label, set: isSet(dbs[id]?.user) });
    out.push({ slot: `testDb:${id}:password`, kind: 'testDb', field: 'password', label, set: isSet(dbs[id]?.password) });
  }
  return out;
}
/** A package with the typed values in their slots (empty values are skipped; unknown slots are refused). */
export function withSecrets(pkg: RoutinePackage, values: Record<string, string>): RoutinePackage {
  const next = JSON.parse(JSON.stringify(pkg)) as RoutinePackage;
  const known = new Set(secretSlots(pkg).map(s => s.slot));
  for (const [slot, raw] of Object.entries(values)) {
    if (!known.has(slot)) throw new Error('Credenziale non prevista dal pacchetto');
    if (typeof raw !== 'string' || !raw) continue;
    if (raw === SECRET_PLACEHOLDER || raw.length > 4096) throw new Error('Valore non valido');
    const [kind, key, field] = slot.split(':');
    if (kind === 'login') { const c = next.credentials![Number(key)]!; if (field === 'user') c.user = raw; else c.password = raw; }
    else if (kind === 'devopsPat') next.secrets = { ...next.secrets, devopsPat: raw };
    else {
      const dbs = { ...(next.secrets?.testDbs ?? {}) }, cur = dbs[key!] ?? { user: SECRET_PLACEHOLDER, password: SECRET_PLACEHOLDER };
      dbs[key!] = field === 'user' ? { ...cur, user: raw } : { ...cur, password: raw };
      next.secrets = { ...next.secrets, testDbs: dbs };
    }
  }
  return next;
}
/** A revised package keeps the secrets already stored where it only carries the placeholder. */
function keepStoredSecrets(pkg: RoutinePackage, old: RoutinePackage | undefined): RoutinePackage {
  if (!old) return pkg;
  const next = JSON.parse(JSON.stringify(pkg)) as RoutinePackage;
  for (const c of next.credentials ?? []) {
    const prev = old.credentials?.find(o => originOf(o.loginUrl) === originOf(c.loginUrl));
    if (prev) keepFields(c, prev);
  }
  if (next.secrets?.devopsPat === SECRET_PLACEHOLDER && isSet(old.secrets?.devopsPat)) next.secrets.devopsPat = old.secrets.devopsPat;
  for (const [id, db] of Object.entries(next.secrets?.testDbs ?? {})) {
    const prev = old.secrets?.testDbs?.[id];
    if (prev) keepFields(db, prev);
  }
  return next;
}
/** Each placeholder field takes the stored value, when one is set. */
function keepFields(cur: { user: string; password: string }, prev: { user: string; password: string }): void {
  for (const k of ['user', 'password'] as const) if (!isSet(cur[k]) && isSet(prev[k])) cur[k] = prev[k];
}

export const APP_FILE = 'app.json';
const ASSETS = 'assets';
export interface StoredRoutine { id: string; dir: string; pkg: RoutinePackage }

const validId = (id: string): string => {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)) throw new Error('Id routine non valido');
  return id;
};

function filesUnder(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? filesUnder(full, base) : e.isFile() ? [path.relative(base, full).split(path.sep).join('/')] : [];
  });
}

/** Host filling of the placeholders on every save (routines/secret-fill.ts); `loginOrigins`: sites a migrated routine
 *  logs into. Absent = the package is saved as given. */
export type RoutineFill = (pkg: RoutinePackage, loginOrigins?: readonly string[]) => RoutinePackage;

export function createRoutineStore(root: string, fill?: RoutineFill) {
  const dirOf = (id: string) => path.join(root, validId(id));
  const store = {
    root,
    dirOf,
    ids(): string[] {
      if (!fs.existsSync(root)) return [];
      return fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory() && fs.existsSync(path.join(root, e.name, ROUTINE_FILE))).map(e => e.name).sort();
    },
    get(id: string): StoredRoutine {
      const dir = dirOf(id);
      const pkg = parseRoutinePackage(JSON.parse(fs.readFileSync(path.join(dir, ROUTINE_FILE), 'utf8')) as unknown);
      return { id, dir, pkg };
    },
    /** Every readable package; an unreadable one is reported, never hidden. */
    list(): { routines: StoredRoutine[]; broken: { id: string; error: string }[] } {
      const routines: StoredRoutine[] = [], broken: { id: string; error: string }[] = [];
      for (const id of store.ids()) {
        try { routines.push(store.get(id)); } catch (e) { broken.push({ id, error: e instanceof Error ? e.message : String(e) }); }
      }
      return { routines, broken };
    },
    has: (id: string): boolean => { try { return fs.existsSync(path.join(dirOf(id), ROUTINE_FILE)); } catch { return false; } },
    /** Saves (or replaces) a package; its assets are written under assets/ by relative path. app.json is kept. */
    save(pkg: RoutinePackage, assets?: PackFiles, loginOrigins?: readonly string[]): StoredRoutine {
      const parsed = parseRoutinePackage(JSON.parse(JSON.stringify(pkg)) as unknown);
      const dir = dirOf(parsed.routine.id);
      const kept = keepStoredSecrets(parsed, store.has(parsed.routine.id) ? (() => { try { return store.get(parsed.routine.id).pkg; } catch { return undefined; } })() : undefined);
      const valid = fill ? parseRoutinePackage(JSON.parse(JSON.stringify(fill(kept, loginOrigins))) as unknown) : kept;
      fs.mkdirSync(root, { recursive: true });
      // written beside, then swapped: a failed import never leaves half a package
      const temp = path.join(root, `.${valid.routine.id}.${randomUUID()}.tmp`);
      try {
        writeRoutinePackage(temp, valid);
        // a save without assets (a filter edit) keeps the ones already there
        if (!assets && fs.existsSync(path.join(dir, ASSETS))) fs.cpSync(path.join(dir, ASSETS), path.join(temp, ASSETS), { recursive: true });
        for (const [name, bytes] of assets ?? []) {
          const file = path.join(temp, ASSETS, ...name.split('/'));
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, bytes, { mode: 0o600 });
        }
        const app = path.join(dir, APP_FILE);
        if (fs.existsSync(app)) fs.copyFileSync(app, path.join(temp, APP_FILE));
        fs.rmSync(dir, { recursive: true, force: true });
        fs.renameSync(temp, dir);
      } finally { fs.rmSync(temp, { recursive: true, force: true }); }
      return store.get(valid.routine.id);
    },
    /** The user's typed secrets (write-only from the Routine page). */
    setSecrets(id: string, values: Record<string, string>): StoredRoutine {
      const current = store.get(id);
      return store.save(withSecrets(current.pkg, values));
    },
    /** A package zip: `routine.json` at the root (or inside one top folder) and `assets/…`. Other files are refused. */
    importZip(bytes: Buffer): StoredRoutine {
      const files = readZip(bytes);
      const names = [...files.keys()];
      const top = names.includes(ROUTINE_FILE) ? '' : (() => {
        const first = names.find(n => n.endsWith(`/${ROUTINE_FILE}`) && n.split('/').length === 2);
        return first ? `${first.split('/')[0]}/` : '';
      })();
      const json = files.get(`${top}${ROUTINE_FILE}`);
      if (!json) throw new Error(`Lo zip non contiene ${ROUTINE_FILE}`);
      let raw: unknown;
      try { raw = JSON.parse(json.toString('utf8')); } catch { throw new Error(`${ROUTINE_FILE} non è JSON valido`); }
      const pkg = parseRoutinePackage(raw);
      const assets: PackFiles = new Map();
      for (const [name, data] of files) {
        if (!name.startsWith(top) || name === `${top}${ROUTINE_FILE}` || name.endsWith('/')) continue;
        const rel = name.slice(top.length);
        if (rel === APP_FILE) continue;
        if (!rel.startsWith(`${ASSETS}/`)) throw new Error(`File non previsto nel pacchetto: ${rel}`);
        assets.set(rel.slice(ASSETS.length + 1), data);
      }
      return store.save(pkg, assets);
    },
    /** The package as a zip (credentials included, ADR 0176: share it like a password). */
    exportZip(id: string): { filename: string; bytes: Buffer } {
      const { dir } = store.get(id);
      const files: PackFiles = new Map([[ROUTINE_FILE, fs.readFileSync(path.join(dir, ROUTINE_FILE))]]);
      for (const rel of filesUnder(path.join(dir, ASSETS))) files.set(`${ASSETS}/${rel}`, fs.readFileSync(path.join(dir, ASSETS, ...rel.split('/'))));
      return { filename: `${id}.routine.zip`, bytes: writeZip(files) };
    },
  };
  return store;
}
export type RoutineStore = ReturnType<typeof createRoutineStore>;
