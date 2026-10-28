// The shared routine runtime (ADR 0175): runs a routine package's steps in order, each as one plain Claude Code session,
// in a run folder (run-store.ts) that the app and the terminal write the same way. A step is done only when its session
// writes a valid step-result.json; the DevOps writes it lists are done here, on the run's work item, idempotently. A
// step that needs a person escalates on DevOps (escalation.ts), never in an app. `resume` continues the same run from
// the step that did not finish, under a new attempt number that fences off any older runtime still alive.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Clock, CredentialStore, EngineRunner, Paths, RuntimeLog, TokenProvider } from './ports';
import type { RoutinePackage, RoutineStep } from './format';
import { packageSecrets } from './format';
import { createMasker, type Masker } from './mask';
import { createRunStore, StaleAttempt, stepFolderName, type RunRecord, type RunStepRecord, type RunStore, type RunEscalation, type RunPark } from './run-store';
import { STEP_RESULT_FILE, StepResultError, grantedWriteOps, stepResultInstructions, validateStepResult, type StepResult, type StepWrite } from './step-result';
import { createDevOpsClient, executeWrites, type DevOpsClient, type WriteContext, type WritesOutcome } from './devops';
import { runResources, type Deployments, type ParkStop } from './devops-ops';
import { TestDeploymentCoordinator } from './devops-host/test-deployment';
import { runBranch } from './devops-host/git-push';
import { ESCALATION_POLL_MS, ESCALATION_REMINDER_MIN, MAX_ESCALATIONS, pollEscalation, replyText, writeEscalation, type EscalationIo } from './escalation';
import { actionFromStreamLine, EVENTS_FILE, type RunEvent } from './events';
import { DEVOPS_SERVER_NAME, type DevOpsServerConfig } from './devops-mcp';
import { BROWSER_SERVER_NAME, BROWSER_TOOLS, type BrowserServerConfig } from './browser-mcp';
import { azureCliToken, azureCliTokenProvider, patTokenProvider } from './token';
import { checkStepTestDbs, TESTDB_EVIDENCE, TESTDB_SERVER_NAME, writeTestDbServer, type TestDbProbe } from './testdb';
import type { RecognisedTestDb } from './testdb-guard';
import { driveLogin, type LoginPageDriver } from './login-form';
import { writeReport } from './report';
import { pathLockName, type Locks } from './locks';

export const DEFAULT_STEP_TIMEOUT_MS = 60 * 60_000;
export const DEFAULT_MAX_ATTEMPTS = 2;
/** review→fix: how many times a step with `loop` may send the run back when the package sets no `max` */
export const DEFAULT_LOOP_MAX = 2;

type Request = (url: string, init: RequestInit) => Promise<Response>;

export interface RoutineRuntimeOptions {
  pkg: RoutinePackage;
  paths: Paths;
  engine: EngineRunner;
  /** DevOps auth: default the package's PAT (Basic), else the Azure CLI (Bearer). `mcp`: how to start devops-mcp.ts
   *  (the read-only work item server offered to every step of a run with a work item); none = not offered. */
  devops?: {
    authorization?: TokenProvider; request?: Request; mcp?: { command: string; args: string[]; env?: Record<string, string> };
    /** the test deployment coordinator (default: state in <runsRoot>/test-deployments.json) */
    deployments?: Deployments;
    /** the host git push (default: git-push.ts) and the read-only Azure Resource Manager GET (default: az + fetch) */
    push?: WriteContext['push']; arm?: WriteContext['arm'];
    /** the branch a checkout is on, for a park's push (default: git symbolic-ref) */
    headOf?: WriteContext['headOf'];
  };
  /** site logins: default the package's embedded ones */
  credentials?: CredentialStore;
  testDb?: {
    /** the host's recognised test targets (the app's test DB configuration); without it the name rule applies */
    recognised?: RecognisedTestDb[];
    probe?: TestDbProbe; probeTimeoutMs?: number;
    /** how to start testdb-mcp.ts (the app's bundled entry, or node + a built file); none = test DBs are not served */
    server?: { command: string; args: string[]; env?: Record<string, string> };
  };
  /** the routine browser (browser-mcp.ts): how to start `mcp-main browser`; none = a browser step fails on this host */
  browser?: { server: { command: string; args: string[]; env?: Record<string, string> }; headless?: boolean; channel?: string };
  escalation?: { pollMs?: number; reminderMs?: number };
  clock?: Clock;
  log?: RuntimeLog;
  sleep?(ms: number, signal: AbortSignal): Promise<void>;
  /** more values to mask (host secrets) */
  secrets?: string[];
  /** cross-process locks (locks.ts): one run per work item and per `workspace` input at a time; none = not locked */
  locks?: Locks;
}

/** Thrown when another live run (any terminal) holds the work item or the workspace. */
export class ResourceBusy extends Error {}

export interface StartRequest {
  inputs?: Record<string, string>;
  /** the single work item the run is about (the DevOps trigger and `startItem` set it) */
  workItem?: number;
  /** the trigger's dedup key */
  subjectKey?: string;
  /** start at this step: the earlier ones are recorded as skipped (done, no session) */
  fromStep?: string;
}

export interface RunHandle { runId: string; finished: Promise<RunRecord> }

/** A package's embedded logins as a CredentialStore (ADR 0176). */
export function packageCredentials(pkg: RoutinePackage): CredentialStore {
  const list = pkg.credentials ?? [];
  return {
    // an origin-only login (the app's site vault keeps no login page) serves any login page of its site
    forLogin: url => list.find(c => sameLogin(c.loginUrl, url)) ?? list.find(c => originOnly(c.loginUrl) && sameOrigin(c.loginUrl, url)) ?? null,
    secrets: () => list.map(c => c.password),
  };
}
const sameLogin = (a: string, b: string): boolean => {
  try { const x = new URL(a), y = new URL(b); return x.origin === y.origin && x.pathname.replace(/\/+$/, '') === y.pathname.replace(/\/+$/, ''); } catch { return a === b; }
};
const sameOrigin = (a: string, b: string): boolean => { try { return new URL(a).origin === new URL(b).origin; } catch { return false; } };
/** A credential stored for a whole site (`https://host/`): its login page is the one that asked. */
const originOnly = (url: string): boolean => { try { const u = new URL(url); return u.pathname === '/' && !u.search; } catch { return false; } };

const defaultSleep = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
  if (signal.aborted) { resolve(); return; }
  const t = setTimeout(done, ms);
  function done() { clearTimeout(t); signal.removeEventListener('abort', done); resolve(); }
  signal.addEventListener('abort', done, { once: true });
});

