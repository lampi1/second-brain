// On-demand package catalog and run reader. The app never instantiates a runtime or a trigger (ADR 0179).
// The only subscription is an fs.watch owned by an open run view; stop/unwatch releases it immediately.
import fs from 'node:fs';
import { createRunReader, confined } from './reader';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  cliCommand, convertFlowToPackage, defaultPackagesDir, defaultRunsDir, listRuns,
  type RunRecord,
} from '../../../packages/routine-runtime/src/index';
import type {
  RoutineRunDetail, RoutineRunRef, RoutineRunSource, RoutineRunStep, RoutineRunSummary, RoutineSummary, RoutinesSnapshot, RoutineTerminalExport,
} from '../../shared/routines';
import type { LegacyArchive } from './legacy';
import { log } from '../log';
import { createRoutineStore, secretSlots, type RoutineStore, type StoredRoutine } from './store';
import { fillPackageSecrets, type SecretSources } from './secret-fill';

export interface RoutinesOptions {
  userData: string;
  legacy?: LegacyArchive;
  changed?: (change: { subscription: string; run?: RoutineRunDetail; error?: string }) => void;
  /** the terminal runs dir (default: defaultRunsDir()) */
  terminalRuns?: string;
  platform?: NodeJS.Platform;
  /** where the app's saved secrets come from (wiring: connectors, site vault, test DB login); absent = none filled */
  secrets?: SecretSources;
  /** the terminal's packages folder (default: defaultPackagesDir(), %LOCALAPPDATA%/routine-runtime/packages) */
  packagesDir?: string;
  /** folders an export must never land in (the app's code, the brain) */
  forbiddenRoots?: () => (string | null | undefined)[];
}

