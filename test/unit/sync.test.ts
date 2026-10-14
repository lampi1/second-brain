import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FailureDedup, failureSignature, globToRegExp, outcomeEvent, ProductSync } from '../../src/main/sync';
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
    expect(b?.title).toContain('prodotto nel cervello');
    expect(outcomeEvent({ release: '0.1.0-abc', startedAt: 'x', endedAt: 'y', exitCode: 1, ok: false })?.kind).toBe('sync-error');
  });

  it('a new outcome file is published once; old files are not', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-sync-'));
    fs.mkdirSync(path.join(base, 'sync'));
    fs.writeFileSync(path.join(base, 'sync', 'old.json'), JSON.stringify({ release: 'old', startedAt: 'x', endedAt: 'y', exitCode: 0, ok: true }));
    const got: { kind: string }[] = [];
    const brain = { publish: (e: { kind: string }[]) => got.push(...e) } as unknown as BrainService;
    const s = new ProductSync({ base, brainRoot: () => null, brain, nodeExe: process.execPath });
    s.start();
    fs.writeFileSync(path.join(base, 'sync', '0.1.0-abc.json'), JSON.stringify({ release: '0.1.0-abc', startedAt: 'x', endedAt: 'y', exitCode: 2, ok: false, blocked: true, summary: 'x' }));
    for (let i = 0; i < 40 && !got.length; i++) await new Promise(r => setTimeout(r, 50));
    s.stop();
    expect(got.map(e => e.kind)).toEqual(['sync-blocked']);
  });

  it('a failure still open at start is not published again after a restart; a new one is', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-sync-'));
    fs.mkdirSync(path.join(base, 'sync'));
    const blocked = (release: string, summary: string) => JSON.stringify({ release, startedAt: 'x', endedAt: 'y', exitCode: 2, ok: false, blocked: true, summary });
    fs.writeFileSync(path.join(base, 'sync', 'brain-1.json'), blocked('brain-1', 'src/a.ts:3 rule secret'));
    const got: { kind: string; detail?: string }[] = [];
    const brain = { publish: (e: { kind: string }[]) => got.push(...e) } as unknown as BrainService;
    const s = new ProductSync({ base, brainRoot: () => null, brain, nodeExe: process.execPath });
    s.start();
    fs.writeFileSync(path.join(base, 'sync', 'brain-2.json'), blocked('brain-2', 'src/a.ts:3 rule secret'));
    await new Promise(r => setTimeout(r, 400));
    expect(got).toEqual([]);
    fs.writeFileSync(path.join(base, 'sync', 'brain-3.json'), blocked('brain-3', 'src/b.ts:9 rule secret'));
    for (let i = 0; i < 40 && !got.length; i++) await new Promise(r => setTimeout(r, 50));
    s.stop();
    expect(got.map(e => e.detail)).toEqual(['src/b.ts:9 rule secret']);
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
