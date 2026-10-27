// The app's host for the shared routine runtime (packages/routine-runtime, ADR 0175): it adapts the runtime's ports to
// the app (the embedded Claude CLI and its process-tree kill, the Azure CLI token, userData paths, the app's test DB
// list, the bundled routine MCP entry) and runs every routine of the app through the package. An active routine
// version is converted with `convertFlowToPackage` (approval steps dropped, roles and app tools removed), started on its
// work item, and its run folder mirrored back into the app's run view. Used by flows/runtime.ts (advanceRun) and
// wiring.ts; the legacy step engine is no longer reached when this host is wired.
import path from 'node:path';
import fs from 'node:fs';
import { commandFor, killTrees, resolveClaude } from '../chats/cli';
import { log } from '../log';
import type { FlowAutomationConfig } from '../../shared/flow-automation';
import type { FlowDefinition, FlowRun } from '../../shared/flows';
import {
  azureCliTokenProvider, convertFlowToPackage, recordInterruptedRun, createClaudeEngine, createRoutineRuntime, createTriggerLoop, migrateLegacyWrites,
  createLegacyWriteVerifier, createDevOpsClient,
  type ConversionAutomation, type CredentialStore, type Detect, type EngineRunner, type LegacyOperation, type LegacyRun, type LegacyMigration,
  type RecognisedTestDb, type RoutineCredential, type RoutinePackage, type RoutineRuntime, type RunRecord, type TokenProvider, type TriggerLoop,
} from '../../../packages/routine-runtime/src/index';

export interface RoutineHostOptions {
  userData: string;
  /** the engine port; default the app's embedded Claude CLI, plain `claude -p` sessions */
  engine?: EngineRunner;
  /** the DevOps token port; default `az account get-access-token` (Bearer) unless the package embeds a PAT */
  token?: TokenProvider;
  /** the app's recognised test databases (Settings), so a confirmed test target needs no name rule */
  testDbTargets?: () => RecognisedTestDb[];
  /** the app's encrypted site logins for an exact origin, if any; the package's embedded ones otherwise */
  siteLogin?: (origin: string) => { user: string; password: string } | null;
  /** the bundled MCP entry (out/main/routine-mcp.js); started with the app's own Node (ELECTRON_RUN_AS_NODE) */
  mcpEntry?: string;
  /** DevOps HTTP (tests: a fake DevOps); default fetch */
  devopsRequest?: (url: string, init: RequestInit) => Promise<Response>;
}

/** The app's EngineRunner: the same embedded Claude binary the chats use, killed as a whole process tree. */
export function appClaudeEngine(): EngineRunner {
  return createClaudeEngine({
    command: (args, env) => {
      const cli = resolveClaude()?.path;
      if (!cli) throw new Error('Motore Claude non trovato: reinstalla l’app o imposta SB_CLAUDE_PATH.');
      return commandFor(cli, args, env);
    },
    killTree: pid => killTrees([pid]),
  });
}

/** The app's CredentialStore: its site vault for the login origin, else the package's embedded logins. */
export function appCredentials(pkg: RoutinePackage, siteLogin?: RoutineHostOptions['siteLogin']): CredentialStore {
  const embedded = pkg.credentials ?? [];
  const originOf = (url: string) => { try { return new URL(url).origin; } catch { return ''; } };
  return {
    forLogin(loginUrl: string): RoutineCredential | null {
      const origin = originOf(loginUrl);
      const stored = embedded.find(c => originOf(c.loginUrl) === origin);
      const own = origin && siteLogin ? siteLogin(origin) : null;
      // the vault keeps only the origin: the login page (with its query, Air's ?mode=local) stays the package's one
      if (own) return { loginUrl: stored?.loginUrl ?? loginUrl, user: own.user, password: own.password };
      return stored ?? null;
    },
    secrets: () => embedded.map(c => c.password),
  };
}

/** The app's run folders: one runs root per routine under userData, a workspace per run. */
export function appPaths(userData: string, routineId: string) {
  const root = path.join(userData, 'routine-runs', routineId);
  return { runsRoot: root, workspace: (runId: string) => path.join(root, runId, 'workspace') };
}

/** An app routine version (its export shape) as a routine package. */
export function packageOf(definition: FlowDefinition, automation?: ConversionAutomation): RoutinePackage {
  return convertFlowToPackage({ format: 'second-brain-flow', schemaVersion: 1, definition }, automation).pkg;
}

