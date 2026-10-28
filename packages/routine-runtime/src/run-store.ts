// The run folder of the shared routine runtime (ADR 0175): one folder per run, identical for the app and the terminal.
//   <runsRoot>/<runId>/run.json                                   the run's state (attempt fence, steps, escalation)
//   <runsRoot>/<runId>/steps/<n>-<stepId>/prompt.md              the prompt the session got
//   <runsRoot>/<runId>/steps/<n>-<stepId>/transcript.jsonl       the session's stream-json lines
//   <runsRoot>/<runId>/steps/<n>-<stepId>/step-result.json       the session's result, re-written masked
//   <runsRoot>/<runId>/steps/<n>-<stepId>/evidence/, screenshots/
//   <runsRoot>/<runId>/ledger.json                               DevOps writes already done (idempotency)
//   <runsRoot>/<runId>/events.jsonl                              live progress (events.ts, progressFrom)
//   <runsRoot>/<runId>/report.md                                 the human summary
//   <runsRoot>/trigger.json                                      the trigger loop's cursor and dedup subjects
// Every text goes through the run's Masker. `readRun` / `listRuns` are the documented reader for the UI and the CLI.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { renameRetrying } from './fs-util';
import type { Masker } from './mask';
import type { StepResult } from './step-result';
import { EVENTS_FILE, parseEvents, type RunEvent } from './events';

export type RunStatus = 'running' | 'waiting-human' | 'done' | 'failed' | 'needs-human' | 'cancelled';
export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'needs-human';
export interface RunStepRecord {
  n: number; id: string; title: string; status: StepStatus;
  /** session attempts of this step so far */
  attempts: number;
  startedAt?: number; endedAt?: number; summary?: string; error?: string; sessionId?: string;
  /** the model the step's session reported (signs its DevOps comments when the step declares none) */
  model?: string;
  /** test DB reachability, probed once per step */
  testDb?: 'available' | 'unavailable' | 'refused';
  testDbNote?: string;
  /** DevOps writes this step's result asked for and the runtime did */
  writes?: string[];
  /** writes whose effect could not be confirmed on DevOps (the run went on) */
  notVerified?: string[];
  /** writes DevOps refused (the run went on) */
  failedWrites?: string[];
  /** review→fix round of this step (absent = 1): each round has its own folder (stepFolderName) */
  round?: number;
  /** on a step with `loop`: how many times it sent the run back */
  loops?: number;
  /** on a loop's target step: why the run was sent back to it (the findings to fix), shown in its next prompt */
  sentBack?: { by: string; reason: string };
}
export interface RunEscalation {
  stepId: string; contact: string; state: 'writing' | 'waiting' | 'answered'; at: number; question: string;
  commentId?: number; reminder?: { state: 'writing' | 'sent'; commentId?: number }; answer?: { commentId: number; at: number; text: string; author: string };
  ignored: number[]; count: number; lastPollAt?: number;
}
export interface RunRecord {
  schema: 1; runId: string; routineId: string; routineTitle: string; status: RunStatus;
  /** the fence: each start or resume takes the next number; only the holder of the current one may write */
  attempt: number;
  inputs: Record<string, string>; workItem?: number; subjectKey?: string;
  createdAt: number; updatedAt: number; endedAt?: number; error?: string;
  steps: RunStepRecord[];
  escalation?: RunEscalation;
  /** a parked run (escalation.park): stopped at stepId, resumes from resumeFrom on a comment starting with @AI on the work item */
  parked?: RunPark;
  /** parks already answered: the next park takes the next number (its own ledger keys) */
  parks?: number;
  /** a park that could not be written, retried by the watch (runtime.recover): bounded, each retry runs the step again */
  parkRetries?: number;
  /** test deployments of this run another release replaced (target:release), each stopped the run once for a person */
  lostNodes?: string[];
  /** the @AI comment that admitted an item already carrying the park tag: guidance for every step */
  admitted?: AiAnswer;
}
/** A comment starting with @AI: its instruction (prefix removed, masked) and its author. `authorId` is set from the
 *  version that acknowledges it ("Presa in carico"); an answer recorded without it gets no late reply. */
