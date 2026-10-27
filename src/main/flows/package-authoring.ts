// Routine package authoring for the Orchestrator (ADR 0175, 0176): turns a package an agent wrote from the user's
// plain-language need into a saved `routine.json` that the shared runtime (packages/routine-runtime) can run in the app
// or a terminal. One source for the authoring rules: app_flow_capabilities, app_flow_connectors, the app_guide topic
// "routine" and docs/routines/authoring.md all say what ROUTINE_AUTHORING says. Secrets never pass through an agent:
// the agent leaves them out (or writes SECRET_PLACEHOLDER), the tool keeps the ones the user already stored for the same
// routine, and preflight names the rest for the user to type. Used by package-tools.ts (app_flow_propose and friends).
import fs from 'node:fs';
import path from 'node:path';
import {
  formatPreflight, loadRoutinePackage, preflightRoutinePackage, ROUTINE_FILE, SECRET_PLACEHOLDER, writeRoutinePackage,
  type PreflightIssue, type RecognisedTestDb, type RoutinePackage,
} from '../../../packages/routine-runtime/src/index';

/** What the package store keeps; the Routine section owns the real store (src/main/routines), this is its contract. */
export interface PackageSummary { id: string; title: string; steps: number; trigger: boolean; missingSecrets: number }
export interface RoutinePackageStore {
  list(): PackageSummary[];
  get(id: string): RoutinePackage | null;
  /** writes `<root>/<id>/routine.json`; returns that file */
  save(pkg: RoutinePackage): { id: string; file: string };
}

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const missingSecrets = (pkg: RoutinePackage): number => preflightRoutinePackage(pkg).errors.filter(e => e.secret).length;

/** The default store: one folder per routine under the app's `<userData>/routines` (or any root a terminal gives). */
export function createFolderPackageStore(root: string): RoutinePackageStore {
  const dirOf = (id: string) => { if (!ID.test(id)) throw new Error('Invalid routine id'); return path.join(root, id); };
  const get = (id: string): RoutinePackage | null => {
    const file = path.join(dirOf(id), ROUTINE_FILE);
    if (!fs.existsSync(file)) return null;
    return loadRoutinePackage(file);
  };
  return {
    list() {
      let names: string[] = [];
      try { names = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory() && ID.test(d.name)).map(d => d.name).sort(); } catch { return []; }
      return names.flatMap(name => {
        try { const pkg = get(name); return pkg ? [{ id: pkg.routine.id, title: pkg.routine.title, steps: pkg.routine.steps.length, trigger: !!pkg.routine.trigger, missingSecrets: missingSecrets(pkg) }] : []; }
        catch { return []; }
      });
    },
    get,
    save(pkg) { return { id: pkg.routine.id, file: writeRoutinePackage(dirOf(pkg.routine.id), pkg) }; },
  };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);

/** A package with every secret value replaced: what an agent may read back. Placeholders stay visible. */
export function maskPackage(pkg: RoutinePackage): RoutinePackage {
  const hide = (v: string) => v === SECRET_PLACEHOLDER ? v : '***';
  return {
    ...pkg,
    ...(pkg.credentials ? { credentials: pkg.credentials.map(c => ({ ...c, password: hide(c.password) })) } : {}),
    ...(pkg.secrets ? { secrets: {
      ...(pkg.secrets.devopsPat ? { devopsPat: hide(pkg.secrets.devopsPat) } : {}),
      ...(pkg.secrets.testDbs ? { testDbs: Object.fromEntries(Object.entries(pkg.secrets.testDbs).map(([k, l]) => [k, { ...l, password: hide(l.password) }])) } : {}),
    } } : {}),
  };
}

export class SecretFromAgent extends Error {}

/**
 * Fills the secret slots of an agent-written package without ever taking a secret from the agent: a password, PAT or
 * test DB password the agent supplied (anything but SECRET_PLACEHOLDER) is refused; an omitted one is taken from the
 * stored package of the same routine (same loginUrl and user, same test DB id and user) or left as SECRET_PLACEHOLDER.
 */
