// The `routine` command (ADR 0175): the thin terminal host of the shared routine runtime. `run` starts one run of a
// package (folder, routine.json or the app's .zip export), `resume` continues a run folder from the step that did not
// finish, `watch` polls the package's DevOps trigger and starts one run per new work item (a restart never starts an
// item twice: the dedup lives in the runs root's trigger.json). Every start goes through preflight first. Progress is
// rendered from events.jsonl by terminal.ts. No app, no brain, no roles: `claude` on PATH, the package's own secrets.
// `main(argv, deps)` is the whole program; deps are injectable for the unit tests (engine, DevOps, signals, output).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EngineRunner, Paths, RuntimeLog, TokenProvider } from './ports';
import { ROUTINE_FILE, type RoutinePackage } from './format';
import { formatPreflight, preflightRoutinePackage } from './preflight';
import type { RecognisedTestDb } from './testdb-guard';
import { createClaudeEngine } from './claude';
import { createRoutineRuntime, type RoutineRuntime } from './runtime';
import { createTriggerLoop, type Detect } from './trigger';
import { azureCliTokenProvider, patTokenProvider } from './token';
import { defaultLocksDir, defaultPackagesDir, defaultRunsDir, routinePaths } from './paths';
import { createLocks, type Locks } from './locks';
import { cliCommand } from './cli-command';
import { extractPackageZip } from './zip';
import { followRun, renderProgress, readProgress } from './terminal';
import type { RunRecord } from './run-store';

/** Written into a run folder by `routine run|watch`: where its package came from, for `routine resume`. */
export const PACKAGE_SOURCE_FILE = 'package-source.json';

type Out = { write(s: string): unknown; isTTY?: boolean };
type Server = { command: string; args: string[]; env?: Record<string, string> };
type Request = (url: string, init: RequestInit) => Promise<Response>;

export interface CliDeps {
  stdout: Out;
  stderr: Out;
  env: NodeJS.ProcessEnv;
  /** the engine for `--engine claude` (default: `claude` on PATH) */
  engine(): EngineRunner;
  /** how to start the runtime's MCP servers (default: node + routine-mcp.mjs beside this file); undefined = not served */
  mcp(kind: 'testdb' | 'devops' | 'browser'): Server | undefined;
  /** Ctrl+C: registers the handler, returns the unregister function (default: process SIGINT/SIGTERM) */
  onInterrupt(handler: () => void): () => void;
  /** DevOps overrides (tests: a fake DevOps) */
  devops?: { authorization?: TokenProvider; request?: Request; detect?: Detect };
  /** watch: waits between polls (default: a timer cut short by Ctrl+C) */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  /** watch: stop after this many polls (tests) */
  maxPolls?: number;
  /** repaint interval of the progress (ms) */
  repaintMs: number;
  /** the lock folder every terminal shares (locks.ts; default: defaultLocksDir); false = no locks */
  locksDir?: string | false;
  /** the runtime's own packages folder: only a package folder right inside it gets its test-dbs.json read without
   *  --test-dbs (default: defaultPackagesDir) */
  packagesDir?: string;
}

const USAGE = `Usage:
  routine run <package-folder|routine.json|package.zip> [--input name=value]... [--from-step <step id>]
  routine resume <run-folder> [--package <package-folder|routine.json|package.zip>]
  routine watch <package-folder|routine.json|package.zip>
Options (all commands):
  --engine claude        the agent engine (only claude today)
  --runs-dir <folder>    where runs are kept (default: ${'$'}ROUTINE_RUNS_DIR or the per-user default)
  --headed               show the routine browser window (default: headless)
  --test-dbs <file.json> the test databases this machine recognises: [{"server","port","database"}]
                         (default: test-dbs.json in the package folder, only for a package folder in the
                         runtime's own packages folder, never beside a .zip; resume: the run's package)`;

class UsageError extends Error {}

type RuntimeFor = (pkg: RoutinePackage, paths: Paths, recognised: RecognisedTestDb[] | undefined) => RoutineRuntime;

