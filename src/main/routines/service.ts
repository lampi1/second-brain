// The app's Routine section in main (ADR 0175, 0176): routine packages in the package store, run on the shared routine
// runtime through the app's host adapters (routine-host.ts: embedded Claude, Azure CLI token, userData run folders),
// one DevOps trigger loop per package switched on in the app, and the run history read from the run folders: the
// app's (`<userData>/routine-runs`) and the terminal's on this PC (`defaultRunsDir()`, the `routine` CLI's default).
// At first use the active legacy routines (FlowVersions) become packages once; an enabled legacy trigger becomes the
// package's trigger switched on and the legacy rule is paused, so one loop polls each routine. Used by index.ts
// (routines:* IPC) and wiring.ts; the store is shared with the Orchestrator's routine tools. Every save fills the secret
// placeholders the app can answer (secret-fill.ts; a migrated routine also gets its sites' saved logins), and
// `exportForTerminal` writes the filled zip only under the terminal's packages folder, answering names, never values.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  azureCliTokenProvider, cliCommand, createTriggerLoop, defaultPackagesDir, defaultRunsDir, EVENTS_FILE, listRuns, parseEvents, patTokenProvider, progressFrom, readRun,
  type ConversionAutomation, type RoutinePackage, type RoutineRuntime, type RunRecord, type TriggerLoop,
} from '../../../packages/routine-runtime/src/index';
import type {
  RoutineLegacy, RoutineRunDetail, RoutineRunRef, RoutineRunSource, RoutineRunStep, RoutineRunSummary, RoutineSummary, RoutinesSnapshot, RoutineTerminalExport, RoutineTriggerFilters,
} from '../../shared/routines';
import type { FlowDefinition } from '../../shared/flows';
import { log } from '../log';
import { createRoutineStore, secretSlots, type RoutineStore, type StoredRoutine } from './store';
import { fillPackageSecrets, type SecretSources } from './secret-fill';

/** A legacy routine version still active in the brain, with its approved automation rule if any. */
export interface LegacyRoutine {
  flowId: string; title: string; definition: FlowDefinition;
  rule?: { id: string; revision: number; enabled: boolean; automation: ConversionAutomation };
}
export interface RoutinesOptions {
  userData: string;
  /** the runtime of a package (routine-host's cached one) */
  runtimeFor(pkg: RoutinePackage): RoutineRuntime;
  /** package of a legacy routine version (routine-host's packageOf) */
  convert(definition: FlowDefinition, automation?: ConversionAutomation): RoutinePackage;
  /** the active legacy routines of the connected brain; null = no brain yet */
  legacy?: () => LegacyRoutine[] | null;
  /** pauses a legacy automation rule (its trigger moved to the package) */
  pauseLegacy?: (ruleId: string, revision: number) => void;
  /** the terminal runs dir (default: defaultRunsDir()) */
  terminalRuns?: string;
  platform?: NodeJS.Platform;
  /** where the app's saved secrets come from (wiring: connectors, site vault, test DB login); absent = none filled */
  secrets?: SecretSources;
  /** the terminal's packages folder (default: defaultPackagesDir(), %LOCALAPPDATA%/routine-runtime/packages) */
  packagesDir?: string;
  /** folders an export must never land in (the app's code, the brain) */
  forbiddenRoots?: () => (string | null | undefined)[];
  /** a new trigger loop for a package (tests replace it) */
  loop?: (stored: StoredRoutine, start: (workItem: number) => { runId: string }) => Pick<TriggerLoop, 'start' | 'stop'>;
}