export function fillSecrets(raw: unknown, stored: RoutinePackage | null): unknown {
  if (!isObj(raw)) return raw;
  const out: Obj = { ...raw };
  if (Array.isArray(raw.credentials)) {
    out.credentials = raw.credentials.map((c, i) => {
      if (!isObj(c)) return c;
      if (c.password !== undefined && c.password !== SECRET_PLACEHOLDER) throw new SecretFromAgent(`credentials[${i}].password: never pass a secret; leave it out and the user types it`);
      const kept = stored?.credentials?.find(s => s.loginUrl === c.loginUrl && s.user === c.user);
      return { ...c, password: kept?.password ?? SECRET_PLACEHOLDER };
    });
  }
  const secrets = isObj(raw.secrets) ? raw.secrets : undefined;
  if (secrets?.devopsPat !== undefined && secrets.devopsPat !== SECRET_PLACEHOLDER) throw new SecretFromAgent('secrets.devopsPat: never pass a secret; leave it out and the user types it');
  const next: Obj = { ...(secrets ?? {}) };
  if (stored?.secrets?.devopsPat && secrets?.devopsPat === undefined) next.devopsPat = stored.secrets.devopsPat;
  if (secrets && isObj(secrets.testDbs)) {
    next.testDbs = Object.fromEntries(Object.entries(secrets.testDbs).map(([id, l]) => {
      if (!isObj(l)) return [id, l];
      if (l.password !== undefined && l.password !== SECRET_PLACEHOLDER) throw new SecretFromAgent(`secrets.testDbs.${id}.password: never pass a secret; leave it out and the user types it`);
      const kept = stored?.secrets?.testDbs?.[id];
      return [id, { ...l, password: kept && kept.user === l.user ? kept.password : SECRET_PLACEHOLDER }];
    }));
  }
  if (Object.keys(next).length) out.secrets = next; else delete out.secrets;
  return out;
}

export interface AuthorResult {
  /** saved: ready to run; needs-secrets: saved, the user still types the listed secrets; invalid: nothing saved */
  status: 'ready' | 'needs-secrets' | 'invalid';
  routineId?: string;
  file?: string;
  errors: PreflightIssue[];
  warnings: PreflightIssue[];
  /** the errors and warnings as lines (path: problem. Fix: what to do) */
  preflight: string;
  next: string;
}

/** Validates an agent-written package with the runtime's own preflight and saves it when only user secrets are missing. */
export function authorPackage(raw: unknown, store: RoutinePackageStore, options: { recognisedTestDbs?: readonly RecognisedTestDb[]; dryRun?: boolean } = {}): AuthorResult {
  const id = isObj(raw) && isObj(raw.routine) && typeof raw.routine.id === 'string' && ID.test(raw.routine.id) ? raw.routine.id : undefined;
  let stored: RoutinePackage | null = null;
  try { stored = id ? store.get(id) : null; } catch { stored = null; }
  const filled = fillSecrets(raw, stored);
  const result = preflightRoutinePackage(filled, options.recognisedTestDbs ? { recognisedTestDbs: options.recognisedTestDbs } : {});
  const blocking = result.errors.filter(e => !e.secret);
  const base = { errors: result.errors, warnings: result.warnings, preflight: formatPreflight(result) };
  if (blocking.length || !result.pkg) return { ...base, status: 'invalid', next: 'Fix every non-secret error (each names its field and the fix), then call app_flow_propose again. Nothing was saved.' };
  const status = result.errors.length ? 'needs-secrets' : 'ready';
  if (options.dryRun) return { ...base, status, routineId: result.pkg.routine.id, next: 'dryRun: nothing saved.' };
  const saved = store.save(result.pkg);
  return {
    ...base, status, routineId: saved.id, file: saved.file,
    next: status === 'ready'
      ? 'Saved. Saving never starts it: the user runs it from the Routine page (or `routine run` in a terminal); a trigger runs only after the user switches it on.'
      : 'Saved, but the user must type the secrets listed (secret: true) in the routine\'s Credenziali before it can run. Tell them which ones, never ask for the values in chat.',
  };
}
