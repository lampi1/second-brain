// The app's side b queue (src/main/compare/queue.ts + headless.ts, ADR 0046 §4) against the brain's REAL
// harness/compare/app-queue.mjs, not the fixture: the two halves of the comparison must agree on commands, shapes and
// files. Why: queue.test.ts runs against test/fixtures/brain/compare/app-queue.mjs, a fake that can drift from the
// brain's script; this test copies the real script and only the brain files it imports (followed from its imports)
// into a temporary brain, adds a minimal experiment, its switch and one round in the shape capture.mjs writes
// (capture.json, a.json, a.md, task.txt), then runs one full cycle with the fake Claude (test/fixtures/fake-claude.mjs)
// as side b: list → start → hidden read-only run → record (or fail). Never a real CLI, never a token; the real brain
// is only read. The brain is the folder SB_COMPARE_BRAIN names; without one that has harness/compare/app-queue.mjs
// (CI, other machines) the suite is skipped.
// Run: SB_COMPARE_BRAIN=<brain folder> npx vitest run test/unit/compare
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CompareQueue } from '../../../src/main/compare/queue';
import { HeadlessRunner, type HeadlessRequest, type HeadlessResult } from '../../../src/main/compare/headless';
import { claudeReadRule } from '../../../src/main/chats/claude';
import { log } from '../../../src/main/log';
import { plainNode, tmpDir } from '../brain/helpers';
import { FAKE, fakeLog, tmp, waitFor } from '../chats/helpers';

const BRAIN = process.env.SB_COMPARE_BRAIN;
const REAL = BRAIN && fs.existsSync(path.join(BRAIN, 'harness', 'compare', 'app-queue.mjs')) ? BRAIN : null;

/** Copies a brain script and, recursively, every relative module it imports (static or dynamic), same layout. */
function copyWithImports(from: string, rel: string, to: string, seen = new Set<string>()): void {
  if (seen.has(rel)) return;
  seen.add(rel);
  const src = path.join(from, rel);
  fs.mkdirSync(path.dirname(path.join(to, rel)), { recursive: true });
  fs.copyFileSync(src, path.join(to, rel));
  const code = fs.readFileSync(src, 'utf8');
  for (const m of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)['"](\.{1,2}\/[^'"]+)['"]/gm)) {
    copyWithImports(from, path.relative(from, path.resolve(path.dirname(src), m[1]!)), to, seen);
  }
}

const EXP = 'app-real-queue';
const CAPTURED = '2026-10-14 10:00:00';

