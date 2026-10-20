import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FailureDedup, failureSignature, globToRegExp, outcomeEvent, ProductSync, summarize } from '../../src/main/sync';
import type { BrainService } from '../../src/main/services';

describe('product sync', () => {
  it('globs match product paths only', () => {
    expect(globToRegExp('ops/tools/**').test('ops/tools/inbox.mjs')).toBe(true);
    expect(globToRegExp('ops/tools/**').test('ops/tools/brain-site/parse.mjs')).toBe(true);
    expect(globToRegExp('.claude/agents/*.md').test('.claude/agents/reviewer.md')).toBe(true);
    expect(globToRegExp('.claude/agents/*.md').test('.claude/agents/x/y.md')).toBe(false);
    expect(globToRegExp('ops/tools/**').test('now.md')).toBe(false);
  });

  it('outcomes become feed events: ok quiet, blocked and error loud, running nothing', () => {
    expect(outcomeEvent({ release: '0.1.0-abc', startedAt: 'x', running: true })).toBeNull();
    expect(outcomeEvent({ release: '0.1.0-abc', startedAt: 'x', endedAt: 'y', exitCode: 0, ok: true, summary: 'pushed 1 commit' })?.kind).toBe('sync-ok');
    const b = outcomeEvent({ release: 'brain-2026', startedAt: 'x', endedAt: 'y', exitCode: 2, ok: false, blocked: true, summary: 'src/a.ts:3 rule secret' });
    expect(b).toMatchObject({ kind: 'sync-blocked', detail: 'src/a.ts:3 rule secret' });
    expect(b?.title).toContain('prodotto nel brain');
    expect(outcomeEvent({ release: '0.1.0-abc', startedAt: 'x', endedAt: 'y', exitCode: 1, ok: false })?.kind).toBe('sync-error');
  });

  it('a new outcome file is published once; old files are not', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-sync-'));
    fs.mkdirSync(path.join(base, 'sync'));
    fs.writeFileSync(path.join(base, 'sync', 'old.json'), JSON.stringify({ release: 'old', startedAt: 'x', endedAt: 'y', exitCode: 0, ok: true }));
    const got: { kind: string }[] = [];
    const brain = { publish: (e: { kind: string }[]) => got.push(...e) } as unknown as BrainService;
    const s = new ProductSync({ base, brainRoot: () => null, brain, nodeExe: process.execPath, firstScanMs: 0 });
    s.start();
    fs.writeFileSync(path.join(base, 'sync', '0.1.0-abc.json'), JSON.stringify({ release: '0.1.0-abc', startedAt: 'x', endedAt: 'y', exitCode: 2, ok: false, blocked: true, summary: 'x' }));
    for (let i = 0; i < 40 && !got.length; i++) await new Promise(r => setTimeout(r, 50));
    s.stop();
    expect(got.map(e => e.kind)).toEqual(['sync-blocked']);
  });

  it('a failure says since when GitHub is behind, its count line first; a crash keeps its cause', () => {
    const b = outcomeEvent({ release: 'brain-1', startedAt: 'x', endedAt: 'y', exitCode: 2, ok: false, blocked: true, summary: 'src/a.ts:3  deny-list\nguard: BLOCKED, 1 findings (deny-list 1)' }, '2026-10-11T18:22:06.041Z');
    expect(b?.title).toBe('GitHub fermo: pubblicazione bloccata dal controllo (prodotto nel brain)');
    expect(b?.detail.split('\n')).toEqual([`Ultimo aggiornamento riuscito di GitHub: ${new Date('2026-10-11T18:22:06.041Z').toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '')}`, 'guard: BLOCKED, 1 findings (deny-list 1)', 'src/a.ts:3  deny-list']);
    expect(outcomeEvent({ release: '0.1.0-abc', startedAt: 'x', endedAt: 'y', exitCode: 1, ok: false, summary: 'boom' }, null)?.detail).toBe('Ultimo aggiornamento riuscito di GitHub: mai\nboom');
    const crash = ['product-sync: start', 'Error: Command failed: git cat-file blob 1234', '    at x (a.mjs:1)', '    at y (a.mjs:2)', '  pid: 1,', '  stdout: Buffer(0) [],', '  stderr: Buffer(0) []', '}', '', 'Node.js v22.21.1'].join('\n');
    expect(summarize(crash).split('\n')).toEqual(['Error: Command failed: git cat-file blob 1234', '…', '  pid: 1,', '  stdout: Buffer(0) [],', '  stderr: Buffer(0) []', '}', '', 'Node.js v22.21.1']);
    expect(summarize('a\nb')).toBe('a\nb');
  });

  describe('across restarts', () => {
    const blocked = (release: string, summary: string) => JSON.stringify({ release, startedAt: 'x', endedAt: '2026-10-14T05:00:00.000Z', exitCode: 2, ok: false, blocked: true, summary });
    const ok = (release: string, endedAt: string) => JSON.stringify({ release, startedAt: 'x', endedAt, exitCode: 0, ok: true, summary: 'pubblicato' });
    // distinct mtimes in the order given: the files' order is the order the syncs ended in
    let t = Date.now() / 1000 - 1000;
    const put = (base: string, name: string, body: string) => { const f = path.join(base, 'sync', name); fs.writeFileSync(f, body); t += 10; fs.utimesSync(f, t, t); };
    const setup = () => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-sync-'));
      fs.mkdirSync(path.join(base, 'sync'));
      const got: { kind: string; detail: string }[] = [];
      const brain = { publish: (e: { kind: string; detail: string }[]) => got.push(...e) } as unknown as BrainService;
      const make = () => new ProductSync({ base, brainRoot: () => null, brain, nodeExe: process.execPath, firstScanMs: 0 });
      return { base, got, make };
    };
    const until = async (cond: () => boolean) => { for (let i = 0; i < 40 && !cond(); i++) await new Promise(r => setTimeout(r, 50)); };

    it('first start: the newest outcome, when it failed, is shown once; older ones are not', () => {
      const { base, got, make } = setup();
      put(base, 'brain-0.json', ok('brain-0', '2026-10-11T18:22:06.041Z'));
      put(base, 'brain-1.json', blocked('brain-1', 'src/old.ts:1 rule'));
      put(base, 'brain-2.json', blocked('brain-2', 'src/a.ts:3 rule'));
      const s = make(); s.start(); s.stop();
      expect(got.map(e => e.detail.split('\n').at(-1))).toEqual(['src/a.ts:3 rule']);
      expect(got[0]!.detail).toContain('Ultimo aggiornamento riuscito di GitHub: ');
    });

    it('a failure already shown is not shown again after a restart; one that ended while the app was closed is', async () => {
      const { base, got, make } = setup();
      put(base, 'brain-1.json', blocked('brain-1', 'src/a.ts:3 rule'));
      const s1 = make(); s1.start(); s1.stop();
      expect(got).toHaveLength(1);
      const s2 = make(); s2.start();
      put(base, 'brain-2.json', blocked('brain-2', 'src/a.ts:3 rule'));
      await new Promise(r => setTimeout(r, 300));
      s2.stop();
      expect(got).toHaveLength(1); // same problem, restart in between: still once
      // the release sync ends while the promotion restarts the app: shown at the next start
      put(base, '0.1.0-abc.json', JSON.stringify({ release: '0.1.0-abc', startedAt: 'x', endedAt: 'y', exitCode: 1, ok: false, blocked: false, summary: 'Error: spawn git EAGAIN' }));
      const s3 = make(); s3.start();
      await until(() => got.length > 1);
      s3.stop();
      expect(got.map(e => e.kind)).toEqual(['sync-blocked', 'sync-error']);
    });
  });

  it('the same failure is published once until a sync goes through; a different one again', () => {
    const d = new FailureDedup();
    const blocked = (detail: string) => ({ kind: 'sync-blocked', detail });
    expect(d.pass(blocked('src/a.ts:3 rule secret (brain-2026-10-12T10-00-00-000Z)'))).toBe(true);
    expect(d.pass(blocked('src/a.ts:3 rule secret (brain-2026-10-12T11-30-00-000Z)'))).toBe(false); // only the run id changed
    expect(d.pass(blocked('src/a.ts:3  rule secret\n(brain-x)'))).toBe(false);
    expect(d.pass(blocked('src/b.ts:9 rule secret'))).toBe(true);                           // another finding
    expect(d.pass({ kind: 'sync-error', detail: 'src/b.ts:9 rule secret' })).toBe(true);    // another kind
    expect(d.pass({ kind: 'sync-ok', detail: '' })).toBe(true);                             // resolved
    expect(d.pass({ kind: 'sync-error', detail: 'src/b.ts:9 rule secret' })).toBe(true);    // back again: once more
    expect(failureSignature({ kind: 'sync-error', detail: 'at 2026-10-12 10:00:01 x' })).toBe('sync-error|at <time> x');
  });
});
