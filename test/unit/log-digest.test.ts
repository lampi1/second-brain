// The logs' daily digest (ADR 0192, main/log-digest.ts) and the logger's correlation fields: a finished day becomes one
// bounded line (levels, groups, stalls, interface errors, journal kinds), written once, rotated at 90 days; the logger
// fills `run` from the chat, writes `op`/`step`, deletes old raw files only after the digest and never a digest file;
// `npm run logs -- --run` filters by run.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DIGEST_LINE_MAX, digestDay, groupKey, openDay, readDigest, updateDigest } from '../../src/main/log-digest';
import { log } from '../../src/main/log';

const dirs: string[] = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-digest-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); log.correlate(null); });

const NOW = Date.parse('2026-10-29T12:00:00Z');
const line = (o: Record<string, unknown>) => JSON.stringify({ t: '2026-10-28T10:00:00Z', ...o });
function setup() {
  const root = tmp(), logs = path.join(root, 'logs'), act = path.join(root, 'activity');
  fs.mkdirSync(logs); fs.mkdirSync(act);
  fs.writeFileSync(path.join(logs, 'app-2026-10-28.jsonl'), [
    line({ lvl: 'info', scope: 'chats', msg: 'turn done', run: 'r1' }), line({ lvl: 'info', scope: 'chats', msg: 'turn done', run: 'r2' }),
    line({ lvl: 'debug', scope: 'x', msg: 'noise' }),
    line({ lvl: 'warn', scope: 'chats', msg: 'pid 12 died', cause: 'code 1' }), line({ lvl: 'warn', scope: 'chats', msg: 'pid 99 died', cause: 'code 2' }),
    line({ lvl: 'warn', scope: 'perf', msg: 'main process blocked', cause: 'the window froze 300 ms', data: { ms: 300, sinceLast: 4, worstSinceLast: 900 } }),
    line({ lvl: 'warn', scope: 'perf', msg: 'input lag', data: { p95: 200 } }),
    line({ lvl: 'error', scope: 'renderer', msg: 'x is undefined', cause: 'a React component threw' }),
    line({ lvl: 'error', scope: 'renderer', msg: 'x is undefined', cause: 'a React component threw' }),
    'not json',
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(act, 'log-2026-10-28.jsonl'), [
    JSON.stringify({ id: 'a', at: 1, kind: 'task', level: 'info', title: 't' }), JSON.stringify({ id: 'b', at: 2, kind: 'task', level: 'error', title: 't' }),
    JSON.stringify({ id: 'c', at: 3, kind: 'pulse', level: 'warn', title: 't' }),
  ].join('\n') + '\n');
  return { root, logs, act };
}

describe('digestDay', () => {
  it('counts levels, groups, runs, stalls, interface errors and journal kinds', async () => {
    const { logs, act } = setup();
    const d = await digestDay(logs, act, '2026-10-28');
    expect(d.levels).toEqual({ debug: 1, info: 2, warn: 4, error: 2 });
    expect(d.runs).toBe(2);
    expect(d.perf).toEqual({ stalls: 5, maxMs: 900, slowTyping: 1 });
    expect(d.ui).toEqual({ errors: 2, groups: [{ key: groupKey('renderer', 'x is undefined', 'a React component threw'), msg: 'x is undefined', count: 2 }] });
    expect(d.journal).toEqual({ events: 3, kinds: { task: 2, pulse: 1 }, warn: 1, error: 1 });
    // errors first, numbers folded into one group, info groups after the warnings
    expect(d.groups[0]).toMatchObject({ scope: 'renderer', lvl: 'error', count: 2 });
    expect(d.groups.find(g => g.msg.startsWith('pid'))).toMatchObject({ key: 'chats | pid N died | code N', count: 2 });
    expect(d.groups.at(-1)).toMatchObject({ lvl: 'info', msg: 'turn done', count: 2 });
  });

  it('stays under the line cap with many groups', async () => {
    const { logs } = setup();
    const many = Array.from({ length: 500 }, (_, i) => line({ lvl: 'warn', scope: `s${'x'.repeat(i % 7)}`, msg: `${'m'.repeat(150)} ${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26) % 26)}`, cause: 'c'.repeat(290) }));
    fs.writeFileSync(path.join(logs, 'app-2026-10-27.jsonl'), many.join('\n'));
    const d = await digestDay(logs, null, '2026-10-27');
    expect(JSON.stringify(d).length).toBeLessThanOrEqual(DIGEST_LINE_MAX);
    expect(d.more).toBeGreaterThan(0);
    expect(d.journal).toBeNull();
  });
});

describe('updateDigest', () => {
  it('writes each finished day once, never today, and rotates months past 90 days', async () => {
    const { logs, act } = setup();
    fs.writeFileSync(path.join(logs, `app-${openDay(NOW)}.jsonl`), line({ lvl: 'info', scope: 'a', msg: 'today' }));
    fs.writeFileSync(path.join(logs, 'digest-2026-05.jsonl'), `${JSON.stringify({ day: '2026-05-02', v: 1, groups: [] })}\n`);
    expect(await updateDigest(logs, act, NOW)).toEqual(['2026-10-28']);
    expect(await updateDigest(logs, act, NOW)).toEqual([]);
    expect(fs.existsSync(path.join(logs, 'digest-2026-05.jsonl'))).toBe(false);
    const days = readDigest(logs, NOW);
    expect(days.map(d => d.day)).toEqual(['2026-10-28']);
    // a digest day older than 90 days is never read back
    fs.appendFileSync(path.join(logs, 'digest-2026-07.jsonl'), `${JSON.stringify({ day: '2026-07-01', v: 1, groups: [] })}\n`);
    expect(readDigest(logs, NOW).map(d => d.day)).toEqual(['2026-10-28']);
  });
});

describe('logger correlation and housekeeping', () => {
  it('fills run from the chat, writes op and step, and logs.mjs filters by --run', () => {
    const dir = tmp();
    log.init(dir);
    log.correlate(chat => (chat === 'c1' ? 'run-1' : undefined));
    log.info('chats', 'turn done', { chat: 'c1', op: 'invoke_agent' });
    log.info('chats', 'can_use_tool', { chat: 'c1', op: 'execute_tool', step: 'toolu_1' });
    log.info('chats', 'other chat', { chat: 'c2' });
    log.info('chats', 'explicit', { chat: 'c1', run: 'run-x' });
    expect(log.recent.slice(-4).map(e => [e.run, e.op, e.step])).toEqual([['run-1', 'invoke_agent', undefined], ['run-1', 'execute_tool', 'toolu_1'], [undefined, undefined, undefined], ['run-x', undefined, undefined]]);
    const out = execFileSync(process.execPath, ['scripts/logs.mjs', '--dir', path.join(dir, 'logs'), '--run', 'run-1', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    expect(out.trim().split('\n').map(l => (JSON.parse(l) as { msg: string }).msg)).toEqual(['turn done', 'can_use_tool']);
  });

  it('digests the old raw files before deleting them and keeps the digest files', async () => {
    // relative to the real clock: init's own housekeeping runs with it
    const now = Date.now(), ymd = (ago: number) => new Date(now - ago * 864e5).toISOString().slice(0, 10);
    const root = tmp(), logs = path.join(root, 'logs');
    fs.mkdirSync(logs);
    const old = path.join(logs, `app-${ymd(20)}.jsonl`), month = path.join(logs, `digest-${ymd(40).slice(0, 7)}.jsonl`);
    fs.writeFileSync(old, line({ t: `${ymd(20)}T10:00:00Z`, lvl: 'warn', scope: 'a', msg: 'old' }));
    fs.writeFileSync(month, '');
    const past = new Date(now - 20 * 864e5);
    fs.utimesSync(old, past, past); fs.utimesSync(month, past, past);
    log.init(root);
    await log.housekeep(now);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(month)).toBe(true);
    expect(readDigest(logs, now).map(d => d.day)).toEqual([ymd(20)]);
    expect(readDigest(logs, now)[0]!.levels.warn).toBe(1);
  });
});