interface Parsed {
  command: string; target?: string; inputs: Record<string, string>; fromStep?: string; engine: string;
  runsDir?: string; headed: boolean; testDbs?: string; pkg?: string; help: boolean;
}

export function parseArgs(argv: readonly string[]): Parsed {
  const out: Parsed = { command: argv[0] ?? '', inputs: {}, engine: 'claude', headed: false, help: false };
  const value = (i: number, flag: string): string => {
    const v = argv[i];
    if (v === undefined || v.startsWith('--')) throw new UsageError(`${flag} needs a value`);
    return v;
  };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--headed') out.headed = true;
    else if (a === '--input') {
      const v = value(++i, a), eq = v.indexOf('=');
      if (eq <= 0) throw new UsageError(`--input expects name=value, got "${v}"`);
      out.inputs[v.slice(0, eq)] = v.slice(eq + 1);
    }
    else if (a === '--from-step') out.fromStep = value(++i, a);
    else if (a === '--engine') out.engine = value(++i, a);
    else if (a === '--runs-dir') out.runsDir = value(++i, a);
    else if (a === '--test-dbs') out.testDbs = value(++i, a);
    else if (a === '--package') out.pkg = value(++i, a);
    else if (a.startsWith('--')) throw new UsageError(`unknown option ${a}`);
    else if (out.target === undefined) out.target = a;
    else throw new UsageError(`unexpected argument "${a}"`);
  }
  if (out.command === '--help' || out.command === '-h' || out.command === 'help') out.help = true;
  return out;
}

/** The file a package folder may keep next to routine.json: the test databases this machine recognises for it. */
export const PACKAGE_TEST_DBS_FILE = 'test-dbs.json';

/** The recognised test databases in a file: a JSON list of {server, port, database}. `source` names where the file
 *  came from in errors (`--test-dbs`, or the package's test-dbs.json). The file may hold connection secrets: an error
 *  names the file, never its text (a JSON parse message quotes it). */
export function readTestDbs(file: string, source = '--test-dbs'): RecognisedTestDb[] {
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { throw new UsageError(`${source}: cannot read ${file} as JSON (${e instanceof SyntaxError ? 'not valid JSON' : e instanceof Error && 'code' in e ? String(e.code) : 'unreadable'})`); }
  if (!Array.isArray(raw)) throw new UsageError(`${source}: ${file} is not a JSON list of {"server","port","database"}`);
  return raw.map((x, i) => {
    const o = x !== null && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : undefined;
    const port = o?.port === undefined ? 1433 : o.port;
    if (!o || typeof o.server !== 'string' || !o.server.trim() || typeof o.database !== 'string' || !o.database.trim() || typeof port !== 'number' || !Number.isInteger(port) || port <= 0 || port > 65535)
      throw new UsageError(`${source}: item ${i} of ${file} needs "server", "database" and an optional numeric "port"`);
    return { server: o.server.trim(), port, database: o.database.trim() };
  });
}

const realDir = (p: string): string | undefined => {
  try { const real = fs.realpathSync.native(p); return fs.statSync(real).isDirectory() ? real : undefined; } catch { return undefined; }
};

/** The package's own test-dbs.json, read without `--test-dbs` only when it is trusted: the package is a folder (or its
 *  routine.json) right inside the runtime's packages folder, where the app installs packages, real paths compared (no
 *  `..` or link escape), and the file itself lives there. A .zip, a missing path or any other folder: none. */
export function packageTestDbsFile(location: string, packagesDir: string): string | undefined {
  const abs = path.resolve(location);
  let dir: string | undefined;
  try {
    const real = fs.realpathSync.native(abs), stat = fs.statSync(real);
    if (stat.isDirectory()) dir = real;
    else if (stat.isFile() && path.basename(real).toLowerCase() === ROUTINE_FILE.toLowerCase()) dir = path.dirname(real);
  } catch { return undefined; }
  const root = realDir(path.resolve(packagesDir));
  if (!dir || !root) return undefined;
  const rel = path.relative(root, dir);
  if (!rel || path.isAbsolute(rel) || rel.split(/[\\/]/).length !== 1 || rel === '..' || rel.startsWith('..')) return undefined;
  const file = path.join(dir, PACKAGE_TEST_DBS_FILE);
  try {
    const real = fs.realpathSync.native(file);
    return fs.statSync(real).isFile() && path.relative(dir, path.dirname(real)) === '' ? real : undefined;
  } catch { return undefined; }
}

