// The maintenance pack's sections about the period since the previous pass (ADR 0192): journal kinds and notable events,
// window stalls, interface errors with the log step's sample, one digest line per day (the days whose raw logs are
// gone included); the research serves them through maintenance_pack; the log step counts a deleted day from the digest.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { LogEvent } from '../../../src/shared/activity-log';
import type { BrainModelState } from '../../../src/shared/brain-model';
import type { ChatSummary } from '../../../src/shared/contract';
import { groupKey, type DigestDay } from '../../../src/main/log-digest';
import { logSections, periodDays } from '../../../src/main/brainmodel/research-pack-logs';
import { buildPack, PACK_SECTIONS } from '../../../src/main/brainmodel/research-pack';
import { scanLogs } from '../../../src/main/brainmodel/log-scan';
import { researchTools } from '../../../src/main/brainmodel/research-tools';
import { ResearchService } from '../../../src/main/brainmodel/research';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-packlogs-')); dirs.push(d); return d; };

const NOW = Date.parse('2026-10-29T12:00:00Z'), DAY = 864e5;
const uiKey = groupKey('renderer', 'x is undefined', 'a React component threw');
const day = (d: string, over: Partial<DigestDay> = {}): DigestDay => ({
  day: d, v: 1, levels: { debug: 0, info: 10, warn: 2, error: 1 }, runs: 3,
  groups: [{ key: 'chats | pid N died | code N', lvl: 'warn', scope: 'chats', msg: 'pid 1 died', cause: 'code 1', count: 2 },
    { key: groupKey('perf', 'main process blocked', 'the window froze 300 ms'), lvl: 'warn', scope: 'perf', msg: 'main process blocked', cause: 'the window froze 300 ms', count: 1 }],
  perf: { stalls: 4, maxMs: 800, slowTyping: 1 }, ui: { errors: 1, groups: [{ key: uiKey, msg: 'x is undefined', count: 1 }] },
  journal: { events: 5, kinds: { task: 4, error: 1 }, warn: 0, error: 1 }, ...over,
});
const ev = (at: number, over: Partial<LogEvent>): LogEvent => ({ id: String(at), at, kind: 'task', level: 'info', title: 'step', ...over });

describe('logSections', () => {
  it('summarizes journal, perf, interface errors and the digest of the period', () => {
    const s = logSections({
      now: NOW, since: NOW - 21 * DAY, days: [day('2026-10-08'), day('2026-10-28', { journal: null })],
      events: [ev(NOW - 22 * DAY, { level: 'error', title: 'before the period' }), ev(NOW - DAY, { level: 'error', title: 'engine crashed', runId: 'r9', error: 'exit 1' }), ev(NOW - 2 * DAY, { title: 'fine' }), ev(NOW - 3 * DAY, { verdict: 'fail', title: 'job failed' })],
      groups: [{ key: uiKey, lvl: 'error', scope: 'renderer', msg: 'x is undefined', cause: 'a React component threw', count: 2, sample: '{"stack":"at MemoryPage"}' }],
    });
    expect(s.journal).toContain('task 4, error 1');
    expect(s.journal).toContain('engine crashed');
    expect(s.journal).toContain('run r9');
    expect(s.journal).toContain('job failed');
    expect(s.journal).not.toContain('before the period');
    expect(s.journal).not.toContain('fine');
    expect(s.perf).toContain('Total: 8 stalls, worst 800 ms; slow-typing minutes 2.');
    expect(s.perf).toContain('the window froze 300 ms');
    expect(s['ui-errors']).toContain('x is undefined ×2 on 2 days');
    expect(s['ui-errors']).toContain(`key: ${uiKey}`);
    expect(s['ui-errors']).toContain('at MemoryPage');
    expect(s.digest).toContain('- 2026-10-08 · 10/2/1 · 3 · 4 (800) · 1 · 5 · chats: pid 1 died ×2');
    expect(s.digest).toContain('- 2026-10-28 · 10/2/1 · 3 · 4 (800) · 1 · —');
  });
});

