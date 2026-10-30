// The morning block's service (src/main/morning/service.ts, ADR 0102): the presence survives a restart, the block needs
// a history and stays off in the test suites unless SB_MORNING=1, Esc / Ok hides it for the day, and the brain's ideas
// and spend come from its data server (cached) with the runs as the spend's fallback.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentRun } from '../../../src/shared/agents';
import { MorningService, type MorningDeps } from '../../../src/main/morning/service';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const T = new Date(2026, 9, 20, 8, 30).getTime(), H = 3600_000;
const run = (p: Partial<AgentRun>): AgentRun => ({ runId: 'r1', chatId: 'c1', agentId: 'artisan', version: 1, goal: 'Fix login', startedBy: 'orchestrator', startedAt: T - 15 * H, endedAt: T - 14 * H,
  counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null }, costUsd: 2, tokens: null, ...p });

function make(p: Partial<MorningDeps> = {}, clock = { now: T }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-morning-')); dirs.push(dir);
  const api = vi.fn(async (q: string) => q.startsWith('/api/tables') ? { ok: true as const, data: { ideas: [{ titolo: 'Riprendi', stato: 'aperta', scaduta: '2026-10-19' }] } } : { ok: false as const, error: 'no' });
  const deps: MorningDeps = { file: path.join(dir, 'morning.json'), chats: () => [], runs: () => [run({})], pending: () => 1, approvals: () => 2, tasks: () => null, changes: () => [],
    api, stallMin: () => 10, now: () => clock.now, env: {}, ...p };
  return { deps, api, clock, service: new MorningService(deps) };
}

describe('MorningService', () => {
  it('opens on the first presence with a history, gathers the brief, and Ok hides it for the day', async () => {
    const m = make();
    const st = await m.service.handle({ op: 'presence' });
    expect(st).toMatchObject({ history: true, show: true });
    expect(st.brief).toMatchObject({ pending: 1, approvals: 2, ideas: [{ title: 'Riprendi', due: '2026-10-19' }] });
    expect(st.brief?.runs.map(r => r.runId)).toEqual(['r1']);
    expect(st.brief?.spendYesterdayUsd).toBe(2); // no cost report: the runs started yesterday
    expect((await m.service.handle({ op: 'dismiss' })).show).toBe(false);
    m.clock.now = T + 5 * H;
    expect((await m.service.handle({ op: 'presence' })).show).toBe(false);
    // Ctrl+J still gets the brief
    expect((await m.service.handle({ op: 'get' })).brief?.pending).toBe(1);
    // a restart keeps the dismissal
    expect((await new MorningService(m.deps).handle({ op: 'presence' })).show).toBe(false);
  });
  it('a new user (no run, no work chat) keeps the first-run text', async () => {
    const m = make({ runs: () => [] });
    expect(await m.service.handle({ op: 'presence' })).toEqual({ history: false, show: false, brief: null });
  });
  it('off in the test suites unless SB_MORNING=1', async () => {
    expect((await make({ env: { SB_TEST: '1' } }).service.handle({ op: 'presence' })).show).toBe(false);
    expect((await make({ env: { SB_TEST: '1', SB_MORNING: '1' } }).service.handle({ op: 'presence' })).show).toBe(true);
  });
  it('the ideas read is cached for a few minutes', async () => {
    const m = make();
    await m.service.handle({ op: 'presence' });
    await m.service.handle({ op: 'presence' });
    expect(m.api.mock.calls.filter(c => String(c[0]).startsWith('/api/tables'))).toHaveLength(1);
  });
});