/** The test databases for a package: `--test-dbs` when given, else the trusted package test-dbs.json
 *  (packageTestDbsFile; its path, never its text, goes to `out`), else none (preflight then accepts only test/dev/qa
 *  names). */
export function testDbsFor(flag: string | undefined, location: string, packagesDir: string, out: Out): RecognisedTestDb[] | undefined {
  if (flag) return readTestDbs(flag);
  const file = packageTestDbsFile(location, packagesDir);
  if (!file) return undefined;
  out.write(`test databases: ${file}\n`);
  return readTestDbs(file, `the package's ${PACKAGE_TEST_DBS_FILE}`);
}

/** A package location as a folder holding routine.json: a .zip is extracted into a private temp folder. */
export function packageFolder(location: string): { dir: string; dispose(): void } {
  const abs = path.resolve(location);
  if (!fs.existsSync(abs)) throw new UsageError(`package not found: ${abs}`);
  if (abs.toLowerCase().endsWith('.zip')) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'routine-pkg-'));
    try { return { dir: extractPackageZip(abs, tmp), dispose: () => fs.rmSync(tmp, { recursive: true, force: true }) }; }
    catch (e) { fs.rmSync(tmp, { recursive: true, force: true }); throw new UsageError(`${abs}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return { dir: fs.statSync(abs).isDirectory() ? abs : path.dirname(abs), dispose: () => undefined };
}

/** Reads and preflights a package; null (after printing the problems and their fixes) when it cannot run. */
function loadChecked(location: string, recognised: RecognisedTestDb[] | undefined, out: Out): { pkg: RoutinePackage; dispose(): void } | null {
  const abs = path.resolve(location);
  const folder = packageFolder(abs);
  const file = !abs.toLowerCase().endsWith('.zip') && fs.existsSync(abs) && fs.statSync(abs).isFile() ? abs : path.join(folder.dir, ROUTINE_FILE);
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { folder.dispose(); throw new UsageError(`${file}: not a readable routine.json (${e instanceof Error ? e.message : String(e)})`); }
  const result = preflightRoutinePackage(raw, recognised ? { recognisedTestDbs: recognised } : {});
  if (!result.ok || !result.pkg) {
    const text = formatPreflight(result);
    out.write(`The package cannot run yet:\n${text}\n`);
    if (!recognised && text.includes('not recognisable as a test database'))
      out.write(`Hint: pass --test-dbs <file.json> with this machine's test databases (a package's own ${PACKAGE_TEST_DBS_FILE} is read only in the runtime's packages folder).\n`);
    folder.dispose();
    return null;
  }
  if (result.warnings.length) out.write(`${formatPreflight({ ...result, errors: [] })}\n`);
  return { pkg: result.pkg, dispose: folder.dispose };
}

const defaultMcp = (kind: 'testdb' | 'devops' | 'browser'): Server | undefined => {
  let here: string;
  try { here = path.dirname(fileURLToPath(import.meta.url)); } catch { return undefined; }
  const entry = path.join(here, 'routine-mcp.mjs');
  return fs.existsSync(entry) ? { command: process.execPath, args: [entry, kind] } : undefined;
};

const defaultSleep = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
  if (signal.aborted) { resolve(); return; }
  const t = setTimeout(done, ms);
  function done() { clearTimeout(t); signal.removeEventListener('abort', done); resolve(); }
  signal.addEventListener('abort', done, { once: true });
});

const defaultInterrupt = (handler: () => void) => {
  process.on('SIGINT', handler); process.on('SIGTERM', handler);
  return () => { process.off('SIGINT', handler); process.off('SIGTERM', handler); };
};

const STATUS_CODE: Record<string, number> = { done: 0, cancelled: 130 };

