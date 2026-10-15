// The app's half of the comparison queue (ADR 0046 §4): the brain lists the runs it wants on side b, the app runs each
// one as a hidden read-only session (headless.ts) and hands the answer back. Why: the owner, 14/10, wants both sides
// to run inside the app with its own logins and keys; the brain's scripts never get a key, they only get the answer.
// The interface is the brain's harness/compare/app-queue.mjs, run with the app's own Node (Electron as Node) in the
// brain folder:
//   list                          → stdout { runs: [{ round, side: "b", experiment, engine, model, effort, cwd, prompt, denyRead? }] }
//   start  --round R --side b     → stdout { ok: true } | { ok: false, why }   (the brain marks the run as taken)
//   record --round R --side b     ← stdin { engine, model, effort, text, costUsd, tokens, durationMs, turns }
//                                    (tokens: the run's total in the Claude API usage shape, as side a's, or null)
//   fail   --round R --side b     ← stdin { error, durationMs }   (a real run error or the timeout only)
// Every 60 s, only while some experiment is on and the brain has app-queue.mjs: list, then for each run (at most 2 at
// once) start → run → record, or fail with a short reason (never a key: headless.ts shortError). A run this app may not
// do now (headless.ts refuses: engine off or not for agents, Fable, effort max) is skipped before start and stays
// queued. No retry: a run this app took once is never taken again. Stopped on quit (running sessions killed, nothing
// written back: the brain's claim goes stale). Only the stable app runs it (queueAllowed). Used by wiring.ts (demo:
// none).
import fs from 'node:fs';
import path from 'node:path';
import { ENGINE_ID } from '../engines/registry';
import { errText, log } from '../log';
import { errLine } from '../brain/compare';
import { runNode, type NodeRunner } from '../brain/node';
import type { TokenUsage } from '../chats/session';
import { shortError, type HeadlessRequest, type HeadlessResult } from './headless';

/** One run the brain wants on side b. */
export interface QueueRun {
  round: string;
  side: 'b';
  experiment: string;
  engine: string;
  model: string | null;
  effort: string | null;
  cwd: string;
  prompt: string;
  /** absolute folders the run may never read (side a's output, the brain's reviews/compare); absent in the list = none
   *  beyond the app's own (headless.ts HeadlessDeps.denyRead) */
  denyRead: string[];
}

export interface CompareQueueDeps {
  brainRoot: () => string | null;
  node: NodeRunner;
  /** is any experiment on now (brain/compare.ts list) */
  anyOn: () => Promise<boolean>;
  runner: {
    run(req: HeadlessRequest): Promise<HeadlessResult>;
    /** why a run may not start here now (engine off or not for agents, Fable, effort max…); null = it may */
    refuses(req: Pick<HeadlessRequest, 'engine' | 'model' | 'effort'>): string | null;
    killAll(): void;
  };
  /** how often the queue is read (default 60 s) */
  everyMs?: number;
  /** runs at once in the app (default 2) */
  maxRunning?: number;
  /** how long one call of app-queue.mjs may take (default 30 s) */
  scriptMs?: number;
}

export const queueScript = (root: string): string => path.join(root, 'harness', 'compare', 'app-queue.mjs');

const ROUND = /^[\w.-]{1,120}$/;
const NAME = /^[a-z0-9][a-z0-9._-]{0,80}$/i;
const PROMPT_MAX = 1_000_000;
const DENY_MAX = 20;
/** the run's denyRead: absent = []; anything but a short list of absolute paths = malformed (the run is left out) */
const denyOf = (v: unknown): string[] | undefined => (v === undefined || v === null ? []
  : Array.isArray(v) && v.length <= DENY_MAX && v.every(d => typeof d === 'string' && d.length <= 1000 && path.isAbsolute(d)) ? (v as string[]) : undefined);
const optStr = (v: unknown): string | null | undefined => (v === null || v === undefined ? null : typeof v === 'string' ? v : undefined);