/** The work item a legacy run is about (the trigger and «Avvia» store its id as an input). */
export function workItemOf(run: Pick<FlowRun, 'inputs'>): number | undefined {
  const id = Number(run.inputs['work-item-id'] ?? run.inputs.workItem);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

export function createRoutineHost(options: RoutineHostOptions) {
  const engine = options.engine ?? appClaudeEngine();
  const runtimes = new Map<string, { digest: string; runtime: RoutineRuntime }>();
  /** package run id → the runtime that started it, while it runs: cancel reaches its session even after the cached
   *  runtime of that routine was replaced (another grant, a trigger tick) */
  const owners = new Map<string, RoutineRuntime>();
  /** app run id → package run id */
  const links = new Map<string, string>();
  const linkFile = path.join(options.userData, 'routine-runs', 'links.json');
  try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(linkFile, 'utf8')) as Record<string, string>)) links.set(k, v); } catch { /* none yet */ }
  const saveLinks = () => { fs.mkdirSync(path.dirname(linkFile), { recursive: true }); fs.writeFileSync(linkFile, JSON.stringify(Object.fromEntries(links), null, 2), { mode: 0o600 }); };
  const mcp = (kind: 'testdb' | 'devops' | 'browser') => options.mcpEntry && fs.existsSync(options.mcpEntry) ? { command: process.execPath, args: [options.mcpEntry, kind], env: { ELECTRON_RUN_AS_NODE: '1' } } : undefined;

  function runtimeFor(pkg: RoutinePackage): RoutineRuntime {
    const digest = JSON.stringify(pkg);
    const existing = runtimes.get(pkg.routine.id);
    if (existing?.digest === digest) return existing.runtime;
    const devopsMcp = mcp('devops'), testDbServer = mcp('testdb'), browserServer = mcp('browser');
    const runtime = createRoutineRuntime({
      pkg, engine, paths: appPaths(options.userData, pkg.routine.id),
      credentials: appCredentials(pkg, options.siteLogin),
      devops: { ...(options.token ? { authorization: options.token } : pkg.secrets?.devopsPat ? {} : { authorization: azureCliTokenProvider() }), ...(options.devopsRequest ? { request: options.devopsRequest } : {}), ...(devopsMcp ? { mcp: devopsMcp } : {}) },
      testDb: { ...(options.testDbTargets ? { recognised: options.testDbTargets() } : {}), ...(testDbServer ? { server: testDbServer } : {}) },
      // the routine browser (ADR 0175 item 15): the same Playwright server as the terminal, headless, never an app tab
      ...(browserServer ? { browser: { server: browserServer } } : {}),
      log: { info: (scope, msg, extra) => log.info('flows', `${scope}: ${msg}`, extra ?? {}), warn: (scope, msg, extra) => log.warn('flows', `${scope}: ${msg}`, { cause: extra?.cause ?? 'routine runtime', hint: extra?.hint ?? 'Open the run folder (report.md, events.jsonl).', ...(extra?.data !== undefined ? { data: extra.data } : {}) }) },
    });
    runtimes.set(pkg.routine.id, { digest, runtime });
    return runtime;
  }

  /** Runs (or resumes) an app run through the package; resolves when the package run ends. */
  function execute(run: FlowRun, definition: FlowDefinition, automation?: ConversionAutomation, changed?: (record: RunRecord) => void): { runId: string; finished: Promise<RunRecord> } {
    const runtime = runtimeFor(packageOf(definition, automation));
    const linked = links.get(run.id);
    const notify = (record: RunRecord) => { try { changed?.(record); } catch { /* observer only */ } };
    let handle: { runId: string; finished: Promise<RunRecord> };
    if (linked && runtime.store.runIds().includes(linked)) {
      const state = runtime.store.read(linked);
      handle = state.status === 'done' || state.status === 'cancelled' ? { runId: linked, finished: Promise.resolve(state) } : runtime.resume(linked);
    } else {
      const workItem = workItemOf(run);
      const inputs = Object.fromEntries(Object.entries(run.inputs).filter(([k]) => !k.startsWith('work-item-')));
      handle = workItem !== undefined ? runtime.startItem(workItem, inputs, run.subjectKey) : runtime.start({ inputs, subjectKey: run.subjectKey });
      links.set(run.id, handle.runId); saveLinks();
    }
    owners.set(handle.runId, runtime);
    // the run folder is polled, but only a real change reaches the observer (the app saves its store on each one)
    let last = '';
    const notifyChanged = (record: RunRecord) => { const now = JSON.stringify([record.status, record.error, record.steps]); if (now === last) return; last = now; notify(record); };
    const poll = setInterval(() => { try { notifyChanged(runtime.store.read(handle.runId)); } catch { /* not written yet */ } }, 2000);
    return { runId: handle.runId, finished: handle.finished.finally(() => { clearInterval(poll); owners.delete(handle.runId); }).then(record => { notifyChanged(record); return record; }) };
  }

  function cancel(flowRunId: string, definition: FlowDefinition): void {
    const linked = links.get(flowRunId);
    if (!linked) return;
    (owners.get(linked) ?? runtimes.get(definition.id)?.runtime ?? runtimeFor(packageOf(definition))).cancel(linked);
  }

  /** The DevOps trigger of one routine, through the package's shared loop (dedup in that routine's run store). */
  function trigger(definition: FlowDefinition, config: FlowAutomationConfig, detect: Detect, start: (workItem: number) => { runId: string }): TriggerLoop {
    const pkg = packageOf(definition, { trigger: config.trigger });
    if (!pkg.routine.trigger) throw new Error('Routine trigger: not a DevOps trigger');
    // the run store only depends on the routine id: reuse the cached runtime's, never replace it from a trigger tick
    const store = (runtimes.get(pkg.routine.id)?.runtime ?? runtimeFor(pkg)).store;
    return createTriggerLoop({ routineId: pkg.routine.id, trigger: pkg.routine.trigger, store, detect, start });
  }

  /** Items the loop started for the app but the app never queued (its dispatch refused them before an event existed):
   *  their dedup entry and cursor are released, so the next tick detects them again. */
  function releaseLost(definition: FlowDefinition, prefix: string, alive: (workItem: number) => boolean): number[] {
    const store = (runtimes.get(definition.id)?.runtime ?? runtimeFor(packageOf(definition))).store;
    const state = store.trigger(), released: number[] = [];
    for (const [key, subject] of Object.entries(state.subjects)) {
      const workItem = Number(key.replace(/^item:/, ''));
      if (!subject.runId.startsWith(prefix) || !Number.isSafeInteger(workItem) || alive(workItem)) continue;
      delete state.subjects[key]; delete state.cursor[String(workItem)]; released.push(workItem);
    }
    if (released.length) store.setTrigger(state);
    return released;
  }

  /** Legacy runs stuck in cleanup or holding a pending write: verified on DevOps and ended, no human step. */
  function migrateLegacy(runs: LegacyRun[], operations: LegacyOperation[]): Promise<LegacyMigration> {
    const client = createDevOpsClient({ authorization: options.token ?? azureCliTokenProvider() });
    return migrateLegacyWrites(runs, operations, createLegacyWriteVerifier(client));
  }

  /** An active legacy run ended by the migration (M2): its package run folder records it as interrupted (report and
   *  events), its work item counts as done for the trigger, and the app run is linked to it so it never restarts. */
  function interruptLegacy(run: FlowRun, definition: FlowDefinition, note: string): string {
    const pkg = packageOf(definition);
    const store = (runtimes.get(pkg.routine.id)?.runtime ?? runtimeFor(pkg)).store;
    const workItem = workItemOf(run);
    const inputs = Object.fromEntries(Object.entries(run.inputs).filter(([k]) => !k.startsWith('work-item-')));
    const runId = recordInterruptedRun(store, { routineId: pkg.routine.id, routineTitle: pkg.routine.title, steps: pkg.routine.steps, legacyRunId: run.id, note, inputs, now: Date.now(), ...(workItem !== undefined ? { workItem } : {}) });
    links.set(run.id, runId); saveLinks();
    return runId;
  }

  return { runtimeFor, execute, cancel, trigger, interruptLegacy, releaseLost, migrateLegacy, packageRunOf: (flowRunId: string) => links.get(flowRunId), runsRoot: (routineId: string) => appPaths(options.userData, routineId).runsRoot };
}
export type RoutineHost = ReturnType<typeof createRoutineHost>;