/** The whole `routine` program; returns the exit code. */
export async function main(argv: readonly string[], partial: Partial<CliDeps> = {}): Promise<number> {
  const deps: CliDeps = {
    stdout: process.stdout, stderr: process.stderr, env: process.env, engine: () => createClaudeEngine(), mcp: defaultMcp,
    onInterrupt: defaultInterrupt, sleep: defaultSleep, repaintMs: 1000, ...partial,
  };
  const { stdout, stderr } = deps;
  let args: Parsed;
  try { args = parseArgs(argv); } catch (e) { stderr.write(`${(e as Error).message}\n\n${USAGE}\n`); return 2; }
  if (args.help || !args.command) { (args.help ? stdout : stderr).write(`${USAGE}\n`); return args.help ? 0 : 2; }
  if (!['run', 'resume', 'watch'].includes(args.command)) { stderr.write(`unknown command "${args.command}"\n\n${USAGE}\n`); return 2; }
  if (args.engine !== 'claude') { stderr.write(`Engine "${args.engine}" is not supported yet: only claude.\n`); return 2; }
  if (!args.target) { stderr.write(`${args.command} needs ${args.command === 'resume' ? 'the run folder' : 'the package'}\n\n${USAGE}\n`); return 2; }
  const log: RuntimeLog = {
    info: () => undefined,
    warn: (_scope, msg, extra) => { stderr.write(`warning: ${msg}${extra?.cause ? ` (${extra.cause})` : ''}\n`); },
  };
  try {
    const runsDir = path.resolve(args.runsDir ?? defaultRunsDir(deps.env));
    const packagesDir = path.resolve(deps.packagesDir ?? defaultPackagesDir(deps.env));
    const locks = deps.locksDir === false ? undefined : createLocks(deps.locksDir ?? defaultLocksDir(deps.env));
    const runtimeFor: RuntimeFor = (pkg, paths, recognised) => {
      const devopsMcp = deps.mcp('devops'), testDbServer = deps.mcp('testdb'), browserServer = deps.mcp('browser');
      return createRoutineRuntime({
        pkg, paths, engine: deps.engine(), log, ...(locks ? { locks } : {}),
        devops: { ...(deps.devops?.authorization ? { authorization: deps.devops.authorization } : {}), ...(deps.devops?.request ? { request: deps.devops.request } : {}), ...(devopsMcp ? { mcp: devopsMcp } : {}) },
        testDb: { ...(recognised ? { recognised } : {}), ...(testDbServer ? { server: testDbServer } : {}) },
        ...(browserServer ? { browser: { server: browserServer, headless: !args.headed } } : {}),
      });
    };
    if (args.command === 'run') return await run(args, runsDir, packagesDir, runtimeFor, deps);
    if (args.command === 'resume') return await resume(args, packagesDir, runtimeFor, deps);
    return await watch(args, runsDir, packagesDir, runtimeFor, deps, locks);
  } catch (e) {
    stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return e instanceof UsageError ? 2 : 1;
  }
}

/** Follows one run to its end; Ctrl+C cancels it (the run stays resumable). */
async function follow(runtime: RoutineRuntime, runDir: string, handle: { runId: string; finished: Promise<RunRecord> }, deps: CliDeps): Promise<{ record: RunRecord; interrupted: boolean }> {
  let interrupted = false;
  const off = deps.onInterrupt(() => { if (interrupted) return; interrupted = true; deps.stdout.write('\nStopping the run…\n'); runtime.cancel(handle.runId); });
  const follower = followRun(runDir, deps.stdout, deps.repaintMs);
  try { return { record: await handle.finished, interrupted }; }
  finally { follower.stop(); off(); }
}

function ending(record: RunRecord, runDir: string, deps: CliDeps, attempt?: number): number {
  // another `routine resume` of the same run took it over: this process stopped at its next write, the other goes on
  if (attempt !== undefined && record.attempt !== attempt) {
    deps.stderr.write(`Another resume of this run took it over (attempt ${record.attempt}): this one stopped. Run only one resume at a time.\n`);
    return 1;
  }
  const report = path.join(runDir, 'report.md');
  if (fs.existsSync(report)) deps.stdout.write(`Report: ${report}\n`);
  if (record.status !== 'done') deps.stdout.write(`Resume it with: ${cliCommand('resume', { runDir })}\n`);
  return STATUS_CODE[record.status] ?? 1;
}

