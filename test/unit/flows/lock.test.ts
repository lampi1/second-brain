// The routine runner's lock (ADR 0154): one live runner per flow store; a stale or dead holder is taken over.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { RunnerLock } from '../../../src/main/flows/lock';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const file = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-')); dirs.push(dir); return path.join(dir, 'flows', 'runner.lock'); };

it('lets one runner hold the store and hands it over on release', () => {
  const at = file(), a = new RunnerLock(at), b = new RunnerLock(at);
  expect(a.hold()).toBe(true); expect(b.hold()).toBe(false); expect(a.hold()).toBe(true);
  a.release(); expect(fs.existsSync(at)).toBe(false); expect(b.hold()).toBe(true); expect(a.hold()).toBe(false);
});
it('takes over a lock whose heartbeat is older than a minute or whose process is gone', () => {
  let now = 1_000_000;
  const at = file(), a = new RunnerLock(at, () => now), b = new RunnerLock(at, () => now);
  expect(a.hold()).toBe(true); now += 59_000; expect(b.hold()).toBe(false);
  now += 2_000; expect(b.hold()).toBe(true);
  fs.writeFileSync(at, JSON.stringify({ pid: 2 ** 30, at: now, token: 'dead' }));
  expect(a.hold()).toBe(true);
});