export interface AiAnswer { commentId: number; at: number; text: string; author: string; authorId?: string }
export interface RunPark {
  n: number; stepId: string; resumeFrom: string; at: number; question: string;
  /** the park comment: an answer is a later comment of the contact */
  commentId?: number; branch: string; pushed: boolean;
  /** the @AI answer (its instruction), kept while the resumed steps run */
  answer?: AiAnswer;
  /** resumed by hand before an answer: spent, a later comment of the contact no longer resumes it */
  spent?: boolean;
}
/** A DevOps write of a run. "writing" = sent, outcome not known yet (verified on DevOps before anything else);
 *  "not-verified" = its effect could not be confirmed; "failed" = DevOps refused it. None of them blocks the run.
 *  `resource`: what a write created or found (a test plan, suite or case id, the run's PR, the pushed branch, the
 *  deployment receipt), read back by later writes and listed in the next prompts. */
export interface LedgerEntry { state: 'writing' | 'done' | 'not-verified' | 'failed'; what: string; at: number; tries: number; commentId?: number; rev?: number; resource?: Record<string, string | number | boolean> }
export interface TriggerSubject { runId: string; at: number; title?: string }
export interface TriggerState { schema: 1; cursor: Record<string, string>;
  /** cursors of the trigger's further areas (key project|areaPath) */
  cursors?: Record<string, Record<string, string>>; subjects: Record<string, TriggerSubject>; starts: number[]; lastCheckAt?: number; lastResult?: string }

/** A runtime whose attempt is no longer the run's current one (a newer resume took over). */
export class StaleAttempt extends Error {}

const safeId = (s: string): string => /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(s) && !s.includes('..') ? s : (() => { throw new Error('Invalid run or step id'); })();

function writeAtomic(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temp, text, { flag: 'wx', mode: 0o600 }); renameRetrying(temp, file); }
  finally { try { fs.rmSync(temp, { force: true }); } catch { /* renamed */ } }
}
const readJson = <T>(file: string): T | undefined => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; } };

/** `NN-<step id>`; a later review→fix round of the step gets its own `NN-<step id>.rN`. */
export function stepFolderName(n: number, stepId: string, round = 1): string { return `${String(n).padStart(2, '0')}-${safeId(stepId)}${round > 1 ? `.r${round}` : ''}`; }

export function createRunStore(runsRoot: string, masker: Masker) {
  const runDir = (runId: string) => path.join(runsRoot, safeId(runId));
  const runFile = (runId: string) => path.join(runDir(runId), 'run.json');
  const write = (file: string, text: string) => writeAtomic(file, masker.mask(text));
  const store = {
    root: runsRoot,
    masker,
    runDir,
    read(runId: string): RunRecord {
      const run = readJson<RunRecord>(runFile(runId));
      if (!run || run.schema !== 1) throw new Error(`Run ${runId} not found`);
      return run;
    },
    create(run: RunRecord): void {
      if (fs.existsSync(runFile(run.runId))) throw new Error(`Run ${run.runId} exists`);
      write(runFile(run.runId), masker.json(run));
    },
    /** Takes the next attempt number (start or resume); a runtime holding an older one stops at its next write. */
    claim(runId: string, mutate?: (run: RunRecord) => void): RunRecord {
      const run = store.read(runId);
      run.attempt += 1; run.updatedAt = Date.now(); mutate?.(run);
      write(runFile(runId), masker.json(run));
      return run;
    },
    /** Changes run.json only while `attempt` is still the run's current one. */
    update(runId: string, attempt: number, mutate: (run: RunRecord) => void): RunRecord {
      const run = store.read(runId);
      if (run.attempt !== attempt) throw new StaleAttempt(`Run ${runId}: attempt ${attempt} was superseded by ${run.attempt}`);
      mutate(run); run.updatedAt = Date.now();
      write(runFile(runId), masker.json(run));
      return run;
    },
    stepDir(runId: string, n: number, stepId: string, round = 1): string {
      const dir = path.join(runDir(runId), 'steps', stepFolderName(n, stepId, round));
      for (const sub of ['evidence', 'screenshots']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
      return dir;
    },
    writeText(file: string, text: string): void { write(file, text); },
    appendText(file: string, text: string): void { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.appendFileSync(file, masker.mask(text), { mode: 0o600 }); },
    /** Appends one live-progress event to <run>/events.jsonl (masked like every run file). */
    appendEvent(runId: string, event: RunEvent): void { store.appendText(path.join(runDir(runId), EVENTS_FILE), `${masker.json(event, 0)}\n`); },
    events(runId: string): RunEvent[] { try { return parseEvents(fs.readFileSync(path.join(runDir(runId), EVENTS_FILE), 'utf8')); } catch { return []; } },
    /** Re-masks the text files a session wrote into its step folder (evidence, result): binary files stay. */
    maskFolder(dir: string): void {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) { store.maskFolder(file); continue; }
        if (!entry.isFile() || /\.(png|jpe?g|gif|webp|zip|pdf)$/i.test(entry.name)) continue;
        const stat = fs.statSync(file); if (stat.size > 20 * 1024 * 1024) continue;
        const buffer = fs.readFileSync(file);
        if (buffer.includes(0)) continue;
        const text = buffer.toString('utf8'), masked = masker.mask(text);
        if (masked !== text) writeAtomic(file, masked);
      }
    },
    ledger(runId: string): Record<string, LedgerEntry> { return readJson<Record<string, LedgerEntry>>(path.join(runDir(runId), 'ledger.json')) ?? {}; },
    setLedger(runId: string, attempt: number, key: string, entry: LedgerEntry): void {
      if (store.read(runId).attempt !== attempt) throw new StaleAttempt(`Run ${runId}: attempt ${attempt} was superseded`);
      const ledger = store.ledger(runId); ledger[key] = entry;
      write(path.join(runDir(runId), 'ledger.json'), masker.json(ledger));
    },
    trigger(): TriggerState { return readJson<TriggerState>(path.join(runsRoot, 'trigger.json')) ?? { schema: 1, cursor: {}, subjects: {}, starts: [] }; },
    setTrigger(state: TriggerState): void { write(path.join(runsRoot, 'trigger.json'), masker.json(state)); },
    runIds(): string[] {
      if (!fs.existsSync(runsRoot)) return [];
      return fs.readdirSync(runsRoot, { withFileTypes: true }).filter(e => e.isDirectory() && fs.existsSync(path.join(runsRoot, e.name, 'run.json'))).map(e => e.name);
    },
  };
  return store;
}
export type RunStore = ReturnType<typeof createRunStore>;