const writeSource = (runDir: string, location: string) => {
  try { fs.writeFileSync(path.join(runDir, PACKAGE_SOURCE_FILE), `${JSON.stringify({ package: path.resolve(location) }, null, 2)}\n`); } catch { /* resume can take --package */ }
};

async function run(args: Parsed, runsDir: string, packagesDir: string, runtimeFor: RuntimeFor, deps: CliDeps): Promise<number> {
  const recognised = testDbsFor(args.testDbs, args.target!, packagesDir, deps.stdout);
  const loaded = loadChecked(args.target!, recognised, deps.stderr);
  if (!loaded) return 1;
  try {
    const runtime = runtimeFor(loaded.pkg, routinePaths(runsDir, loaded.pkg.routine.id), recognised);
    const handle = runtime.start({ inputs: args.inputs, ...(args.fromStep ? { fromStep: args.fromStep } : {}) });
    const runDir = path.join(runsDir, loaded.pkg.routine.id, handle.runId);
    writeSource(runDir, args.target!);
    deps.stdout.write(`${loaded.pkg.routine.title}: run ${handle.runId}\nFolder: ${runDir}\n`);
    const { record } = await follow(runtime, runDir, handle, deps);
    return ending(record, runDir, deps);
  } finally { loaded.dispose(); }
}

async function resume(args: Parsed, packagesDir: string, runtimeFor: RuntimeFor, deps: CliDeps): Promise<number> {
  const runDir = path.resolve(args.target!);
  const runFile = path.join(runDir, 'run.json');
  if (!fs.existsSync(runFile)) throw new UsageError(`not a run folder (no run.json): ${runDir}`);
  const previous = JSON.parse(fs.readFileSync(runFile, 'utf8')) as RunRecord;
  let location = args.pkg;
  if (!location) {
    try { location = (JSON.parse(fs.readFileSync(path.join(runDir, PACKAGE_SOURCE_FILE), 'utf8')) as { package?: string }).package; } catch { /* below */ }
    if (!location) throw new UsageError(`this run does not say where its package is: add --package <package>`);
  }
  const recognised = testDbsFor(args.testDbs, location, packagesDir, deps.stdout);
  const loaded = loadChecked(location, recognised, deps.stderr);
  if (!loaded) return 1;
  try {
    if (loaded.pkg.routine.id !== previous.routineId) throw new UsageError(`the package is routine "${loaded.pkg.routine.id}", the run is of "${previous.routineId}"`);
    const runsRoot = path.dirname(runDir), runId = path.basename(runDir);
    const runtime = runtimeFor(loaded.pkg, { runsRoot, workspace: id => path.join(runsRoot, id, 'workspace') }, recognised);
    const handle = runtime.resume(runId);
    const attempt = runtime.store.read(runId).attempt;
    if (args.pkg) writeSource(runDir, args.pkg);
    deps.stdout.write(`${loaded.pkg.routine.title}: run ${runId} resumed\nFolder: ${runDir}\n`);
    const { record } = await follow(runtime, runDir, handle, deps);
    return ending(record, runDir, deps, attempt);
  } finally { loaded.dispose(); }
}

