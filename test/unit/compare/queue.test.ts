// The app's half of the comparison queue (src/main/compare/queue.ts, ADR 0046 §4) against the fake brain queue
// (test/fixtures/brain/compare/app-queue.mjs, same commands and shapes as the brain's): list → start → run → record,
// a failed run written back with fail, a refused run (engine off…) never started nor failed, nothing written back at
// quit, at most 2 runs at once, a run never taken twice, nothing while every experiment is off or without
// app-queue.mjs, malformed runs left out, only the stable app running the queue. The runs themselves are a fake runner here
// (the hidden sessions are tested in headless.test.ts).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CompareQueue, parseRuns, queueAllowed, queueScript, type QueueRun } from '../../../src/main/compare/queue';
import { log } from '../../../src/main/log';
import type { HeadlessRequest, HeadlessResult } from '../../../src/main/compare/headless';
import { FIXTURES, plainNode, tmpDir } from '../brain/helpers';
import { waitFor } from '../chats/helpers';

const run = (round: string, o: Partial<QueueRun> = {}): QueueRun => ({
  round, side: 'b', experiment: 'ab', engine: 'claude', model: 'opus', effort: 'medium', cwd: path.resolve('repo'), prompt: `rivedi ${round}`, denyRead: [path.resolve('brain/reviews/compare/a-out')], ...o,
});

function brain(runs: QueueRun[]): string {
  const root = tmpDir('sb-queue-');
  const d = path.join(root, 'harness', 'compare');
  fs.mkdirSync(d, { recursive: true });
  fs.copyFileSync(path.join(FIXTURES, 'compare', 'app-queue.mjs'), queueScript(root));
  const state = path.join(root, 'ops', 'state', 'compare');
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(state, 'app-queue.json'), JSON.stringify({ runs: runs.map(r => ({ ...r, status: 'queued' })) }));
  return root;
}
const stateOf = (root: string) => (JSON.parse(fs.readFileSync(path.join(root, 'ops', 'state', 'compare', 'app-queue.json'), 'utf8')) as { runs: (QueueRun & { status: string; result?: unknown })[] }).runs;
const calls = (root: string) => {
  const f = path.join(root, 'harness', 'compare', 'app-queue.log');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l) as { cmd: string; round: string | null; stdin: unknown }) : [];
};

/** A runner whose runs end when the test says so. */
function fakeRunner(refuse: (req: Pick<HeadlessRequest, 'engine' | 'model' | 'effort'>) => string | null = () => null) {
  const asked: HeadlessRequest[] = [];
  const pending = new Map<string, (r: HeadlessResult) => void>();
  let killed = 0;
  return {
    asked, pending, get killed() { return killed; },
    refuses: refuse,
    run: (req: HeadlessRequest) => { asked.push(req); return new Promise<HeadlessResult>(res => pending.set(req.round, res)); },
    killAll: () => { killed++; for (const [k, res] of pending) { pending.delete(k); res({ ok: false, error: 'il motore si è chiuso prima di finire', durationMs: 5 }); } },
  };
}
const OK: HeadlessResult = { ok: true, text: 'Trovati 3 problemi', model: 'claude-opus-5', effort: 'medium', costUsd: 0.42, tokens: { input: 120, cacheRead: 9000, cacheWrite: 2000, output: 880 }, turns: 7, durationMs: 61000 };

