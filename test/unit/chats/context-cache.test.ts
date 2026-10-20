// The prompt cache counted per kind of chat (chats/context-stats.ts ContextStats.cache, token plan 2026-10-20): read,
// written and uncached tokens of every call, and of each session's first call (did a new session find its prefix
// cached?); kept across a restart.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ContextCounters } from '../../../src/main/chats/context-stats';

const roots: string[] = [];
afterEach(() => { for (const d of roots.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('ContextCounters cache', () => {
  it('sums read, write and input per kind, and the first calls apart', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-cc-')); roots.push(dir);
    const c = new ContextCounters(dir);
    c.call('a', { context: 40_000, cacheWrite: 38_000, cacheRead: 0, input: 2_000, usd: 0.3 }, null, { kind: 'root', first: true });
    c.call('a', { context: 41_000, cacheWrite: 1_000, cacheRead: 39_000, input: 1_000, usd: 0.02 }, null, { kind: 'root', first: false });
    c.call('o', { context: 90_000, cacheWrite: 0, cacheRead: 89_000, input: 1_000, usd: 0.02 }, null, { kind: 'orchestrator', first: false });
    const s = c.snapshot().cache!;
    expect(s.root).toEqual({ calls: 2, read: 39_000, write: 39_000, input: 3_000, firstCalls: 1, firstRead: 0, firstWrite: 38_000 });
    expect(s.orchestrator.read).toBe(89_000);
    expect(s.child.calls).toBe(0);
    c.flush();
    expect(new ContextCounters(dir).snapshot().cache!.root.firstWrite).toBe(38_000);
  });
});