const missingSecrets = (r: StoredRoutine): boolean => secretSlots(r.pkg).some(s => !s.set);
const MAX_RUNS = 200, MAX_SHOT = 4 * 1024 * 1024;
const MARKER = '.converted.json';
/** The sites a legacy routine logs into: its browser-write steps' targets. */
const loginOriginsOf = (definition: FlowDefinition): string[] => (definition.steps ?? []).flatMap(s => s.writeVia === 'browser' ? s.browserTargets ?? [] : []);
/** `child` is `root` or inside it (case-insensitive on Windows). */
const inside = (child: string, root: string): boolean => {
  const rel = path.relative(path.resolve(root), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

export function createRoutines(options: RoutinesOptions) {
  const sources = options.secrets;
  const store: RoutineStore = createRoutineStore(path.join(options.userData, 'routines'), sources ? (pkg, loginOrigins) => fillPackageSecrets(pkg, sources, { ...(loginOrigins ? { loginOrigins } : {}) }).pkg : undefined);
  const packagesDir = options.packagesDir ?? defaultPackagesDir();
  const appRuns = path.join(options.userData, 'routine-runs');
  const terminalRuns = options.terminalRuns ?? defaultRunsDir();
  const platform = options.platform ?? process.platform;
  const roots: Record<RoutineRunSource, string> = { app: appRuns, terminal: terminalRuns };
  /** package run id → the runtime that started it, while it may still run here */
  const owners = new Map<string, RoutineRuntime>();
  const loops = new Map<string, { key: string; loop: Pick<TriggerLoop, 'start' | 'stop'> }>();
  let legacyErrors: RoutineLegacy[] = [];
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  const runtimeOf = (id: string): RoutineRuntime => options.runtimeFor(store.get(id).pkg);
  const own = (runtime: RoutineRuntime, handle: { runId: string; finished: Promise<RunRecord> }) => {
    owners.set(handle.runId, runtime);
    void handle.finished.catch(() => undefined).finally(() => owners.delete(handle.runId));
    return { runId: handle.runId };
  };

  const loopFor = options.loop ?? ((stored: StoredRoutine, start: (workItem: number) => { runId: string }) => {
    const pat = stored.pkg.secrets?.devopsPat;
    return createTriggerLoop({ routineId: stored.id, trigger: stored.pkg.routine.trigger!, store: runtimeOf(stored.id).store, start,
      authorization: pat ? patTokenProvider(pat) : azureCliTokenProvider(),
      log: { info: (scope, msg, extra) => log.info('flows', `${scope}: ${msg}`, extra ?? {}), warn: (scope, msg, extra) => log.warn('flows', `${scope}: ${msg}`, { cause: extra?.cause ?? 'routine trigger', hint: 'Check the trigger filters and az login.' }) } });
  });

  /** One loop per package whose trigger is on; a changed trigger restarts its loop. */
  function syncLoops(): void {
    if (stopped) return;
    const want = new Map<string, StoredRoutine>();
    for (const r of store.list().routines) if (r.app.triggerEnabled && r.pkg.routine.trigger && !missingSecrets(r)) want.set(r.id, r);
    for (const [id, entry] of loops) {
      const r = want.get(id);
      if (!r || entry.key !== JSON.stringify(r.pkg.routine.trigger)) { entry.loop.stop(); loops.delete(id); }
    }
    for (const [id, r] of want) {
      if (loops.has(id)) continue;
      const loop = loopFor(r, workItem => { const runtime = runtimeOf(id); return own(runtime, runtime.startItem(workItem, {})); });
      loops.set(id, { key: JSON.stringify(r.pkg.routine.trigger), loop });
      loop.start();
    }
  }

  // ── legacy conversion ─────────────────────────────────────────────────────────────────────────────────────────────
  const markerFile = () => path.join(store.root, MARKER);
  const converted = (): string[] => { try { return JSON.parse(fs.readFileSync(markerFile(), 'utf8')) as string[]; } catch { return []; } };
  const markConverted = (flowId: string) => {
    const all = new Set(converted()); all.add(flowId);
    fs.mkdirSync(store.root, { recursive: true });
    fs.writeFileSync(markerFile(), JSON.stringify([...all].sort(), null, 2), { mode: 0o600 });
  };
  function convertOne(item: LegacyRoutine): void {
    const pkg = options.convert(item.definition, item.rule?.automation);
    store.save(pkg, undefined, loginOriginsOf(item.definition));
    store.setApp(pkg.routine.id, { triggerEnabled: !!item.rule?.enabled && !!pkg.routine.trigger });
    // the trigger now lives in the package: the legacy rule stops polling, so one loop serves the routine
    if (item.rule?.enabled) options.pauseLegacy?.(item.rule.id, item.rule.revision);
    markConverted(item.flowId);
    log.info('flows', 'Legacy routine converted to a package', { data: { flowId: item.flowId, trigger: !!item.rule?.enabled } });
  }
  /** The sites each migrated routine logs into (by package id), while its legacy version is still active. */
  const legacyOrigins = (): Map<string, string[]> => {
    try { return new Map((options.legacy?.() ?? []).map(i => [i.definition.id, loginOriginsOf(i.definition)])); } catch { return new Map(); }
  };
  /** Fills a stored package's placeholders from what the app holds now; saves only when something was filled. */
  function refill(r: StoredRoutine, origins?: readonly string[]) {
    const outcome = fillPackageSecrets(r.pkg, sources ?? {}, { ...(origins ? { loginOrigins: origins } : {}) });
    if (sources && outcome.changed) store.save(outcome.pkg, undefined, origins);
    return outcome;
  }
  /** Converts the active legacy routines not converted yet (once each); failures stay listed with a retry button. */
  function migrate(): void {
    const items = options.legacy?.();
    if (!items) return;
    const done = new Set(converted()), errors: RoutineLegacy[] = [];
    for (const item of items) {
      if (done.has(item.flowId)) continue;
      try { convertOne(item); }
      catch (error) { errors.push({ flowId: item.flowId, title: item.title, error: error instanceof Error ? error.message : String(error) }); }
    }
    legacyErrors = errors;
  }

  // ── runs ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  const events = (dir: string) => { try { return parseEvents(fs.readFileSync(path.join(dir, EVENTS_FILE), 'utf8')); } catch { return []; } };
  const titled = (routineId: string, record: RunRecord): string => record.routineTitle || routineId;
  /** the DevOps project of a routine (its trigger, else its write rule), read once per listing */
  let projects = new Map<string, { organization: string; project: string } | null>();
  const itemUrl = (routineId: string, workItem: number): string | undefined => {
    if (!projects.has(routineId)) {
      let where: { organization: string; project: string } | null = null;
      try { const r = store.get(routineId).pkg.routine; where = r.trigger ? { organization: r.trigger.organization, project: r.trigger.project } : r.devops?.projects[0] ? { organization: r.devops.organization, project: r.devops.projects[0] } : null; } catch { /* not in the store (a terminal-only package) */ }
      projects.set(routineId, where);
    }
    const where = projects.get(routineId);
    return where ? `https://dev.azure.com/${encodeURIComponent(where.organization)}/${encodeURIComponent(where.project)}/_workitems/edit/${workItem}` : undefined;
  };
  function summaryOf(source: RoutineRunSource, record: RunRecord, dir: string): RoutineRunSummary {
    const p = progressFrom(events(dir));
    return {
      source, routineId: record.routineId, runId: record.runId, title: titled(record.routineId, record), status: record.status,
      ...(record.workItem !== undefined ? { workItem: record.workItem } : {}),
      ...(record.workItem !== undefined && itemUrl(record.routineId, record.workItem) ? { workItemUrl: itemUrl(record.routineId, record.workItem)! } : {}),
      createdAt: record.createdAt, updatedAt: record.updatedAt, ...(record.endedAt !== undefined ? { endedAt: record.endedAt } : {}),
      ...(p.step ? { step: { n: p.step.n, total: p.step.total, title: p.step.title } } : {}),
      ...(record.status === 'waiting-human' && p.waiting ? { waiting: p.waiting } : {}),
      ...(record.error ? { error: record.error } : {}),
    };
  }
  function runsOf(source: RoutineRunSource): RoutineRunSummary[] {
    const root = roots[source];
    if (!fs.existsSync(root)) return [];
    const out: RoutineRunSummary[] = [];
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      try { for (const record of listRuns(path.join(root, e.name))) out.push(summaryOf(source, record, path.join(root, e.name, record.runId))); }
      catch (error) { log.warn('flows', 'Routine runs unreadable', { cause: String(error), hint: `Check ${path.join(root, e.name)}.` }); }
    }
    return out;
  }
  const runDir = (ref: RoutineRunRef): string => {
    const safe = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
    if (!roots[ref.source] || !safe.test(ref.routineId) || !safe.test(ref.runId) || ref.runId.includes('..') || ref.routineId.includes('..')) throw new Error('Run non valida');
    return path.join(roots[ref.source], ref.routineId, ref.runId);
  };
  const shotOf = (file: string | undefined): RoutineRunDetail['lastShot'] => {
    if (!file || !/\.(png|jpe?g|webp)$/i.test(file)) return undefined;
    try {
      const stat = fs.statSync(file);
      if (stat.size > MAX_SHOT) return undefined;
      const ext = path.extname(file).slice(1).toLowerCase();
      return { path: file, dataUrl: `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${fs.readFileSync(file).toString('base64')}` };
    } catch { return undefined; }
  };

  function summaryOfRoutine(r: StoredRoutine): RoutineSummary {
    const { routine } = r.pkg, t = routine.trigger;
    let check: { lastCheckAt?: number; lastResult?: string } = {};
    if (t) { try { const s = runtimeOf(r.id).store.trigger(); check = { ...(s.lastCheckAt ? { lastCheckAt: s.lastCheckAt } : {}), ...(s.lastResult ? { lastResult: s.lastResult } : {}) }; } catch { /* no runs yet */ } }
    const cmd = (kind: 'run' | 'watch', inputs?: Record<string, string>) => cliCommand(kind, { pkg: r.dir, ...(inputs ? { inputs } : {}) }, platform);
    return {
      id: r.id, title: routine.title, description: routine.description, dir: r.dir,
      steps: routine.steps.map(s => ({ id: s.id, title: s.title, ...(s.model ? { model: s.model } : {}), ...(s.effort ? { effort: s.effort } : {}), mcpServers: s.mcpServers ?? [], allowedTools: s.allowedTools ?? [], testDbs: s.testDbs ?? [] })),
      ...(t ? { trigger: { organization: t.organization, project: t.project, areaPath: t.areaPath, workItemType: t.workItemType, everyMinutes: t.everyMinutes, states: t.states, includeTags: t.includeTags ?? [], excludeTags: t.excludeTags ?? [], workItemIds: t.workItemIds ?? [], ...(t.maxPerHour ? { maxPerHour: t.maxPerHour } : {}), enabled: r.app.triggerEnabled, ...check } } : {}),
      ...(routine.escalation ? { escalation: routine.escalation.contactName ?? routine.escalation.contact } : {}),
      secrets: { logins: (r.pkg.credentials ?? []).map(c => { try { return new URL(c.loginUrl).host; } catch { return c.loginUrl; } }), devopsPat: !!r.pkg.secrets?.devopsPat, testDbs: Object.keys(r.pkg.secrets?.testDbs ?? {}).length },
      secretSlots: secretSlots(r.pkg),
      commands: { run: cmd('run'), item: cmd('run', { workItem: 'ID' }), watch: cmd('watch') },
    };
  }

  const api = {
    store,
    /** converts the legacy routines not converted yet and keeps one trigger loop per switched-on package */
    sync(): void {
      try { migrate(); } catch (error) { log.warn('flows', 'Legacy routine conversion failed', { cause: String(error), hint: 'Use «Converti in pacchetto» on the routine.' }); }
      if (sources) {
        const origins = legacyOrigins();
        for (const r of store.list().routines) {
          try { refill(r, origins.get(r.id)); }
          catch (error) { log.warn('flows', 'Routine secrets not filled', { data: { routine: r.id }, cause: error instanceof Error ? error.message : 'unknown', hint: 'Type the missing credentials on the Routine page.' }); }
        }
      }
      try { syncLoops(); } catch (error) { log.warn('flows', 'Routine trigger loops not updated', { cause: String(error), hint: 'Open the Routine section to see the broken package.' }); }
    },
    snapshot(): RoutinesSnapshot {
      api.sync();
      const { routines, broken } = store.list();
      projects = new Map();
      const runs = [...runsOf('app'), ...runsOf('terminal')].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_RUNS);
      return {
        routines: routines.map(summaryOfRoutine), runs,
        dirs: { packages: store.root, appRuns, terminalRuns },
        legacy: legacyErrors,
        ...(broken.length ? { error: broken.map(b => `${b.id}: ${b.error}`).join('; ') } : {}),
      };
    },
    importZip(bytes: Buffer): RoutinesSnapshot { store.importZip(bytes); return api.snapshot(); },
    exportZip: (id: string) => store.exportZip(id),
    has: (id: string) => store.has(id),
    /** «Esporta per il terminale» and the Orchestrator's app_routine_export: fills what the app holds now, writes the
     *  zip only under the terminal's packages folder, and answers its path and the secrets' names (never a value). */
    exportForTerminal(id: string): RoutineTerminalExport {
      const outcome = refill(store.get(id), legacyOrigins().get(id));
      const { filename, bytes } = store.exportZip(id);
      const root = path.resolve(packagesDir), dir = path.join(root, path.basename(store.dirOf(id))), file = path.join(dir, filename);
      if (!inside(file, root)) throw new Error('Percorso di esportazione non valido');
      for (const forbidden of options.forbiddenRoots?.() ?? []) {
        if (forbidden && inside(file, forbidden)) throw new Error('La cartella dei pacchetti è dentro il repository o il brain: esportazione rifiutata');
      }
      fs.mkdirSync(dir, { recursive: true });
      const temp = path.join(dir, `.${randomUUID()}.tmp`);
      try { fs.writeFileSync(temp, bytes, { mode: 0o600 }); fs.renameSync(temp, file); } finally { fs.rmSync(temp, { force: true }); }
      log.info('flows', 'Routine package exported for the terminal', { data: { routine: id, filled: outcome.rows.filter(r => r.filled).length, missing: outcome.rows.filter(r => !r.filled).length } });
      return { path: file, filled: outcome.rows.filter(r => r.filled).map(r => r.secret), missing: outcome.rows.filter(r => !r.filled).map(r => ({ secret: r.secret, reason: r.reason })) };
    },
    startItem(id: string, workItem: number): RoutineRunRef {
      if (!Number.isSafeInteger(workItem) || workItem <= 0) throw new Error('Numero di work item non valido');
      if (missingSecrets(store.get(id))) throw new Error('Credenziali da inserire: completale prima di avviare la routine');
      const runtime = runtimeOf(id);
      return { source: 'app', routineId: id, ...own(runtime, runtime.startItem(workItem, {})) };
    },
    setTrigger(id: string, enabled: boolean, filters?: RoutineTriggerFilters): RoutinesSnapshot {
      const stored = store.get(id);
      if (!stored.pkg.routine.trigger) throw new Error('Questa routine non ha un trigger DevOps');
      if (filters) {
        const list = (v: unknown) => Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string').map(s => s.trim()).filter(Boolean) : [];
        const every = Number(filters.everyMinutes);
        if (!Number.isInteger(every) || every < 1 || every > 1440) throw new Error('Intervallo non valido (1-1440 minuti)');
        const ids = Array.isArray(filters.workItemIds) ? filters.workItemIds.filter(n => Number.isSafeInteger(n) && n > 0) : [];
        const max = filters.maxPerHour === undefined ? undefined : Number(filters.maxPerHour);
        if (max !== undefined && (!Number.isInteger(max) || max < 1 || max > 100)) throw new Error('Massimo per ora non valido (1-100)');
        const { includeTags: _i, excludeTags: _e, workItemIds: _w, maxPerHour: _m, ...rest } = stored.pkg.routine.trigger;
        const states = list(filters.states);
        if (!states.length) throw new Error('Serve almeno uno stato');
        const trigger = { ...rest, everyMinutes: every, states,
          ...(list(filters.includeTags).length ? { includeTags: list(filters.includeTags) } : {}),
          ...(list(filters.excludeTags).length ? { excludeTags: list(filters.excludeTags) } : {}),
          ...(ids.length ? { workItemIds: ids } : {}), ...(max ? { maxPerHour: max } : {}) };
        store.save({ ...stored.pkg, routine: { ...stored.pkg.routine, trigger } });
      }
      if (enabled && missingSecrets(store.get(id))) throw new Error('Credenziali da inserire: completale prima di accendere il trigger');
      store.setApp(id, { triggerEnabled: enabled });
      return api.snapshot();
    },
    /** The user's typed secrets; values never come back (the summary only says which slots are set). */
    setSecrets(id: string, values: Record<string, string>): RoutinesSnapshot {
      store.setSecrets(id, values);
      return api.snapshot();
    },
    run(ref: RoutineRunRef): RoutineRunDetail {
      const dir = runDir(ref);
      projects = new Map();
      const folder = readRun(dir), list = events(dir), p = progressFrom(list);
      const steps: RoutineRunStep[] = folder.steps.map(s => ({
        n: s.record.n, id: s.record.id, title: s.record.title, status: s.record.status, attempts: s.record.attempts,
        ...(s.record.startedAt ? { startedAt: s.record.startedAt } : {}), ...(s.record.endedAt ? { endedAt: s.record.endedAt } : {}),
        ...(s.record.summary ? { summary: s.record.summary } : {}), ...(s.record.error ? { error: s.record.error } : {}),
        writes: s.record.writes ?? [], notVerified: s.record.notVerified ?? [], failedWrites: s.record.failedWrites ?? [],
        ...(s.record.testDb ? { testDb: s.record.testDb } : {}),
        dir: s.dir, screenshots: s.screenshots, evidence: s.evidence,
      }));
      const report = path.join(dir, 'report.md');
      const live = ref.source === 'app' && owners.has(ref.runId);
      const shot = shotOf(p.shots[p.shots.length - 1]);
      return {
        ...summaryOf(ref.source, folder.run, dir), dir, events: list, steps,
        ...(fs.existsSync(report) ? { reportPath: report } : {}),
        ...(shot ? { lastShot: shot } : {}),
        resume: cliCommand('resume', { runDir: dir }, platform),
        cancellable: live,
      };
    },
    cancel(ref: RoutineRunRef): void {
      if (ref.source !== 'app') throw new Error('Una run avviata dal terminale si ferma dal terminale (Ctrl+C)');
      runDir(ref);
      const runtime = owners.get(ref.runId) ?? runtimeOf(ref.routineId);
      runtime.cancel(ref.runId);
    },
    /** «Converti in pacchetto»: retries the conversion of one legacy routine. */
    convert(flowId: string): RoutinesSnapshot {
      const item = options.legacy?.()?.find(i => i.flowId === flowId);
      if (!item) throw new Error('Routine non trovata nel brain');
      convertOne(item);
      legacyErrors = legacyErrors.filter(e => e.flowId !== flowId);
      return api.snapshot();
    },
    /** a legacy routine already converted: its legacy trigger must not poll again */
    packaged: (flowId: string): boolean => converted().includes(flowId),
    /** syncs now and then every minute (the brain, hence the legacy routines, connects after start) */
    start(): void { api.sync(); timer ??= setInterval(() => api.sync(), 60_000); timer.unref?.(); },
    stop(): void { stopped = true; if (timer) clearInterval(timer); timer = undefined; for (const { loop } of loops.values()) loop.stop(); loops.clear(); },
  };
  return api;
}
export type Routines = ReturnType<typeof createRoutines>;