/** A temporary brain: the real app-queue.mjs and its imports, one experiment ON, one round waiting for side b. */
function brain(task: (outputDir: string) => string): { root: string; round: string; out: string; outputDir: string; repo: string; copied: string[] } {
  const root = tmpDir('sb-realq-');
  const seen = new Set<string>();
  copyWithImports(REAL!, path.join('harness', 'compare', 'app-queue.mjs'), root, seen);
  // the experiment (shape: harness/compare/README.md) and the user's switch for it (config.mjs stateOf)
  const exps = path.join(root, 'harness', 'compare', 'experiments');
  fs.mkdirSync(exps, { recursive: true });
  fs.writeFileSync(path.join(exps, `${EXP}.json`), JSON.stringify({
    name: EXP, title: 'test', description: 'test',
    a: { engine: 'cursor', capture: { agents: ['reviewer'] } },
    b: { engine: 'claude', model: 'opus', effort: 'medium' },
    judge: { engine: 'manual' }, writer: { tool: 'none' },
    defaults: { on: false, feedback: true, agents: { reviewer: true } },
  }));
  const state = path.join(root, 'ops', 'state', 'compare');
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(state, 'switch.json'), JSON.stringify({ experiments: { [EXP]: { on: true, agents: { reviewer: true }, on_since: '2026-10-14 09:00:00' } } }));
  // the canonical agent side b gets (app-queue.mjs canonical): a minimal one, whose words never steer the fake Claude
  fs.mkdirSync(path.join(root, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'agents', 'reviewer.md'), '---\nname: reviewer\n---\nRivedi il diff e riporta i problemi.\n');
  // side a's working folder and output folder (outside the brain), and one round as capture.mjs writes it
  const repo = tmp('realq-repo'), outputDir = tmp('realq-aout');
  const round = '2026-10-14-repo-fix-x';
  const out = path.join(root, 'reviews', 'compare');
  const dir = path.join(out, round);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'task.txt'), task(outputDir.replace(/\\/g, '/')));
  fs.writeFileSync(path.join(dir, 'a.md'), '[Alta] a.js:3 · risposta di A · x · fix');
  const j = (f: string, o: unknown) => fs.writeFileSync(path.join(dir, f), `${JSON.stringify(o, null, 2)}\n`);
  j('capture.json', {
    name: round, round: 1, agent: 'reviewer', experiment: EXP, repo: 'repo', repo_path: null, ref: 'fix/x', dimension: null,
    workspace: repo.replace(/\\/g, '/'), output_dir: outputDir.replace(/\\/g, '/'), description: 'review', task_sha256: 'x', captured_at: CAPTURED, switch_on_at_capture: true,
  });
  j('a.json', { side: 'a', engine: 'cursor', status: 'completed', model: 'grok-4.7-fast', duration_ms: 95000, tokens: null, cost_usd: null, cost_source: 'da usage export', frozen_at: CAPTURED, sha256: 'x' });
  return { root, round, out, outputDir, repo, copied: [...seen] };
}

let claudeLog = '';
beforeEach(() => {
  claudeLog = path.join(tmp('realq-log'), 'claude.jsonl');
  vi.stubEnv('FAKE_CLAUDE_LOG', claudeLog);
  vi.stubEnv('CLAUDE_CONFIG_DIR', tmp('realq-claude-home'));
});
afterEach(() => { vi.unstubAllEnvs(); });

const ON = { engineOn: { claude: true }, engines: { claude: true } };
/** The real hidden runner on the fake Claude, recording what it was asked and what it gave back. No app-wide denyRead:
 *  the folders a run may not read come from the brain's list only, so the test sees that list applied. */
function spyRunner() {
  const real = new HeadlessRunner({ userData: tmp('realq-userdata'), settings: () => ON, keyFor: () => null, enginePaths: () => ({ claude: FAKE }) });
  const asked: HeadlessRequest[] = [], results: HeadlessResult[] = [];
  return {
    asked, results,
    refuses: (r: Pick<HeadlessRequest, 'engine' | 'model' | 'effort'>) => real.refuses(r),
    run: async (r: HeadlessRequest) => { asked.push(r); const res = await real.run(r); results.push(res); return res; },
    killAll: () => real.killAll(),
  };
}
const exists = (...p: string[]) => fs.existsSync(path.join(...p));
const slashKey = (p: string) => path.resolve(p).replace(/\\/g, '/').toLowerCase();