const MAX_RUNS = 200;
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
  /** Fills a stored package's placeholders from what the app holds now; saves only when something was filled. */
  function refill(r: StoredRoutine, origins?: readonly string[]) {
    const outcome = fillPackageSecrets(r.pkg, sources ?? {}, { ...(origins ? { loginOrigins: origins } : {}) });
    if (sources && outcome.changed) store.save(outcome.pkg, undefined, origins);
    return outcome;
  }
  // ── runs ──────────────────────────────────────────────────────────────────────────────────────────────────────────
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
  function summaryOf(source: RoutineRunSource, record: RunRecord): RoutineRunSummary {
    const current = record.steps.find(s => s.status === 'running') ?? record.steps.filter(s => s.status !== 'pending').at(-1);
    return {
      source, routineId: record.routineId, runId: record.runId, title: titled(record.routineId, record), status: record.status,
      ...(record.workItem !== undefined ? { workItem: record.workItem } : {}),
      ...(record.workItem !== undefined && itemUrl(record.routineId, record.workItem) ? { workItemUrl: itemUrl(record.routineId, record.workItem)! } : {}),
      createdAt: record.createdAt, updatedAt: record.updatedAt, ...(record.endedAt !== undefined ? { endedAt: record.endedAt } : {}),
      ...(current ? { step: { n: current.n, total: record.steps.length, title: current.title } } : {}),
      ...(record.escalation?.state === 'waiting' ? { waiting: { question: record.escalation.question } } : {}),
      ...(record.error ? { error: record.error } : {}),
    };
  }
  function runsOf(source: RoutineRunSource): RoutineRunSummary[] {
    const root = roots[source];
    if (!fs.existsSync(root)) return [];
    const out: RoutineRunSummary[] = [];
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      try { for (const record of listRuns(path.join(root, e.name))) out.push(summaryOf(source, record)); }
      catch (error) { log.warn('flows', 'Routine runs unreadable', { cause: String(error), hint: `Check ${path.join(root, e.name)}.` }); }
    }
    return out;
  }
  const runDir = (ref: RoutineRunRef): string => {
    const safe = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
    if (!roots[ref.source] || !safe.test(ref.routineId) || !safe.test(ref.runId) || ref.runId.includes('..') || ref.routineId.includes('..')) throw new Error('Run non valida');
    return path.join(roots[ref.source], ref.routineId, ref.runId);
  };

  function summaryOfRoutine(r: StoredRoutine): RoutineSummary {
    const { routine } = r.pkg, t = routine.trigger;
    const cmd = (kind: 'run' | 'watch', inputs?: Record<string, string>) => cliCommand(kind, { pkg: r.dir, ...(inputs ? { inputs } : {}) }, platform);
    return {
      id: r.id, title: routine.title, description: routine.description, dir: r.dir,
      steps: routine.steps.map(s => ({ id: s.id, title: s.title, ...(s.model ? { model: s.model } : {}), ...(s.effort ? { effort: s.effort } : {}), mcpServers: s.mcpServers ?? [], allowedTools: s.allowedTools ?? [], testDbs: s.testDbs ?? [] })),
      ...(t ? { trigger: { organization: t.organization, project: t.project, areaPath: t.areaPath, workItemType: t.workItemType, everyMinutes: t.everyMinutes, states: t.states, includeTags: t.includeTags ?? [], excludeTags: t.excludeTags ?? [], workItemIds: t.workItemIds ?? [], ...(t.maxPerHour ? { maxPerHour: t.maxPerHour } : {}) } } : {}),
      ...(routine.escalation ? { escalation: routine.escalation.contactName ?? routine.escalation.contact } : {}),
      secrets: { logins: (r.pkg.credentials ?? []).map(c => { try { return new URL(c.loginUrl).host; } catch { return c.loginUrl; } }), devopsPat: !!r.pkg.secrets?.devopsPat, testDbs: Object.keys(r.pkg.secrets?.testDbs ?? {}).length },
      secretSlots: secretSlots(r.pkg),
      commands: { run: cmd('run'), item: cmd('run', { workItem: 'ID' }), watch: cmd('watch') },
    };
  }

  let watch: { subscription: string; close(): void } | undefined;
  const api = {
    store,
    snapshot(): RoutinesSnapshot {
      const { routines, broken } = store.list();
      projects = new Map();
      const runs = [...runsOf('app'), ...runsOf('terminal')].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_RUNS);
      return {
        routines: routines.map(summaryOfRoutine), runs,
        dirs: { packages: store.root, appRuns, terminalRuns },
        legacy: (options.legacy?.definitions() ?? []).filter(r => !store.has(r.flowId)).map(r => ({ flowId: r.flowId, title: r.title, error: '' })),
        ...(broken.length ? { error: broken.map(b => `${b.id}: ${b.error}`).join('; ') } : {}),
      };
    },
    importZip(bytes: Buffer): RoutinesSnapshot { store.importZip(bytes); return api.snapshot(); },
    exportZip: (id: string) => store.exportZip(id),
    has: (id: string) => store.has(id),
    /** «Esporta per il terminale» and the Orchestrator's app_routine_export: fills what the app holds now, writes the
     *  zip only under the terminal's packages folder, and answers its path and the secrets' names (never a value). */
    exportForTerminal(id: string): RoutineTerminalExport {
      const outcome = refill(store.get(id));
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
    /** The user's typed secrets; values never come back (the summary only says which slots are set). */
    setSecrets(id: string, values: Record<string, string>): RoutinesSnapshot {
      store.setSecrets(id, values);
      return api.snapshot();
    },
    async run(ref: RoutineRunRef, reader = createRunReader(), signal?: AbortSignal): Promise<RoutineRunDetail> {
      const dir = await confined(roots[ref.source], runDir(ref));
      signal?.throwIfAborted();
      projects = new Map();
      const folder = await reader.read(dir, signal), list = folder.events;
      const steps: RoutineRunStep[] = folder.steps.map(s => ({
        n: s.record.n, id: s.record.id, title: s.record.title, status: s.record.status, attempts: s.record.attempts,
        ...(s.record.startedAt ? { startedAt: s.record.startedAt } : {}), ...(s.record.endedAt ? { endedAt: s.record.endedAt } : {}),
        ...(s.record.summary ? { summary: s.record.summary } : {}), ...(s.record.error ? { error: s.record.error } : {}),
        writes: s.record.writes ?? [], notVerified: s.record.notVerified ?? [], failedWrites: s.record.failedWrites ?? [],
        ...(s.record.testDb ? { testDb: s.record.testDb } : {}),
        dir: s.dir, screenshots: s.screenshots, evidence: s.evidence,
      }));
      const report = path.join(dir, 'report.md');
      const lastPath = list.findLast(e => e.type === 'screenshot')?.path;
      const shot = lastPath ? await confined(dir, path.resolve(dir, lastPath)).then(path => ({ path })).catch(() => undefined) : undefined;
      signal?.throwIfAborted();
      return {
        ...summaryOf(ref.source, folder.run), dir, events: list, steps,
        ...(fs.existsSync(report) ? { reportPath: report } : {}),
        ...(shot ? { lastShot: shot } : {}),
        resume: cliCommand('resume', { runDir: dir }, platform),
        archived: ref.source === 'app',
      };
    },
    /** Explicit conversion prepares a terminal package; never reads, edits or reconciles a run. */
    convert(flowId: string): RoutinesSnapshot {
      const item = options.legacy?.definitions().find(i => i.flowId === flowId);
      if (!item) throw new Error('Routine non trovata nel brain');
      const pkg = convertFlowToPackage({ format: 'second-brain-flow', schemaVersion: 1, definition: item.definition }, item.automation).pkg;
      store.save(pkg, undefined, item.definition.steps.flatMap(s => s.writeVia === 'browser' ? s.browserTargets ?? [] : []));
      return api.snapshot();
    },
    async watch(ref: RoutineRunRef, subscription: string): Promise<RoutineRunDetail> {
      if (typeof subscription !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(subscription)) throw new Error('Invalid subscription');
      watch?.close();
      const controller = new AbortController(), reader = createRunReader();
      let queued: ReturnType<typeof setImmediate> | undefined, watcher: fs.FSWatcher | undefined;
      let closed = false, reading = false, dirty = false;
      const close = () => {
        closed = true; controller.abort(); watcher?.close();
        if (queued) clearImmediate(queued);
        queued = undefined; reader.clear();
      };
      const active = { subscription, close };
      watch = active;
      const refresh = () => {
        if (closed) return;
        if (reading) { dirty = true; return; }
        if (queued) return;
        queued = setImmediate(async () => {
          queued = undefined;
          if (closed) return;
          reading = true;
          try { const run = await api.run(ref, reader, controller.signal); if (!closed) options.changed?.({ subscription, run }); }
          catch { if (!closed) options.changed?.({ subscription, error: 'Run in aggiornamento: riapri la vista se il problema persiste.' }); }
          finally { reading = false; if (dirty && !closed) { dirty = false; refresh(); } }
        });
      };
      try {
        const dir = await confined(roots[ref.source], runDir(ref));
        controller.signal.throwIfAborted();
        // Watch only root journals, never the workspace/repository. Screenshot writes announce themselves here.
        watcher = fs.watch(dir, (_kind, filename) => { if (!filename || ['run.json', 'events.jsonl', 'report.md'].includes(String(filename))) refresh(); });
        watcher.on('error', () => { close(); if (watch === active) watch = undefined; options.changed?.({ subscription, error: 'Cartella run non disponibile: riapri la vista.' }); });
        reading = true;
        return await api.run(ref, reader, controller.signal);
      } catch (error) { close(); if (watch === active) watch = undefined; throw error; }
      finally { reading = false; if (dirty && !closed) refresh(); }
    },
    unwatch(subscription: string): void { if (watch?.subscription === subscription) { watch.close(); watch = undefined; } },
    stop(): void { watch?.close(); watch = undefined; },
  };
  return api;
}
export type Routines = ReturnType<typeof createRoutines>;