describe('periodDays and the log step', () => {
  it('takes the digest days of the period plus today summarized on the fly; the log step counts deleted days from the digest', async () => {
    const logs = tmp();
    fs.writeFileSync(path.join(logs, 'digest-2026-10.jsonl'), [day('2026-10-01'), day('2026-10-10')].map(d => JSON.stringify(d)).join('\n') + '\n');
    fs.writeFileSync(path.join(logs, 'app-2026-10-29.jsonl'), JSON.stringify({ t: '2026-10-29T09:00:00Z', lvl: 'error', scope: 'renderer', msg: 'today' }) + '\n');
    const days = await periodDays(logs, null, NOW - 21 * DAY, NOW);
    expect(days.map(d => d.day)).toEqual(['2026-10-10', '2026-10-29']);
    expect(days[1]!.ui.errors).toBe(1);
    const scan = scanLogs(logs, NOW - 21 * DAY, new Set(), NOW);
    expect(scan.groups.find(g => g.key === 'chats | pid N died | code N')).toMatchObject({ count: 2, sample: expect.stringContaining('daily digest of 2026-10-10') });
    expect(scan.groups.find(g => g.msg === 'today')).toMatchObject({ count: 1, lvl: 'error' });
  });
});

describe('the pack and its tool', () => {
  const state = (since: number | null): BrainModelState => ({ root: '/brain', agents: [], skills: [], rules: [], memory: [], changes: [], migration: null,
    lastRun: { at: NOW, jobs: [], ...(since !== null ? { logs: { since, files: [], groups: [] } } : {}) } } as BrainModelState);

  it('has the four new sections (and never the other worker\'s here) in the pack and the tool enum', () => {
    expect(PACK_SECTIONS).toEqual(expect.arrayContaining(['journal', 'perf', 'ui-errors', 'digest']));
    const pack = buildPack({ now: NOW, runs: [], state: state(null), roles: [], past: [], appVersion: '1' });
    for (const s of ['journal', 'perf', 'ui-errors', 'digest'] as const) expect(pack[s]).toContain('Not available');
    expect(pack.summary).toContain('ui-errors (interface errors)');
    const tool = researchTools({ pack: () => '', propose: () => ({ id: '', left: {} }) })[0]!;
    expect((tool.inputSchema as { properties: { section: { enum: string[] } } }).properties.section.enum).toEqual([...PACK_SECTIONS]);
  });

  it('the research reads them from the logs folder for the period since the previous pass', async () => {
    const userData = tmp(), logs = path.join(userData, 'logs');
    fs.mkdirSync(logs);
    fs.writeFileSync(path.join(logs, 'digest-2026-10.jsonl'), `${JSON.stringify(day('2026-10-12'))}\n`);
    const svc = new ResearchService({
      userData, lang: () => 'it', root: () => '/brain', appVersion: () => '1', issuesUrl: () => null,
      engines: () => [{ harness: 'claude', label: 'Claude', web: true, effort: true }], bestModel: () => null, runs: () => [], roles: () => [],
      brain: { state: () => state(NOW - 20 * DAY), apply: () => '', noise: () => {}, maintain: async () => state(NOW - 20 * DAY) },
      chats: { create: async () => ({ id: 'c1', state: 'starting', costUsd: 0 } as ChatSummary), get: () => undefined, stop: async () => {} },
      changed: () => {}, now: () => NOW, logDir: () => logs, events: () => [ev(NOW - DAY, { level: 'warn', title: 'slow engine' })],
    });
    await svc.start({ harness: 'claude', model: null, effort: null, web: false, capUsd: 5, prompt: 'p' });
    expect(svc.pack('c1', 'digest')).toContain('- 2026-10-12');
    expect(svc.pack('c1', 'journal')).toContain('slow engine');
    expect(svc.pack('c1', 'perf')).toContain('Total: 4 stalls');
    expect(svc.pack('c1', 'ui-errors')).toContain('x is undefined');
  });
});
