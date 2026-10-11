import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { globToRegExp, outcomeEvent, ProductSync } from '../../src/main/sync';
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
});