const newRunId = (now: number): string => {
  const d = new Date(now), p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}-${randomBytes(3).toString('hex')}`;
};

/** Fills {{workItem}}, {{work-item-id}}, {{work-item-url}}, {{input.<name>}} and {{<name>}} for the run's inputs. */
export function fillPlaceholders(text: string, run: Pick<RunRecord, 'inputs' | 'workItem'>, organization?: string): string {
  const id = run.workItem !== undefined ? String(run.workItem) : '';
  const url = id && organization ? `https://dev.azure.com/${encodeURIComponent(organization)}/_workitems/edit/${id}` : '';
  return text.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (whole, name: string) => {
    if (name === 'workItem' || name === 'work-item-id') return id || whole;
    if (name === 'work-item-url') return url || whole;
    const key = name.startsWith('input.') ? name.slice(6) : name;
    return Object.prototype.hasOwnProperty.call(run.inputs, key) ? run.inputs[key]! : whole;
  });
}

export function createRoutineRuntime(options: RoutineRuntimeOptions) {
  const { pkg, paths, engine } = options;
  const routine = pkg.routine;
  const clock = options.clock ?? { now: () => Date.now() };
  const sleep = options.sleep ?? defaultSleep;
  const credentials = options.credentials ?? packageCredentials(pkg);
  const masker: Masker = createMasker([...packageSecrets(pkg), ...credentials.secrets(), ...(options.secrets ?? [])]);
  const store: RunStore = createRunStore(paths.runsRoot, masker);
  const organization = routine.devops?.organization ?? routine.trigger?.organization;
  let client: DevOpsClient | undefined;
  const devops = (): DevOpsClient => client ??= createDevOpsClient({
    authorization: options.devops?.authorization ?? (pkg.secrets?.devopsPat ? patTokenProvider(pkg.secrets.devopsPat) : azureCliTokenProvider()),
    ...(options.devops?.request ? { request: options.devops.request } : {}),
  });
  /** test deployments of every run of this runtime's runs root: one lease per target (devops-host/test-deployment.ts) */
  const deployments: Deployments = options.devops?.deployments ?? new TestDeploymentCoordinator(() => routine.devops?.deployTargets ?? [], path.join(paths.runsRoot, 'test-deployments.json'));
  const arm = options.devops?.arm ?? (async (resourceId: string) => {
    if (!/^\/subscriptions\/[a-zA-Z0-9-]+\/resourceGroups\/[^?#\s]+$/.test(resourceId)) throw new Error('Invalid Azure resource id');
    const token = await azureCliToken(AbortSignal.timeout(60_000), 'https://management.azure.com/');
    const response = await (options.devops?.request ?? fetch)(`https://management.azure.com${resourceId}?api-version=2024-04-01`, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(60_000), headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Azure: GET failed (HTTP ${response.status})`);
    return await response.json() as Record<string, unknown>;
  });
  const running = new Map<string, AbortController>();
  const warn = (msg: string, data?: unknown, cause?: string) => { try { options.log?.warn('routine', msg, { data, ...(cause ? { cause: masker.mask(cause) } : {}) }); } catch { /* best effort */ } };
  const info = (msg: string, data?: unknown) => { try { options.log?.info('routine', msg, { data }); } catch { /* best effort */ } };
  /** live progress (events.jsonl): best effort, never stops a run */
  const emit = (runId: string, event: RunEvent) => { try { store.appendEvent(runId, event); } catch (e) { warn('event not written', { runId, type: event.type }, e instanceof Error ? e.message : String(e)); } };
  const itemUrl = (project: string | undefined, id: number) => organization ? `https://dev.azure.com/${encodeURIComponent(organization)}/${project ? `${encodeURIComponent(project)}/` : ''}_workitems/edit/${id}` : undefined;

  function inputsFor(request: StartRequest): Record<string, string> {
    const inputs: Record<string, string> = {};
    for (const input of routine.inputs) {
      // a default may name the run's work item: one checkout per item (…\app-{{workItem}})
      const value = request.inputs?.[input.name] ?? (request.workItem !== undefined ? input.default?.replace(/\{\{\s*workItem\s*\}\}/g, String(request.workItem)) : input.default);
      if (value !== undefined) inputs[input.name] = value;
    }
    if (request.workItem !== undefined) {
      if (!Number.isInteger(request.workItem) || request.workItem <= 0) throw new Error('workItem must be a positive work item id');
      inputs.workItem = String(request.workItem);
    }
    for (const input of routine.inputs) if (input.required && !inputs[input.name]?.trim()) throw new Error(`Input "${input.name}" is required`);
    return inputs;
  }

  const workItemOf = (inputs: Record<string, string>, explicit?: number): number | undefined => {
    if (explicit !== undefined) return explicit;
    const raw = inputs.workItem?.trim();
    return raw && /^\d{1,10}$/.test(raw) ? Number(raw) : undefined;
  };

  /** escalation.park: a step that needs a person parks the run (one comment, tag, run branch pushed) instead of waiting */
  const parking = (run: Pick<RunRecord, 'workItem'>) => Boolean(routine.escalation?.park && routine.devops?.ops.includes('downgrade') && routine.devops.downgrade && run.workItem !== undefined);
  const contactOf = () => routine.escalation ? { id: routine.escalation.contact, ...(routine.escalation.contactName ? { name: routine.escalation.contactName } : {}) } : undefined;
  /** the step a park resumes from: the named one when it is this step or an earlier one, else this step */
  const resumeStepOf = (stepId: string, named?: string): string => {
    const here = routine.steps.findIndex(s => s.id === stepId), at = named === undefined ? -1 : routine.steps.findIndex(s => s.id === named);
    return at >= 0 && at <= here ? named! : stepId;
  };
  const parkStop = (run: RunRecord, def: RoutineStep): ParkStop => {
    const n = run.steps.find(s => s.id === def.id)?.n ?? 0;
    return { n: (run.parks ?? 0) + 1, step: def.title, position: `passo ${n} di ${run.steps.length}`,
      resumeStep: named => routine.steps.find(s => s.id === resumeStepOf(def.id, named))?.title ?? def.title };
  };
  const writeContext = (runId: string, attempt: number, def: RoutineStep, run: RunRecord, round: number, signal: AbortSignal, stepDir?: string, stepId = def.id): WriteContext => {
    const contact = contactOf();
    return { runId, attempt, stepId, workItem: run.workItem!, grant: routine.devops!, client: devops(), store, masker,
      inputs: run.inputs, deployments, arm, ...(contact ? { contact } : {}), ...(options.devops?.push ? { push: options.devops.push } : {}),
      ...(parking(run) ? { park: parkStop(run, def) } : {}), ...(options.devops?.headOf ? { headOf: options.devops.headOf } : {}),
      ...(stepDir ? { stepDir } : {}), round, sleep: ms => sleep(ms, signal), now: () => clock.now() };
  };

  /** The locks a run holds while it goes on: its work item and its `workspace` input (any terminal, any package). */
  const lockNames = (run: Pick<RunRecord, 'workItem' | 'inputs'>): string[] => [
    ...(run.workItem !== undefined ? [`item-${(organization ?? 'none').replace(/[^a-zA-Z0-9_-]/g, '_')}-${run.workItem}`] : []),
    ...(run.inputs.workspace?.trim() ? [pathLockName('workspace', run.inputs.workspace.trim())] : []),
  ];
  /** Takes every lock of the run, or none: the message names the live holder. */
  function lockRun(runId: string, run: Pick<RunRecord, 'workItem' | 'inputs'>): void {
    const locks = options.locks;
    if (!locks) return;
    const taken: string[] = [];
    for (const name of lockNames(run)) {
      if (locks.acquire(name, runId)) { taken.push(name); continue; }
      locks.release(taken, runId);
      const holder = locks.holder(name);
      const what = name.startsWith('item-') ? `work item ${run.workItem}` : `workspace ${run.inputs.workspace}`;
      throw new ResourceBusy(`${what} is in use by run ${holder?.owner ?? '?'} (pid ${holder?.pid ?? '?'} on ${holder?.host ?? '?'}): start it again when that run ends`);
    }
  }
  const unlockRun = (runId: string, run: Pick<RunRecord, 'workItem' | 'inputs'>) => { try { options.locks?.release(lockNames(run), runId); } catch { /* best effort: the lock expires */ } };

  /** Starts a new run. */
  function start(request: StartRequest = {}): RunHandle {
    const inputs = inputsFor(request), now = clock.now(), runId = newRunId(now);
    const workItem = workItemOf(inputs, request.workItem);
    const from = request.fromStep === undefined ? 0 : routine.steps.findIndex(s => s.id === request.fromStep);
    if (from < 0) throw new Error(`No step "${request.fromStep}" in this routine (steps: ${routine.steps.map(s => s.id).join(', ')})`);
    lockRun(runId, { inputs, ...(workItem !== undefined ? { workItem } : {}) });
    const run: RunRecord = {
      schema: 1, runId, routineId: routine.id, routineTitle: routine.title, status: 'running', attempt: 0,
      inputs, ...(workItem !== undefined ? { workItem } : {}), ...(request.subjectKey ? { subjectKey: request.subjectKey } : {}),
      createdAt: now, updatedAt: now,
      steps: routine.steps.map((s, i) => i < from
        ? { n: i + 1, id: s.id, title: s.title, status: 'done', attempts: 0, summary: `skipped (started from step ${request.fromStep})` }
        : { n: i + 1, id: s.id, title: s.title, status: 'pending', attempts: 0 }),
    };
    let claimed: RunRecord;
    try { fs.mkdirSync(paths.runsRoot, { recursive: true }); store.create(run); claimed = store.claim(runId); }
    catch (e) { unlockRun(runId, run); throw e; }
    emit(runId, { type: 'run-start', at: now, runId, routine: routine.id, total: routine.steps.length, ...(workItem !== undefined ? { workItem } : {}) });
    info('run started', { runId, routine: routine.id, workItem });
    return { runId, finished: execute(runId, claimed.attempt) };
  }

  /** Starts a run for one work item: the same path the DevOps trigger uses. */
  const startItem = (workItem: number, inputs?: Record<string, string>, subjectKey = `item:${workItem}`): RunHandle =>
    start({ workItem, subjectKey, ...(inputs ? { inputs } : {}) });

  /** Continues the same run from the step that did not finish; any older runtime of this run stops at its next write. */
  function resume(runId: string): RunHandle {
    running.get(runId)?.abort();
    const before = store.read(runId);
    if (before.status === 'done') throw new Error(`Run ${runId} is done`);
    lockRun(runId, before);
    const claimed = store.claim(runId, run => {
      run.status = run.escalation && run.escalation.state !== 'answered' ? 'waiting-human' : 'running';
      delete run.error; delete run.endedAt;
      for (const s of run.steps) if (s.status === 'running' || s.status === 'failed' || (s.status === 'needs-human' && !run.escalation)) { s.status = 'pending'; delete s.error; }
    });
    emit(runId, { type: 'run-resume', at: clock.now(), attempt: claimed.attempt });
    info('run resumed', { runId, attempt: claimed.attempt });
    return { runId, finished: execute(runId, claimed.attempt) };
  }

  /** Stops a run: its session is killed, the run stays resumable. */
  function cancel(runId: string): void {
    const controller = running.get(runId);
    if (controller) { controller.abort(); return; }
    const run = store.read(runId);
    if (run.status === 'done' || run.status === 'cancelled') return;
    store.claim(runId, r => { r.status = 'cancelled'; r.endedAt = clock.now(); });
    emit(runId, { type: 'run-end', at: clock.now(), status: 'cancelled' });
    writeReport(store, store.read(runId));
  }

  async function execute(runId: string, attempt: number): Promise<RunRecord> {
    const controller = new AbortController();
    running.set(runId, controller);
    const update = (mutate: (run: RunRecord) => void) => store.update(runId, attempt, mutate);
    const step = (run: RunRecord, id: string) => run.steps.find(s => s.id === id)!;
    try {
      for (let i = 0; i < routine.steps.length; i++) {
        const def = routine.steps[i]!;
        let run = store.read(runId);
        let record = step(run, def.id);
        if (record.status === 'done') continue;
        let guidance: RunEscalation['answer'] | undefined;
        if (run.escalation?.stepId === def.id && run.escalation.state !== 'answered') {
          const answered = await waitForHuman(runId, attempt, controller.signal);
          if (!answered) return finish(runId, attempt, controller.signal);
          guidance = answered;
        } else if (run.escalation?.stepId === def.id && run.escalation.answer) guidance = run.escalation.answer;
        else if (run.parked?.answer && parkedRange(run.parked).includes(def.id)) guidance = run.parked.answer;
        const max = def.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
        let tries = 0, lastError: string | undefined, back: number | undefined;
        for (;;) {
          if (controller.signal.aborted) return finish(runId, attempt, controller.signal);
          tries++;
          let outcome = await runStep(runId, attempt, def, guidance, lastError, controller.signal);
          run = store.read(runId); record = step(run, def.id);
          if (outcome.kind === 'done') break;
          if (outcome.kind === 'send-back') {
            const loop = def.loop!, max = loop.max ?? DEFAULT_LOOP_MAX, to = routine.steps.findIndex(s => s.id === loop.to), reason = outcome.reason;
            if ((record.loops ?? 0) < max && to >= 0 && to < i) {
              // the target and every step after it up to this one run again, each in a new round folder
              run = update(r => {
                step(r, def.id).loops = (step(r, def.id).loops ?? 0) + 1;
                for (const s of routine.steps.slice(to, i + 1)) { const x = step(r, s.id); x.round = (x.round ?? 1) + 1; x.status = 'pending'; delete x.error; delete x.endedAt; }
                step(r, loop.to).sentBack = { by: def.title, reason };
              });
              const target = step(run, loop.to);
              emit(runId, { type: 'loop', at: clock.now(), n: record.n, from: def.id, to: loop.to, round: target.round ?? 2, reason });
              info('run sent back', { runId, from: def.id, to: loop.to, round: target.round });
              back = to; break;
            }
            // past the package's limit: a person decides, as for any step that needs one
            const question = `${def.title}: after ${max} round(s) back to ${routine.steps[to]?.title ?? loop.to} there are still findings: ${reason}`;
            update(r => { const s = step(r, def.id); s.status = 'needs-human'; s.endedAt = clock.now(); });
            emit(runId, { type: 'step-end', at: clock.now(), n: record.n, id: def.id, status: 'needs-human', summary: question });
            outcome = { kind: 'needs-human', question };
          }
          // a parking package: the step that needs a person parks the run (the watch resumes it on the answer)
          if (outcome.kind === 'needs-human' && parking(run)) outcome = await parkWrites(runId, attempt, def, outcome.question, controller.signal);
          if (outcome.kind === 'downgraded' && outcome.parked) {
            const parked = outcome.parked, reason = outcome.reason, resumeFrom = resumeStepOf(def.id, outcome.resumeFrom);
            update(r => {
              const s = step(r, def.id); s.status = 'needs-human'; s.endedAt = clock.now();
              r.parked = { n: (r.parks ?? 0) + 1, stepId: def.id, resumeFrom, at: clock.now(), question: reason,
                branch: parked.branch, pushed: parked.pushed, ...(parked.commentId !== undefined ? { commentId: parked.commentId } : {}) };
              r.status = 'needs-human'; r.endedAt = clock.now(); r.error = `step ${def.id} parked: ${reason}`;
            });
            emit(runId, { type: 'step-end', at: clock.now(), n: record.n, id: def.id, status: 'needs-human', summary: `parked: ${reason}` });
            return finish(runId, attempt, controller.signal);
          }
          // a downgrade handed the item back to a person: the run stops here (no later step)
          if (outcome.kind === 'downgraded') { update(r => { r.status = 'needs-human'; r.endedAt = clock.now(); r.error = `step ${def.id} downgraded the work item: ${outcome.reason}`; }); return finish(runId, attempt, controller.signal); }
          if (controller.signal.aborted) return finish(runId, attempt, controller.signal);
          if (outcome.kind === 'needs-human' && parking(run)) {
            // the park itself did not run (refused, item unreadable): the run stops for a person, as without a contact
            update(r => { r.status = 'needs-human'; r.endedAt = clock.now(); r.error = `step ${def.id} needs a person: ${outcome.question}`; });
            return finish(runId, attempt, controller.signal);
          }
          if (outcome.kind === 'needs-human') {
            const escalated = await escalate(runId, attempt, def, outcome.question);
            if (!escalated) { update(r => { r.status = 'needs-human'; r.endedAt = clock.now(); r.error = `step ${def.id} needs a person: ${outcome.question}`; }); return finish(runId, attempt, controller.signal); }
            const answered = await waitForHuman(runId, attempt, controller.signal);
            if (!answered) return finish(runId, attempt, controller.signal);
            guidance = answered; tries = 0; lastError = undefined;
            continue;
          }
          lastError = outcome.error;
          if (tries >= max) { update(r => { r.status = 'failed'; r.endedAt = clock.now(); r.error = `step ${def.id}: ${outcome.error}`; }); return finish(runId, attempt, controller.signal); }
        }
        if (back !== undefined) i = back - 1;
      }
      update(r => { r.status = 'done'; r.endedAt = clock.now(); delete r.error; });
      return finish(runId, attempt, controller.signal);
    } catch (error) {
      if (error instanceof StaleAttempt) { info('run attempt superseded', { runId, attempt }); return store.read(runId); }
      warn('run crashed', { runId }, error instanceof Error ? error.message : String(error));
      try { update(r => { r.status = 'failed'; r.endedAt = clock.now(); r.error = masker.mask(error instanceof Error ? error.message : String(error)); }); } catch { /* superseded */ }
      return finish(runId, attempt, controller.signal);
    } finally {
      if (running.get(runId) === controller) running.delete(runId);
    }
  }

  /** The run's browser profile (cookies of its logins): one temp folder per run, removed when the run ends. */
  const browserProfile = (runId: string) => path.join(os.tmpdir(), 'routine-browser', `${routine.id}-${runId}`);

  function finish(runId: string, attempt: number, signal: AbortSignal): RunRecord {
    try { fs.rmSync(browserProfile(runId), { recursive: true, force: true }); } catch { /* a browser still closing: temp */ }
    let run = store.read(runId);
    if (run.attempt !== attempt) return run;
    if (signal.aborted && (run.status === 'running' || run.status === 'waiting-human')) {
      run = store.update(runId, attempt, r => { r.status = 'cancelled'; r.endedAt = clock.now(); for (const s of r.steps) if (s.status === 'running') s.status = 'pending'; });
    }
    unlockRun(runId, run);
    writeReport(store, run);
    emit(runId, { type: 'run-end', at: clock.now(), status: run.status, ...(run.error ? { error: run.error } : {}) });
    info('run ended', { runId, status: run.status });
    return run;
  }

  type StepOutcome = { kind: 'done' } | { kind: 'failed'; error: string } | { kind: 'needs-human'; question: string } | { kind: 'send-back'; reason: string }
    | { kind: 'downgraded'; reason: string; resumeFrom?: string; parked?: WritesOutcome['parked'] };

  /** The steps a park answer guides: from the resume step through the parked one. */
  function parkedRange(p: RunPark): string[] {
    const from = routine.steps.findIndex(s => s.id === p.resumeFrom), to = routine.steps.findIndex(s => s.id === p.stepId);
    return from < 0 || to < from ? [p.stepId] : routine.steps.slice(from, to + 1).map(s => s.id);
  }

  /** Parks the run at a step that needs a person: the package's downgrade as a park (comment, tags, run branch). */
  async function parkWrites(runId: string, attempt: number, def: RoutineStep, question: string, signal: AbortSignal): Promise<Extract<StepOutcome, { kind: 'needs-human' | 'downgraded' }>> {
    const run = store.read(runId), record = run.steps.find(s => s.id === def.id)!;
    let writes: WritesOutcome;
    try { writes = await executeWrites(writeContext(runId, attempt, def, run, record.round ?? 1, signal), [{ op: 'downgrade', reason: question }]); }
    catch (e) {
      if (e instanceof StaleAttempt) throw e;
      warn('run not parked', { runId }, e instanceof Error ? e.message : String(e));
      return { kind: 'needs-human', question };
    }
    for (const [status, list] of [['done', writes.done], ['not-verified', writes.notVerified], ['failed', writes.failed]] as const)
      for (const what of list) emit(runId, { type: 'write', at: clock.now(), n: record.n, what, status });
    return writes.parked ? { kind: 'downgraded', reason: question, parked: writes.parked } : { kind: 'needs-human', question };
  }

  async function runStep(runId: string, attempt: number, def: RoutineStep, guidance: RunEscalation['answer'] | undefined, lastError: string | undefined, signal: AbortSignal): Promise<StepOutcome> {
    const update = (mutate: (record: RunStepRecord, run: RunRecord) => void) => store.update(runId, attempt, r => mutate(r.steps.find(s => s.id === def.id)!, r));
    let run = update((s, r) => { s.status = 'running'; s.attempts += 1; s.startedAt = clock.now(); delete s.endedAt; delete s.error; r.status = 'running'; });
    const record = run.steps.find(s => s.id === def.id)!;
    try { options.locks?.refresh(lockNames(run), runId); } catch { /* best effort */ }
    emit(runId, { type: 'step-start', at: clock.now(), n: record.n, total: run.steps.length, id: def.id, title: def.title, attempt: record.attempts });
    const dir = store.stepDir(runId, record.n, def.id, record.round);
    const resultFile = path.join(dir, STEP_RESULT_FILE);
    fs.rmSync(resultFile, { force: true });
    const cwd = paths.workspace(runId);
    fs.mkdirSync(cwd, { recursive: true });

    // test DBs: checked once per step attempt, never a blocker
    const disposers: (() => void)[] = [];
    const mcpServers: Record<string, unknown> = {};
    for (const name of def.mcpServers ?? []) { const server = routine.mcpServers?.[name]; if (server) mcpServers[name] = server; }
    let testDbNote: string | undefined;
    if (def.testDbs?.length) {
      const check = await checkStepTestDbs(def.testDbs, routine.testDbs ?? [], pkg.secrets?.testDbs ?? {}, {
        ...(options.testDb?.recognised ? { recognised: options.testDb.recognised } : {}),
        ...(options.testDb?.probe ? { probe: options.testDb.probe } : {}),
        ...(options.testDb?.probeTimeoutMs ? { timeoutMs: options.testDb.probeTimeoutMs } : {}),
      });
      let status = check.status, note = check.note;
      if (status === 'available' && !options.testDb?.server) { status = 'unavailable'; note = `${note}; DB unavailable (this host does not serve test DBs)`; }
      if (status === 'available' && options.testDb?.server) {
        const served = writeTestDbServer({ targets: check.targets, ...(options.testDb.recognised ? { recognised: options.testDb.recognised } : {}), evidence: path.join(dir, 'evidence', TESTDB_EVIDENCE) }, options.testDb.server);
        disposers.push(served.dispose);
        mcpServers[TESTDB_SERVER_NAME] = served.entry;
      }
      testDbNote = status === 'available' ? `Read-only test databases: ${check.targets.map(t => t.id).join(', ')} through the ${TESTDB_SERVER_NAME} MCP tool test_db_query (one SELECT per call). ${note}`
        : `Test databases: ${note}. Continue without them and say so in your summary.`;
      run = update(s => { s.testDb = status; s.testDbNote = note; });
      if (status !== 'available') emit(runId, { type: 'db-unavailable', at: clock.now(), n: record.n, note });
    }
    // the work item: read into the prompt, plus the read-only routine-devops MCP for ad-hoc reads (ADR 0175)
    const item = await workItemContext(run);
    if (item.project && options.devops?.mcp && organization) {
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'routine-devops-'));
      disposers.push(() => { try { fs.rmSync(temp, { recursive: true, force: true }); } catch { /* temp */ } });
      const file = path.join(temp, 'devops.json');
      const config: DevOpsServerConfig = { organization, projects: routine.devops?.projects ?? (routine.trigger?.project ? [routine.trigger.project] : [item.project]), evidence: path.join(dir, 'evidence'), ...(pkg.secrets?.devopsPat ? { pat: pkg.secrets.devopsPat } : {}),
        ...(routine.devops?.deployTargets?.length ? { deployTargets: routine.devops.deployTargets, runId, ledgerFile: path.join(store.runDir(runId), 'ledger.json'), deployStateFile: path.join(paths.runsRoot, 'test-deployments.json') } : {}) };
      fs.writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
      mcpServers[DEVOPS_SERVER_NAME] = { command: options.devops.mcp.command, args: options.devops.mcp.args, env: { ...(options.devops.mcp.env ?? {}), SB_ROUTINE_DEVOPS_CONFIG: file } };
    }
    // the routine browser: its own MCP server, logins done by it from the package credentials (ADR 0175)
    let browserNote: string | undefined;
    if (def.browser && routine.browser) {
      if (!options.browser) {
        for (const dispose of disposers) dispose();
        const why = 'this host does not serve the routine browser (routine-browser)';
        update(s => { s.status = 'failed'; s.endedAt = clock.now(); s.error = why; });
        emit(runId, { type: 'step-end', at: clock.now(), n: record.n, id: def.id, status: 'failed', error: why });
        return { kind: 'failed', error: why };
      }
      const origins = routine.browser.origins;
      const logins: BrowserServerConfig['logins'] = [];
      for (const c of pkg.credentials ?? []) {
        if (!origins.includes(new URL(c.loginUrl).origin)) continue;
        // the first login of a page comes from the run's store; a further named one (a second user) is the package's own
        const first = (pkg.credentials ?? []).find(x => sameLogin(x.loginUrl, c.loginUrl)) === c;
        const credential = (first ? await credentials.forLogin(c.loginUrl) : null) ?? c;
        const success = routine.loginSuccess?.find(l => sameLogin(l.loginUrl, c.loginUrl))?.success;
        logins.push({ ...(c.id ? { id: c.id } : {}), loginUrl: c.loginUrl, user: credential.user, password: credential.password, ...(success ? { success } : {}) });
      }
      const profileDir = browserProfile(runId);
      fs.mkdirSync(profileDir, { recursive: true });
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'routine-browser-cfg-'));
      disposers.push(() => { try { fs.rmSync(temp, { recursive: true, force: true }); } catch { /* temp */ } });
      const file = path.join(temp, 'browser.json');
      const config: BrowserServerConfig = { origins, profileDir, evidence: path.join(dir, 'evidence'), events: { file: path.join(paths.runsRoot, runId, EVENTS_FILE), n: record.n },
        headless: options.browser.headless !== false, ...(options.browser.channel ? { channel: options.browser.channel } : {}), logins,
        ...(routine.browser.hide ? { hide: routine.browser.hide } : {}) };
      fs.writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
      mcpServers[BROWSER_SERVER_NAME] = { command: options.browser.server.command, args: options.browser.server.args, env: { ...(options.browser.server.env ?? {}), SB_ROUTINE_BROWSER_CONFIG: file } };
      browserNote = `A browser for ${origins.join(', ')}: the ${BROWSER_SERVER_NAME} MCP tools ${BROWSER_TOOLS.join(', ')}. `
        + 'Site logins are done for you by the runtime when a page asks for one: never type a password, never ask for one. '
        + (logins.some(l => l.id) ? `Named credentials: ${logins.filter(l => l.id).map(l => `"${l.id}"`).join(', ')}: \`login\` {credential, user?} signs out and in again as one of them (user = another login name, the password stays the stored one; no credential = back to the default login); \`fill_secret\` {ref, credential} fills a password field with that credential's password (e.g. setting a user's password in an admin page). `
          : '')
        + 'Use snapshot to see the page and its element refs; save evidence with screenshot (it lands in the evidence folder of this step).';
    }
    let mcpConfig: string | undefined;
    if (Object.keys(mcpServers).length) {
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'routine-mcp-'));
      disposers.push(() => { try { fs.rmSync(temp, { recursive: true, force: true }); } catch { /* temp */ } });
      mcpConfig = path.join(temp, 'mcp.json');
      fs.writeFileSync(mcpConfig, JSON.stringify({ mcpServers }), { mode: 0o600 });
    }

    const prompt = buildPrompt(def, run, dir, guidance, lastError, testDbNote, item.text, Boolean(mcpServers[DEVOPS_SERVER_NAME]), browserNote);
    store.writeText(path.join(dir, 'prompt.md'), prompt);
    const transcript = path.join(dir, 'transcript.jsonl');
    store.appendText(transcript, `${JSON.stringify({ type: 'routine_attempt', attempt: record.attempts, at: clock.now() })}\n`);
    let outcome, lastAction: string | undefined;
    try {
      outcome = await engine.run({
        runId, stepId: def.id, attempt: record.attempts, prompt, cwd, stepDir: dir,
        ...(def.model ? { model: def.model } : {}), ...(def.effort ? { effort: def.effort } : {}),
        ...(def.allowedTools?.length ? { allowedTools: browserNote && !def.allowedTools.includes(`mcp__${BROWSER_SERVER_NAME}__*`) ? [...def.allowedTools, `mcp__${BROWSER_SERVER_NAME}__*`] : def.allowedTools } : {}),
        ...(mcpConfig ? { mcpConfig } : {}),
        env: { ROUTINE_RUN_ID: runId, ROUTINE_STEP_DIR: dir, ...(run.workItem !== undefined ? { ROUTINE_WORK_ITEM: String(run.workItem) } : {}) },
        timeoutMs: def.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS, signal,
        onLine: line => {
          store.appendText(transcript, `${line}\n`);
          const action = actionFromStreamLine(line);
          if (action && action !== lastAction) { lastAction = action; emit(runId, { type: 'action', at: clock.now(), n: record.n, text: action }); }
        },
      });
    } finally {
      for (const dispose of disposers) dispose();
    }
    store.maskFolder(dir);
    try { for (const shot of fs.readdirSync(path.join(dir, 'screenshots')).sort()) emit(runId, { type: 'screenshot', at: clock.now(), n: record.n, path: path.join(dir, 'screenshots', shot) }); } catch { /* none */ }

    let result: StepResult | undefined, error: string | undefined;
    try {
      if (!fs.existsSync(resultFile)) throw new StepResultError(outcome.error ? `the session ended without ${STEP_RESULT_FILE} (${outcome.error})` : `the session ended without ${STEP_RESULT_FILE}`);
      let parsed: unknown;
      try { parsed = JSON.parse(fs.readFileSync(resultFile, 'utf8')); } catch { throw new StepResultError(`${STEP_RESULT_FILE} is not valid JSON`); }
      result = validateStepResult(parsed);
    } catch (e) { error = masker.mask(e instanceof Error ? e.message : String(e)); }

    // DevOps writes never block the run (owner, 2026-10-27): refused or unconfirmed writes are recorded and reported
    let writes: WritesOutcome | undefined;
    if (result?.outcome === 'done' && result.devopsWrites?.length) {
      try {
        if (run.workItem === undefined) throw new Error('DevOps writes need a run started for a work item');
        if (!routine.devops) throw new Error('the package does not declare devops writes');
        writes = await executeWrites(writeContext(runId, attempt, def, run, record.round ?? 1, signal, dir), result.devopsWrites);
      } catch (e) {
        if (e instanceof StaleAttempt) throw e;
        // a write the package does not allow is the session's mistake: the step retries with the reason
        error = `DevOps writes refused: ${masker.mask(e instanceof Error ? e.message : String(e))}`; result = undefined;
      }
      for (const [status, list] of [['done', writes?.done], ['not-verified', writes?.notVerified], ['failed', writes?.failed]] as const)
        for (const what of list ?? []) emit(runId, { type: 'write', at: clock.now(), n: record.n, what, status });
    }
    const now = clock.now();
    const ended = (status: string, extra: { summary?: string; error?: string } = {}) => emit(runId, { type: 'step-end', at: now, n: record.n, id: def.id, status, ...extra });
    if (result?.outcome === 'done') {
      const summary = masker.mask(result.summary);
      update(s => {
        s.status = 'done'; s.endedAt = now; s.summary = summary; if (outcome.sessionId) s.sessionId = outcome.sessionId; delete s.error;
        if (writes?.done.length) s.writes = writes.done;
        if (writes?.notVerified.length) s.notVerified = writes.notVerified;
        if (writes?.failed.length) s.failedWrites = writes.failed;
      });
      ended('done', { summary });
      if (writes?.downgraded) return { kind: 'downgraded', reason: writes.downgraded, ...(writes.resumeFrom ? { resumeFrom: writes.resumeFrom } : {}), ...(writes.parked ? { parked: writes.parked } : {}) };
      return result.sendBack && def.loop ? { kind: 'send-back', reason: masker.mask(result.sendBack.reason) } : { kind: 'done' };
    }
    if (result?.outcome === 'needs-human') {
      update(s => { s.status = 'needs-human'; s.endedAt = now; s.summary = masker.mask(result!.summary); if (outcome.sessionId) s.sessionId = outcome.sessionId; });
      ended('needs-human', { summary: masker.mask(result.summary) });
      return { kind: 'needs-human', question: masker.mask(result.question ?? result.summary) };
    }
    const why = error ?? masker.mask(result?.summary ?? 'the step failed');
    update(s => { s.status = 'failed'; s.endedAt = now; s.error = why; if (result) s.summary = masker.mask(result.summary); if (outcome.sessionId) s.sessionId = outcome.sessionId; });
    ended('failed', { error: why });
    return { kind: 'failed', error: why };
  }

  /** The run's work item as prompt text (title, type, state, description, repro steps); a read failure is a note. */
  async function workItemContext(run: RunRecord): Promise<{ text?: string; project?: string }> {
    if (run.workItem === undefined || !organization) return {};
    try {
      const item = await devops().item(organization, run.workItem);
      const f = item.fields, s = (k: string) => typeof f[k] === 'string' ? f[k] as string : '';
      const clip = (t: string, n: number) => t.length > n ? `${t.slice(0, n)}…` : t;
      const lines = [`Work item ${run.workItem}: ${s('System.Title')}`, `Type ${s('System.WorkItemType') || '?'} · state ${s('System.State') || '?'} · project ${item.project}${s('System.Tags') ? ` · tags ${s('System.Tags')}` : ''}`];
      for (const [label, field] of [['Description', 'System.Description'], ['Repro steps', 'Microsoft.VSTS.TCM.ReproSteps'], ['Acceptance criteria', 'Microsoft.VSTS.Common.AcceptanceCriteria']] as const) {
        const text = replyText(s(field)); if (text) lines.push('', `### ${label}`, clip(text, 6000));
      }
      return { text: masker.mask(lines.join('\n')), project: item.project };
    } catch (e) {
      warn('work item not read', { runId: run.runId }, e instanceof Error ? e.message : String(e));
      return { text: `The work item could not be read now (${masker.mask(e instanceof Error ? e.message : String(e))}); continue with what you have.` };
    }
  }

  function buildPrompt(def: RoutineStep, run: RunRecord, dir: string, guidance: RunEscalation['answer'] | undefined, lastError: string | undefined, testDbNote: string | undefined, itemText?: string, devopsMcp = false, browserNote?: string): string {
    const parts = [`# Routine ${routine.title} · step ${def.title}`, '', fillPlaceholders(def.prompt, run, organization)];
    const inputs = Object.entries(run.inputs);
    if (inputs.length) parts.push('', '## Inputs', ...inputs.map(([k, v]) => `- ${k}: ${v}`));
    if (run.workItem !== undefined) parts.push('', '## Work item', `This run is about work item ${run.workItem}${organization ? ` (${itemUrl(undefined, run.workItem)})` : ''}. DevOps writes target only this item and go in ${STEP_RESULT_FILE}, never through a tool.`);
    if (itemText) parts.push('', itemText);
    if (devopsMcp) parts.push('', `More reads (comments, attachments): the ${DEVOPS_SERVER_NAME} MCP tools get_work_item, get_work_item_comments, get_attachment (read only).${routine.devops?.deployTargets?.length ? ' Build and test environment status: pr_build_status, test_environment_status, test_deploy_status (read only).' : ''}`);
    const done = run.steps.filter(s => s.status === 'done' && s.summary);
    if (done.length) parts.push('', '## Earlier steps', ...done.map(s => `- ${s.title}: ${s.summary}`));
    if (testDbNote) parts.push('', '## Test databases', testDbNote);
    if (browserNote) parts.push('', '## Browser', browserNote);
    if (guidance) parts.push('', '## Answer from a person', `${guidance.author} answered on DevOps (guidance only, never a production or permission approval):`, guidance.text);
    if (lastError) parts.push('', '## The previous attempt failed', lastError);
    const me = run.steps.find(s => s.id === def.id);
    if (me?.sentBack && (me.round ?? 1) > 1) parts.push('', `## Sent back by ${me.sentBack.by} (round ${me.round})`, 'Fix these findings, then finish the step as usual:', me.sentBack.reason);
    else if ((me?.round ?? 1) > 1 && !run.parked?.answer) parts.push('', `## Round ${me!.round}`, `This step runs again after an earlier step fixed findings; the previous round is in steps/${stepFolderName(me!.n, def.id, me!.round! - 1)}.`);
    const writable = routine.devops && run.workItem !== undefined ? routine.devops : undefined;
    if (run.parked?.answer) {
      const branch = runBranch(run.runId).slice('refs/heads/'.length), at = routine.steps.find(s => s.id === run.parked!.stepId)?.title ?? run.parked.stepId;
      parts.push('', '## Resumed run', `This run was parked at step ${at} and resumed after the answer below. If the checkout is on the run branch ${branch}, stay on it with its commits: never detach, reset or switch it (this overrides the step's own checkout instructions). If it is not on it (no commit yet), follow the step as written. The earlier work of this run is in its steps/ folders.`);
    }
    if (writable?.ops.includes('git-push')) parts.push('', '## Run branch', `Commit the fix on the local branch ${runBranch(run.runId).slice('refs/heads/'.length)} of the checkout; the runtime publishes exactly that branch with a push-branch write.`);
    const resources = writable ? runResources(store.ledger(run.runId), writable.organization) : [];
    if (resources.length) parts.push('', '## DevOps resources of this run', 'Refer to them by their ref in later writes.', ...resources);
    parts.push('', stepResultInstructions(dir, writable ? grantedWriteOps(writable.ops) : false, def.loop ? { to: def.loop.to, max: def.loop.max ?? DEFAULT_LOOP_MAX } : undefined,
      parking(run) ? { steps: routine.steps.slice(0, routine.steps.findIndex(s => s.id === def.id) + 1).map(s => s.id) } : undefined));
    return `${parts.join('\n')}\n`;
  }

  async function escalationIo(runId: string, attempt: number, run: RunRecord): Promise<EscalationIo | null> {
    const contact = routine.escalation;
    if (!contact || run.workItem === undefined || !organization) return null;
    const item = await devops().item(organization, run.workItem);
    return {
      runId, client: devops(), organization, project: item.project, workItem: run.workItem, contact, masker,
      save: escalation => { store.update(runId, attempt, r => { r.escalation = escalation; }); },
      now: () => clock.now(),
    };
  }

  /** Opens an escalation; false when the package has no contact, the run no work item, or the count is used up. */
  async function escalate(runId: string, attempt: number, def: RoutineStep, question: string): Promise<boolean> {
    const run = store.read(runId);
    const count = (run.escalation?.count ?? 0) + 1;
    if (!routine.escalation || run.workItem === undefined || count > MAX_ESCALATIONS) return false;
    store.update(runId, attempt, r => {
      r.status = 'waiting-human';
      r.escalation = { stepId: def.id, contact: routine.escalation!.contact.toLowerCase(), state: 'writing', at: clock.now(), question, ignored: [], count };
    });
    writeReport(store, store.read(runId));
    return true;
  }

  /** Writes the pending comment, then polls until the contact answers; undefined when the run was stopped. */
  async function waitForHuman(runId: string, attempt: number, signal: AbortSignal): Promise<RunEscalation['answer'] | undefined> {
    const pollMs = options.escalation?.pollMs ?? (((routine.escalation?.pollMinutes ?? 0) * 60_000) || ESCALATION_POLL_MS);
    const reminderMs = options.escalation?.reminderMs ?? (routine.escalation?.reminderMinutes ?? ESCALATION_REMINDER_MIN) * 60_000;
    let run = store.read(runId);
    const io = await escalationIo(runId, attempt, run);
    if (!io || !run.escalation) return undefined;
    let escalation = run.escalation;
    if (escalation.state === 'writing') {
      escalation = await writeEscalation(io, escalation, run);
      writeReport(store, store.read(runId));
    }
    const n = run.steps.find(s => s.id === escalation.stepId)?.n ?? 0;
    const url = run.workItem !== undefined ? itemUrl(io.project, run.workItem) : undefined;
    if (escalation.state === 'waiting') emit(runId, { type: 'waiting-human', at: clock.now(), n, question: escalation.question, ...(url ? { url: escalation.commentId ? `${url}#${escalation.commentId}` : url } : {}) });
    // a resumed run polls at once: the answer may already be there (it came while no runtime was polling)
    let first = escalation.at < clock.now() - 1_000;
    while (escalation.state === 'waiting') {
      if (signal.aborted) return undefined;
      if (!first) await sleep(pollMs, signal);
      first = false;
      if (signal.aborted) return undefined;
      try { options.locks?.refresh(lockNames(run), runId); } catch { /* best effort */ }
      try { escalation = await pollEscalation(io, escalation, reminderMs); }
      catch (e) { if (e instanceof StaleAttempt) throw e; warn('escalation poll failed', { runId }, e instanceof Error ? e.message : String(e)); }
    }
    run = store.update(runId, attempt, r => {
      r.status = 'running';
      const s = r.steps.find(x => x.id === escalation.stepId); if (s) s.status = 'pending';
    });
    if (run.escalation?.answer) emit(runId, { type: 'human-answer', at: clock.now(), n, author: run.escalation.answer.author });
    return run.escalation?.answer;
  }

  /** Resumes a parked run when its contact answered on the work item after the park comment: the steps from the park's
   *  resume step through the parked one run again (next round, the answer as guidance) on the same run branch, and the
   *  park tag goes. null = not parked, already resumed or running, or no answer yet. */
  async function resumeParked(runId: string): Promise<RunHandle | null> {
    if (running.has(runId)) return null;
    const run = store.read(runId), p = run.parked, policy = routine.devops?.downgrade;
    if (run.status !== 'needs-human' || !p || p.answer || run.workItem === undefined || !routine.escalation || !organization || !policy) return null;
    const item = await devops().item(organization, run.workItem);
    const contact = routine.escalation.contact.toLowerCase();
    const answers = (await devops().comments(organization, item.project, run.workItem))
      .filter(c => (p.commentId !== undefined ? c.id > p.commentId : c.createdAt > p.at) && c.authorId.toLowerCase() === contact && !c.text.includes('routine run ') && replyText(c.text).trim())
      .sort((a, b) => a.id - b.id);
    const last = answers.at(-1);
    if (!last) return null;
    // another live run holds the item or the workspace: the answer waits for the next pass
    try { lockRun(runId, run); } catch (e) { if (e instanceof ResourceBusy) { info('parked run waits: resource busy', { runId, why: e.message }); return null; } throw e; }
    const answer ={ commentId: last.id, at: clock.now(), text: masker.mask(answers.map(c => replyText(c.text)).join('\n\n')), author: last.authorName ?? last.authorId };
    const range = new Set(parkedRange(p));
    let claimed: RunRecord;
    try {
      claimed = store.claim(runId, r => {
        r.status = 'running'; delete r.error; delete r.endedAt;
        r.parks = p.n; r.parked = { ...p, answer };
        for (const s of r.steps) if (range.has(s.id)) { s.status = 'pending'; s.round = (s.round ?? 1) + 1; delete s.error; delete s.endedAt; }
      });
    } catch (e) { unlockRun(runId, run); throw e; }
    emit(runId, { type: 'run-resume', at: clock.now(), attempt: claimed.attempt });
    emit(runId, { type: 'human-answer', at: clock.now(), n: run.steps.find(s => s.id === p.stepId)?.n ?? 0, author: answer.author });
    info('parked run resumed', { runId, from: p.resumeFrom, attempt: claimed.attempt });
    const def = routine.steps.find(s => s.id === p.stepId)!;
    const untag: StepWrite = { op: 'tags', remove: [policy.addTag] };
    const finished = (async () => {
      // the park tag goes first (its own write key per park): the item is the routine's again
      try { await executeWrites(writeContext(runId, claimed.attempt, def, store.read(runId), 1, new AbortController().signal, undefined, `park-${p.n}`), [untag]); }
      catch (e) {
        if (e instanceof StaleAttempt) return store.read(runId);
        warn('park tag not removed', { runId }, e instanceof Error ? e.message : String(e));
      }
      return execute(runId, claimed.attempt);
    })();
    return { runId, finished };
  }

  /** Whether the trigger may start a new run for an item: an item already carrying the park tag (parked by an older
   *  run or by hand) starts only when the contact wrote its latest comment and that comment is not the routine's. */
  async function admitItem(workItem: number): Promise<boolean> {
    const tag = routine.escalation?.park ? routine.devops?.downgrade?.addTag : undefined;
    if (!tag || !organization || !routine.escalation) return true;
    const item = await devops().item(organization, workItem);
    const tags = String(item.fields['System.Tags'] ?? '').split(';').map(t => t.trim().toLowerCase());
    if (!tags.includes(tag.toLowerCase())) return true;
    const last = (await devops().comments(organization, item.project, workItem)).sort((a, b) => a.id - b.id).at(-1);
    return Boolean(last && last.authorId.toLowerCase() === routine.escalation.contact.toLowerCase() && !last.text.includes('routine run '));
  }

  /** A host-side site login with the run's credentials and the package's success rule (the app's Electron tab or a
   *  Playwright page). `loginUrl` is the page that asked for a login (a redirect such as /Account/Login?ReturnUrl=…);
   *  the page always goes to the credential's stored loginUrl first, query included (Air's ?mode=local), also on a
   *  re-login after the session expired. No success rule: the URL left the stored login path. Returns false when no
   *  credential matches. */
  async function login(page: LoginPageDriver, loginUrl: string): Promise<boolean> {
    const credential = await credentials.forLogin(loginUrl);
    if (!credential) return false;
    const target = new URL(originOnly(credential.loginUrl) && sameOrigin(credential.loginUrl, loginUrl) ? loginUrl : credential.loginUrl);
    const rule = routine.loginSuccess?.find(l => sameLogin(l.loginUrl, credential.loginUrl))?.success ?? { urlNotContaining: target.pathname };
    try { await page.navigate(target.href); } catch (e) { warn('login: navigation to the stored login page failed', { origin: target.origin }, e instanceof Error ? e.message : String(e)); return false; }
    return driveLogin(page, target.origin, { user: credential.user, password: credential.password }, rule);
  }

  return { pkg, store, masker, start, startItem, resume, resumeParked, admitItem, cancel, login, isRunning: (runId: string) => running.has(runId) };
}
export type RoutineRuntime = ReturnType<typeof createRoutineRuntime>;
