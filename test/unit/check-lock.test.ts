// Real subprocess checks for the cross-worktree mutex: serialization, queue-only timeout and dead-owner recovery.
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';

const children: ChildProcess[] = [];
const dirs: string[] = [];
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-lock-'));
  dirs.push(dir);
  return path.join(dir, 'owner.json');
}
function worker(file: string, wait?: number) {
  const child = fork(path.resolve('test/fixtures/check-lock-worker.mjs'), [file, ...(wait === undefined ? [] : [String(wait)])], { silent: true });
  children.push(child);
  return child;
}
afterEach(async () => {
  await Promise.all(children.splice(0).map(async child => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }));
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

it('queues a simultaneous execution until its owner releases', async () => {
  const file = fixture();
  const a = worker(file);
  expect((await once(a, 'message'))[0]).toBe('acquired');
  const b = worker(file);
  expect((await once(b, 'message'))[0]).toBe('waiting');
  expect(JSON.parse(fs.readFileSync(file, 'utf8')).pid).toBe(a.pid);
  const acquired = once(b, 'message');
  a.send('release');
  expect((await acquired)[0]).toBe('acquired');
  expect(JSON.parse(fs.readFileSync(file, 'utf8')).pid).toBe(b.pid);
});

it('recovers a stale file after its actual owner dies', async () => {
  const file = fixture();
  const a = worker(file);
  await once(a, 'message');
  const exited = once(a, 'exit');
  a.kill('SIGKILL');
  await exited;
  expect(fs.existsSync(file)).toBe(true);
  const b = worker(file);
  expect((await once(b, 'message'))[0]).toBe('acquired');
  expect(JSON.parse(fs.readFileSync(file, 'utf8')).pid).toBe(b.pid);
});

it('times out only the waiter without disturbing the owner', async () => {
  const file = fixture();
  const a = worker(file);
  await once(a, 'message');
  const b = worker(file, 0);
  expect((await once(b, 'exit'))[0]).toBe(1);
  expect(JSON.parse(fs.readFileSync(file, 'utf8')).pid).toBe(a.pid);
});