describe.skipIf(!REAL)('side b queue against the brain\'s real app-queue.mjs', { timeout: 120e3 }, () => {
  it('list → start → hidden run → record: b.md and b.json carry the run\'s text, cost and engine; denyRead applied; never run twice', async () => {
    // the task reads a file in side a's output folder (the fake Claude's readgate): the brain lists that folder in denyRead
    const b = brain(outDir => `Repo: C:/x/repo\nRivedi fix/x. readgate=${outDir}/out.md`);
    expect(b.copied.map(f => f.replace(/\\/g, '/'))).toEqual(expect.arrayContaining(['harness/compare/app-queue.mjs', 'harness/compare/lib.mjs', 'harness/compare/config.mjs', 'harness/compare/compare.mjs']));
    const runner = spyRunner();
    const q = new CompareQueue({ brainRoot: () => b.root, node: plainNode, anyOn: async () => true, runner });
    log.recent.length = 0;
    await q.tick();
    expect(runner.asked).toHaveLength(1);
    const req = runner.asked[0]!;
    expect(req).toMatchObject({ engine: 'claude', model: 'opus', effort: 'medium', round: b.round });
    expect(slashKey(req.cwd)).toBe(slashKey(b.repo)); // side a's workspace
    expect(req.prompt).toContain('Rivedi il diff e riporta i problemi.'); // the canonical agent
    expect(req.prompt).toContain('Read-only mode'); // the brain's read-only note
    // denyRead from list: reviews/compare and side a's output folder, both absolute
    expect((req.denyRead ?? []).map(slashKey).sort()).toEqual([slashKey(b.out), slashKey(b.outputDir)].sort());
    expect(exists(b.out, b.round, 'b.running.json')).toBe(true); // claimed by start
    await waitFor(() => q.running === 0, 'the run written back', 60e3);

    const res = runner.results[0]!;
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // applied: the fake got them as deny rules, and its Read inside side a's output folder was refused
    const argv = fakeLog(claudeLog).find(l => l.argv)!.argv!;
    const deny = (JSON.parse(argv[argv.indexOf('--settings') + 1]!) as { permissions: { deny: string[] } }).permissions.deny;
    expect(deny).toEqual(expect.arrayContaining([claudeReadRule(req.denyRead![0]!), claudeReadRule(req.denyRead![1]!)]));
    expect(log.recent.filter(e => e.msg === 'headless permission answered').map(e => e.data as { tool: string; allow: boolean }))
      .toContainEqual(expect.objectContaining({ tool: 'Read', allow: false }));

    // record: b.md = the run's text, b.json = its engine, model, cost, tokens, turns; the claim dropped
    const dir = path.join(b.out, b.round);
    expect(fs.readFileSync(path.join(dir, 'b.md'), 'utf8')).toBe(res.text.trim());
    const bj = JSON.parse(fs.readFileSync(path.join(dir, 'b.json'), 'utf8')) as Record<string, unknown>;
    expect(bj).toMatchObject({ side: 'b', status: 'completed', engine: 'claude', model: res.model, effort: 'medium', cost_usd: res.costUsd, cost_source: 'app', num_turns: res.turns, experiment: EXP,
      tokens: { input_tokens: res.tokens!.input, cache_creation_input_tokens: res.tokens!.cacheWrite, cache_read_input_tokens: res.tokens!.cacheRead, output_tokens: res.tokens!.output } });
    expect(res.costUsd).toBe(0.01);
    expect(exists(dir, 'b.running.json')).toBe(false);
    expect(exists(dir, 'b.error.json')).toBe(false);

    // a second look: the brain lists nothing, the app runs nothing (one fake start in all)
    await q.tick();
    await q.tick();
    expect(runner.asked).toHaveLength(1);
    expect(fakeLog(claudeLog).filter(l => l.argv)).toHaveLength(1);
  });

  it('a run that fails (the engine crashes) goes back with fail: b.error.json, no b.md, claim dropped, never rerun', async () => {
    const b = brain(() => 'Repo: C:/x/repo\ncrash');
    const runner = spyRunner();
    const q = new CompareQueue({ brainRoot: () => b.root, node: plainNode, anyOn: async () => true, runner });
    await q.tick();
    expect(runner.asked).toHaveLength(1);
    await waitFor(() => q.running === 0, 'the failure written back', 60e3);
    const res = runner.results[0]!;
    expect(res.ok).toBe(false);
    const dir = path.join(b.out, b.round);
    const err = JSON.parse(fs.readFileSync(path.join(dir, 'b.error.json'), 'utf8')) as { why: string; duration_ms: number | null; via: string };
    expect(err).toMatchObject({ via: 'app', why: (res as { error: string }).error, duration_ms: res.durationMs });
    expect(exists(dir, 'b.md')).toBe(false);
    expect(exists(dir, 'b.running.json')).toBe(false);
    await q.tick();
    expect(runner.asked).toHaveLength(1);
    expect(fakeLog(claudeLog).filter(l => l.argv)).toHaveLength(1);
  });
});