// every case starts Node children (1-5 s each on a busy Windows machine)
describe('comparison queue', { timeout: 120e3 }, () => {
  it('list → start → run → record, with what the brain needs and nothing else', async () => {
    const root = brain([run('r1')]);
    const runner = fakeRunner();
    const q = new CompareQueue({ brainRoot: () => root, node: plainNode, anyOn: async () => true, runner });
    await q.tick();
    expect(runner.asked).toEqual([{ engine: 'claude', prompt: 'rivedi r1', cwd: path.resolve('repo'), model: 'opus', effort: 'medium', round: 'r1', denyRead: [path.resolve('brain/reviews/compare/a-out')] }]);
    expect(stateOf(root)[0]!.status).toBe('running');
    runner.pending.get('r1')!(OK);
    await waitFor(() => q.running === 0, 'the run written back');
    expect(stateOf(root)[0]).toMatchObject({ status: 'done', result: { engine: 'claude', model: 'claude-opus-5', effort: 'medium', text: 'Trovati 3 problemi', costUsd: 0.42, durationMs: 61000, turns: 7,
      // the run's total in the shape the brain reads side a's (anon.mjs: Claude API usage keys)
      tokens: { input_tokens: 120, cache_creation_input_tokens: 2000, cache_read_input_tokens: 9000, output_tokens: 880 } } });
    expect(calls(root).map(c => c.cmd)).toEqual(['list', 'start', 'record']);
    // taken once, never again (no retry), even if the brain listed it again
    await q.tick();
    expect(runner.asked).toHaveLength(1);
  });

  it('a run that failed (an engine error, the timeout) goes back with fail and a short reason', async () => {
    const root = brain([run('r1')]);
    const runner = fakeRunner();
    const q = new CompareQueue({ brainRoot: () => root, node: plainNode, anyOn: async () => true, runner });
    await q.tick();
    runner.pending.get('r1')!({ ok: false, error: 'tempo scaduto (45 min): fermato', durationMs: 3 });
    await waitFor(() => q.running === 0, 'the failure written back');
    expect(stateOf(root)[0]).toMatchObject({ status: 'failed', result: { error: 'tempo scaduto (45 min): fermato', durationMs: 3 } });
    expect(calls(root).map(c => c.cmd)).toEqual(['list', 'start', 'fail']);
  });

  it('a run this app may not do (engine off, not for agents, Fable…) is never started nor failed: it stays queued', async () => {
    const root = brain([run('r1'), run('r2', { engine: 'cursor' })]);
    let claudeOn = false;
    const runner = fakeRunner(r => (r.engine === 'claude' && !claudeOn ? 'Claude è spento nelle impostazioni' : null));
    const q = new CompareQueue({ brainRoot: () => root, node: plainNode, anyOn: async () => true, runner });
    log.recent.length = 0;
    await q.tick();
    await q.tick();
    expect(runner.asked.map(r => r.round)).toEqual(['r2']);
    expect(stateOf(root).map(r => r.status)).toEqual(['queued', 'running']);
    expect(calls(root).filter(c => c.round === 'r1')).toEqual([]); // no start, no fail: the round is not burnt
    expect(log.recent.filter(e => e.msg === 'queue run skipped: not allowed here')).toHaveLength(1); // logged once
    // turned on later: the run starts then
    claudeOn = true;
    await q.tick();
    expect(runner.asked.map(r => r.round)).toEqual(['r2', 'r1']);
  });

  it('a refusal found only when the run starts (a switch turned off since the look) writes nothing back', async () => {
    const root = brain([run('r1')]);
    const runner = fakeRunner();
    const q = new CompareQueue({ brainRoot: () => root, node: plainNode, anyOn: async () => true, runner });
    await q.tick();
    runner.pending.get('r1')!({ ok: false, refused: true, error: 'Claude è spento nelle impostazioni', durationMs: 0 });
    await waitFor(() => q.running === 0, 'the run over');
    expect(calls(root).map(c => c.cmd)).toEqual(['list', 'start']);
    expect(stateOf(root)[0]!.status).toBe('running'); // the brain's claim goes stale, the round is offered again
  });

  it('only the stable app runs the queue, never the dev instance nor a test, unless SB_COMPARE_QUEUE=1', () => {
    expect(queueAllowed(true, {})).toBe(true);
    expect(queueAllowed(false, {})).toBe(false);
    expect(queueAllowed(true, { SB_TEST: '1' })).toBe(false);
    expect(queueAllowed(false, { SB_COMPARE_QUEUE: '1' })).toBe(true);
    expect(queueAllowed(false, { SB_COMPARE_QUEUE: 'yes' })).toBe(false);
  });

  it('at most 2 runs at once; the next one starts at a later look', async () => {
    const root = brain([run('r1'), run('r2'), run('r3')]);
    const runner = fakeRunner();
    const q = new CompareQueue({ brainRoot: () => root, node: plainNode, anyOn: async () => true, runner });
    await q.tick();
    expect(runner.asked.map(r => r.round)).toEqual(['r1', 'r2']);
    expect(stateOf(root).map(r => r.status)).toEqual(['running', 'running', 'queued']);
    await q.tick(); // still full: not even listed
    expect(calls(root).filter(c => c.cmd === 'list')).toHaveLength(1);
    runner.pending.get('r1')!(OK);
    await waitFor(() => q.running === 1, 'one slot free');
    await q.tick();
    expect(runner.asked.map(r => r.round)).toEqual(['r1', 'r2', 'r3']);
  });

  it('no work while every experiment is off, or without app-queue.mjs or a brain', async () => {
    const root = brain([run('r1')]);
    const runner = fakeRunner();
    await new CompareQueue({ brainRoot: () => root, node: plainNode, anyOn: async () => false, runner }).tick();
    expect(calls(root)).toEqual([]);
    fs.rmSync(queueScript(root));
    let asked = false;
    await new CompareQueue({ brainRoot: () => root, node: plainNode, anyOn: async () => { asked = true; return true; }, runner }).tick();
    await new CompareQueue({ brainRoot: () => null, node: plainNode, anyOn: async () => { asked = true; return true; }, runner }).tick();
    expect(asked).toBe(false);
    expect(runner.asked).toEqual([]);
  });

  it('a run the brain will not start is never run', async () => {
    const root = brain([run('r1')]);
    // the brain's answer to start: taken by someone else meanwhile
    fs.writeFileSync(queueScript(root), [
      "const cmd = process.argv[2];",
      "if (cmd === 'list') console.log(JSON.stringify({ runs: [{ round: 'r1', side: 'b', experiment: 'ab', engine: 'claude', model: null, effort: null, cwd: 'C:/repo', prompt: 'x' }] }));",
      "else console.log(JSON.stringify({ ok: false, why: 'già preso' }));",
    ].join(String.fromCharCode(10)));
    const runner = fakeRunner();
    await new CompareQueue({ brainRoot: () => root, node: plainNode, anyOn: async () => true, runner }).tick();
    expect(runner.asked).toEqual([]);
  });

  it('stop kills the running sessions, writes nothing back (the claim goes stale, the round is not burnt) and looks no more', async () => {
    const root = brain([run('r1')]);
    const runner = fakeRunner();
    const q = new CompareQueue({ brainRoot: () => root, node: plainNode, anyOn: async () => true, runner });
    await q.tick();
    expect(runner.asked.map(r => r.round)).toEqual(['r1']);
    await q.stop();
    expect(runner.killed).toBe(1);
    expect(stateOf(root)[0]!.status).toBe('running');
    expect(calls(root).map(c => c.cmd)).toEqual(['list', 'start']);
    await q.tick();
    expect(calls(root).filter(c => c.cmd === 'list')).toHaveLength(1);
  });

  it('parseRuns keeps only well-formed side-b runs', () => {
    const good = run('2026-10-14_r1');
    const out = parseRuns(`noise\n${JSON.stringify({ runs: [good, { ...good, side: 'a' }, { ...good, round: '../x' }, { ...good, engine: 'Bad Engine' }, { ...good, prompt: ' ' }, { ...good, model: 3 }, { ...good, model: null, effort: undefined }, { ...good, denyRead: 'C:/x' }, { ...good, denyRead: ['relative/x'] }, { ...good, denyRead: undefined }] })}\n`);
    // a denyRead that is not a list of absolute folders leaves the run out; an absent one is none
    expect(out).toEqual([good, { ...good, model: null, effort: null }, { ...good, denyRead: [] }]);
    expect(() => parseRuns('nope')).toThrow(/non è JSON/);
    expect(() => parseRuns('{"x":1}')).toThrow(/runs/);
  });
});