/** app-queue.mjs `list` stdout → the runs this app may take (side b only; a malformed run is left out and logged). */
export function parseRuns(stdout: string): QueueRun[] {
  let raw: unknown;
  try { raw = JSON.parse(stdout.trim().split('\n').at(-1) ?? ''); } catch { throw new Error('la lista delle esecuzioni non è JSON'); }
  const runs = raw && typeof raw === 'object' && Array.isArray((raw as { runs?: unknown }).runs) ? (raw as { runs: unknown[] }).runs : null;
  if (!runs) throw new Error('la lista delle esecuzioni non ha "runs"');
  return runs.flatMap(r => {
    const x = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
    const model = optStr(x.model), effort = optStr(x.effort), denyRead = denyOf(x.denyRead);
    const ok = typeof x.round === 'string' && ROUND.test(x.round) && x.side === 'b' && typeof x.experiment === 'string' && NAME.test(x.experiment)
      && typeof x.engine === 'string' && ENGINE_ID.test(x.engine) && model !== undefined && effort !== undefined && denyRead !== undefined
      && typeof x.cwd === 'string' && x.cwd.length > 0 && typeof x.prompt === 'string' && x.prompt.trim().length > 0 && x.prompt.length <= PROMPT_MAX;
    if (!ok) {
      log.warn('compare', 'queue run left out: malformed', { data: { round: typeof x.round === 'string' ? x.round.slice(0, 120) : null, side: x.side ?? null }, cause: 'app-queue.mjs listed a run without a valid round, side b, experiment, engine, cwd, prompt or denyRead', hint: 'check harness/compare/app-queue.mjs list in the brain' });
      return [];
    }
    return [{ round: x.round as string, side: 'b' as const, experiment: x.experiment as string, engine: x.engine as string, model: model ?? null, effort: effort ?? null, cwd: x.cwd as string, prompt: x.prompt as string, denyRead: denyRead ?? [] }];
  });
}

/** A run's token total as the brain reads side a's (anon.mjs: the Claude API usage keys), or null when unknown. */
export function brainTokens(t: TokenUsage | null): Record<string, number> | null {
  return t ? { input_tokens: t.input, cache_creation_input_tokens: t.cacheWrite, cache_read_input_tokens: t.cacheRead, output_tokens: t.output } : null;
}

/** Whether this instance runs the queue: only the user's stable app outside tests (the dev instance, run by agents
 *  and tests, never spends tokens on the user's comparison rounds), or one that SB_COMPARE_QUEUE=1 asks for explicitly. */
export function queueAllowed(stable: boolean, env: NodeJS.ProcessEnv): boolean {
  return (stable && !env.SB_TEST) || env.SB_COMPARE_QUEUE === '1';
}

export class CompareQueue {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private stopped = false;
  /** runs this app took (round/side): never taken again, whatever happened (no retry) */
  private readonly taken = new Set<string>();
  private readonly active = new Map<string, Promise<void>>();
  /** refusals already logged (engine + reason): a refused run is skipped at every look, logged once */
  private readonly refusedSeen = new Set<string>();

  constructor(private readonly d: CompareQueueDeps) {}

  /** runs going on now */
  get running(): number { return this.active.size; }