async function watch(args: Parsed, runsDir: string, packagesDir: string, runtimeFor: RuntimeFor, deps: CliDeps, locks?: Locks): Promise<number> {
  const recognised = testDbsFor(args.testDbs, args.target!, packagesDir, deps.stdout);
  const loaded = loadChecked(args.target!, recognised, deps.stderr);
  if (!loaded) return 1;
  const { stdout } = deps;
  // one watch per routine on this machine: two would start the same new items and overwrite each other's trigger.json
  const watchLock = `watch-${loaded.pkg.routine.id}`, watcher = `watch-${process.pid}-${Date.now()}`;
  try {
    const pkg = loaded.pkg, trigger = pkg.routine.trigger;
    if (!trigger) throw new UsageError(`routine "${pkg.routine.id}" has no DevOps trigger (routine.trigger): use routine run`);
    if (locks && !locks.acquire(watchLock, watcher)) {
      const holder = locks.holder(watchLock);
      deps.stderr.write(`Another routine watch of "${pkg.routine.id}" is running (pid ${holder?.pid ?? '?'} on ${holder?.host ?? '?'}): stop it first, or close that terminal.\n`);
      return 1;
    }
    const runtime = runtimeFor(pkg, routinePaths(runsDir, pkg.routine.id), recognised);
    const active = new Map<string, Promise<RunRecord>>();
    const stop = new AbortController();
    const authorization: TokenProvider = deps.devops?.authorization ?? (pkg.secrets?.devopsPat ? patTokenProvider(pkg.secrets.devopsPat) : azureCliTokenProvider());
    const loop = createTriggerLoop({
      routineId: pkg.routine.id, trigger, store: runtime.store, authorization, log: { info: () => undefined, warn: (_s, msg, extra) => { deps.stderr.write(`warning: ${msg}${extra?.cause ? ` (${extra.cause})` : ''}\n`); } },
      ...(deps.devops?.detect ? { detect: deps.devops.detect } : {}),
      start: (workItem, inputs) => {
        const handle = runtime.startItem(workItem, inputs);
        const runDir = path.join(runsDir, pkg.routine.id, handle.runId);
        writeSource(runDir, args.target!);
        stdout.write(`Work item ${workItem}: run ${handle.runId} started (${runDir})\n`);
        follow(handle);
        return handle;
      },
      // a parked run whose contact answered on the work item goes on (escalation.park); a run stopped by Ctrl+C, a crash
      // or a park that could not be written goes on from its step (runtime.recover); done and failed runs stay
      resume: async runId => {
        if (active.has(runId)) return null;
        const answered = await runtime.resumeParked(runId);
        const handle = answered ?? runtime.recover(runId);
        if (!handle) return null;
        stdout.write(`Work item ${runtime.store.read(runId).workItem ?? '?'}: run ${runId} ${answered ? 'resumed after an answer' : 'resumed where it stopped'} (${path.join(runsDir, pkg.routine.id, runId)})\n`);
        follow(handle);
        return handle;
      },
      admit: workItem => runtime.admitItem(workItem),
      active: () => active.size,
    });
    function follow(handle: { runId: string; finished: Promise<RunRecord> }): void {
      const runDir = path.join(runsDir, pkg.routine.id, handle.runId);
      active.set(handle.runId, handle.finished.then(record => {
        active.delete(handle.runId);
        stdout.write(`Work item ${record.workItem ?? '?'}: run ${handle.runId} ${renderProgress(readProgress(runDir), Date.now())[0] ?? record.status}\n`);
        if (fs.existsSync(path.join(runDir, 'report.md'))) stdout.write(`  report: ${path.join(runDir, 'report.md')}\n`);
        return record;
      }));
    }
    const off = deps.onInterrupt(() => { if (stop.signal.aborted) return; stdout.write('\nStopping the watch…\n'); stop.abort(); loop.stop(); });
    stdout.write(`Watching DevOps for "${pkg.routine.title}" every ${trigger.everyMinutes} min (Ctrl+C to stop). Runs: ${path.join(runsDir, pkg.routine.id)}\n`);
    try {
      for (let polls = 0; !stop.signal.aborted; ) {
        locks?.refresh([watchLock], watcher);
        const result = await loop.tick();
        stdout.write(`${new Date().toLocaleTimeString()} ${result.summary}\n`);
        if (deps.maxPolls !== undefined && ++polls >= deps.maxPolls) break;
        await deps.sleep(trigger.everyMinutes * 60_000, stop.signal);
      }
    } finally {
      loop.stop();
      if (stop.signal.aborted) for (const runId of active.keys()) runtime.cancel(runId);
      await Promise.allSettled([...active.values()]);
      off();
    }
    if (stop.signal.aborted) stdout.write('Stopped. Interrupted runs stay resumable: the next watch goes on with them (or routine resume <run folder>).\n');
    return 0;
  } finally { locks?.release([watchLock], watcher); loaded.dispose(); }
}