// ── Reader (UI, CLI, later tasks) ───────────────────────────────────────────────────────────────────────────────

export interface RunStepFolder {
  record: RunStepRecord; dir: string;
  prompt?: string; result?: StepResult | unknown; transcript: string;
  evidence: string[]; screenshots: string[];
}
export interface RunFolder { dir: string; run: RunRecord; steps: RunStepFolder[]; report?: string }

const files = (dir: string): string[] => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile()).map(e => path.join(dir, e.name)).sort() : [];

/** Reads one run folder as written by the runtime (app or terminal). */
export function readRun(dir: string): RunFolder {
  const run = readJson<RunRecord>(path.join(dir, 'run.json'));
  if (!run || run.schema !== 1) throw new Error(`${dir} is not a routine run folder`);
  const steps = run.steps.map(record => {
    const stepDir = path.join(dir, 'steps', stepFolderName(record.n, record.id, record.round));
    const text = (name: string) => { try { return fs.readFileSync(path.join(stepDir, name), 'utf8'); } catch { return undefined; } };
    let result: unknown;
    try { const raw = text('step-result.json'); result = raw ? JSON.parse(raw) as unknown : undefined; } catch { result = undefined; }
    return { record, dir: stepDir, prompt: text('prompt.md'), result, transcript: path.join(stepDir, 'transcript.jsonl'),
      evidence: files(path.join(stepDir, 'evidence')), screenshots: files(path.join(stepDir, 'screenshots')) };
  });
  let report: string | undefined;
  try { report = fs.readFileSync(path.join(dir, 'report.md'), 'utf8'); } catch { report = undefined; }
  return { dir, run, steps, ...(report !== undefined ? { report } : {}) };
}

/** Every run under a runs root, newest first. */
export function listRuns(runsRoot: string): RunRecord[] {
  if (!fs.existsSync(runsRoot)) return [];
  const runs: RunRecord[] = [];
  for (const e of fs.readdirSync(runsRoot, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const run = readJson<RunRecord>(path.join(runsRoot, e.name, 'run.json'));
    if (run?.schema === 1) runs.push(run);
  }
  return runs.sort((a, b) => b.createdAt - a.createdAt);
}