  start(): void {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => { void this.tick(); }, this.d.everyMs ?? 60_000);
    this.timer.unref?.();
  }

  /** One look at the queue: takes what fits under the limit. Resolves once the runs taken are started (not finished). */
  async tick(): Promise<void> {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      const max = this.d.maxRunning ?? 2;
      if (this.active.size >= max) return;
      const root = this.d.brainRoot();
      if (!root || !fs.existsSync(queueScript(root))) return;
      if (!(await this.d.anyOn())) return;
      const listed = await this.call(root, ['list']);
      if (!listed) return;
      let runs: QueueRun[];
      try { runs = parseRuns(listed); } catch (e) { log.warn('compare', 'queue list unreadable', { data: { error: errText(e) } }); return; }
      for (const run of runs) {
        if (this.stopped || this.active.size >= max) break;
        const key = `${run.round}/${run.side}`;
        if (this.taken.has(key)) continue;
        // a run this app may not do now is left queued, untouched (not started, never failed): it runs once the user
        // turns the engine on, or the brain changes the run
        const why = this.d.runner.refuses(run);
        if (why) { this.refused(run, why); continue; }
        if (!(await this.take(root, run))) continue;
        this.taken.add(key);
        const p = this.execute(root, run).finally(() => this.active.delete(key));
        this.active.set(key, p);
      }
    } catch (e) {
      log.warn('compare', 'queue tick failed', { data: { error: errText(e) } });
    } finally { this.ticking = false; }
  }

  private refused(run: QueueRun, why: string): void {
    const k = `${run.engine}|${why}`;
    if (this.refusedSeen.has(k)) return;
    if (this.refusedSeen.size > 200) this.refusedSeen.clear();
    this.refusedSeen.add(k);
    log.warn('compare', 'queue run skipped: not allowed here', { data: { engine: run.engine, round: run.round, why }, cause: why, hint: 'the run stays queued in the brain; turn the engine on (and «Le Regie possono usare» it) in Settings → Motori, or change side b of the experiment' });
  }

  /** start: the brain marks the run as taken, or says why not. */
  private async take(root: string, run: QueueRun): Promise<boolean> {
    const out = await this.call(root, ['start', '--round', run.round, '--side', run.side]);
    if (out === null) return false;
    try {
      const r = JSON.parse(out.trim().split('\n').at(-1) ?? '') as { ok?: unknown; why?: unknown };
      if (r.ok === true) return true;
      log.info('compare', 'queue run not started by the brain', { data: { round: run.round, side: run.side, why: typeof r.why === 'string' ? r.why.slice(0, 200) : null } });
    } catch { log.warn('compare', 'queue start answer unreadable', { data: { round: run.round, side: run.side } }); }
    return false;
  }

  /** The run itself, then its answer or its failure back to the brain. */
  private async execute(root: string, run: QueueRun): Promise<void> {
    const args = ['--round', run.round, '--side', run.side];
    let r: HeadlessResult;
    try {
      r = await this.d.runner.run({ engine: run.engine, prompt: run.prompt, cwd: run.cwd, model: run.model, effort: run.effort, round: run.round, denyRead: run.denyRead });
    } catch (e) { r = { ok: false, error: shortError(errText(e)), durationMs: 0 }; }
    // the app quitting, or a refusal found only now (a switch turned off since the look): no fail, which would close the
    // round for good; the brain's claim goes stale and the run is offered again
    if (!r.ok && (this.stopped || r.refused)) {
      log.info('compare', 'queue run not written back', { data: { round: run.round, side: run.side, why: this.stopped ? 'app quit' : r.error } });
      return;
    }
    const sent = r.ok
      ? await this.call(root, ['record', ...args], JSON.stringify({ engine: run.engine, model: r.model, effort: r.effort, text: r.text, costUsd: r.costUsd, tokens: brainTokens(r.tokens), durationMs: r.durationMs, turns: r.turns }))
      : await this.call(root, ['fail', ...args], JSON.stringify({ error: r.error, durationMs: r.durationMs }));
    if (sent === null) log.warn('compare', `queue ${r.ok ? 'record' : 'fail'} not taken by the brain`, { data: { round: run.round, side: run.side }, cause: 'app-queue.mjs exited with an error', hint: 'the run stays as the brain left it; see the warn line above for its stderr' });
  }

  /** One call of app-queue.mjs; null = it failed (logged with its stderr's error line). */
  private async call(root: string, args: string[], input?: string): Promise<string | null> {
    const r = await runNode(this.d.node, queueScript(root), args, root, this.d.scriptMs ?? 30_000, input);
    if (r.code === 0) return r.stdout;
    log.warn('compare', 'app-queue.mjs failed', { data: { command: args[0], code: r.code, error: errLine(r.stderr) || r.error || null } });
    return null;
  }

  /** App quit: no new run, running sessions killed (nothing written back: the brain's claims go stale). */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.d.runner.killAll();
    await Promise.allSettled([...this.active.values()]);
  }

  /** Last resort at quit: kill the running sessions now. */
  killNow(): void {
    this.stopped = true;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.d.runner.killAll();
  }
}
