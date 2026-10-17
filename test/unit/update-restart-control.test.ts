// IPC failure injection: cancellation succeeds only after actual worker stop and supervisor exit.
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mock.spawn }));
import { prepareUpdateRestart } from '../../src/main/update/restart';
const resolveWindows = path.win32.resolve;

beforeEach(() => {
  // This file exercises the Windows IPC protocol with inert children on every host.
  vi.stubGlobal('process', { ...process, platform: 'win32' });
  vi.stubEnv('SystemRoot', 'C:/Windows');
  vi.spyOn(path, 'resolve').mockImplementation((...parts: string[]) => resolveWindows(...parts));
  vi.spyOn(fs.realpathSync, 'native').mockImplementation(file => resolveWindows(String(file)));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); mock.spawn.mockReset(); });
function child() {
  const p = Object.assign(new EventEmitter(), { pid: 34567, connected: true, channel: { unref: vi.fn() }, unref: vi.fn(), send: vi.fn() });
  mock.spawn.mockReturnValue(p);
  return p;
}
const input = () => ({ base: 'C:/second-brain-fixture', pid: process.pid });

it.each(['darwin', 'linux'])('refuses the unsupported %s host before spawning a supervisor', async platform => {
  vi.stubGlobal('process', { ...process, platform });
  await expect(prepareUpdateRestart(input())).rejects.toThrow('Windows corrente');
  expect(mock.spawn).not.toHaveBeenCalled();
});

it('the exact supervisor recognizes real CRLF, keeps its worker on disconnect, and ACKs only after worker close', () => {
  const source = fs.readFileSync(new URL('../../src/main/update/restart.ts', import.meta.url), 'utf8');
  const start = source.indexOf('`', source.indexOf('const supervisor = String.raw')) + 1;
  const script = source.slice(start, source.indexOf('`;', start));
  const worker = Object.assign(new EventEmitter(), { pid: 45678, stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
  const supervisor = Object.assign(new EventEmitter(), { connected: true, env: {}, send: vi.fn((_message: unknown, callback: () => void) => callback()), disconnect: vi.fn() });
  const spawn = vi.fn(() => worker);
  vm.runInNewContext(script, { require: () => ({ spawn }), process: supervisor });
  worker.stdout.write('SB_RESTART_READY\r\n');
  expect(supervisor.send).toHaveBeenCalledWith({ type: 'ready', workerPid: 45678 }, expect.any(Function));
  supervisor.emit('disconnect');
  expect(worker.kill).not.toHaveBeenCalled();
  supervisor.emit('message', { type: 'cancel' });
  expect(worker.kill).toHaveBeenCalledOnce();
  expect(supervisor.send).not.toHaveBeenCalledWith({ type: 'stopped' }, expect.any(Function));
  worker.emit('close', 0);
  expect(supervisor.send).toHaveBeenCalledWith({ type: 'stopped' }, expect.any(Function));
  expect(supervisor.disconnect).toHaveBeenCalledOnce();
});

it('waits for READY and detaches Node supervisor with no parent stdio or Node preloads', async () => {
  const p = child();
  const preparing = prepareUpdateRestart(input());
  p.emit('message', { type: 'ready', workerPid: 45678 });
  const handoff = await preparing;
  expect(mock.spawn).toHaveBeenCalledWith(process.execPath, ['-e', expect.any(String)], expect.objectContaining({ detached: true, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: expect.objectContaining({ ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: undefined, NODE_PATH: undefined }) }));
  expect(p.channel.unref).toHaveBeenCalledOnce();
  p.send.mockImplementation(() => { p.emit('message', { type: 'stopped' }); p.emit('close', 0); });
  await handoff.cancel();
  await handoff.cancel();
  expect(p.send).toHaveBeenCalledOnce();
});

it('rejects supervisor close without worker-stop acknowledgement', async () => {
  const p = child();
  const preparing = prepareUpdateRestart(input());
  p.emit('message', { type: 'ready', workerPid: 45678 });
  const handoff = await preparing;
  p.send.mockImplementation(() => { p.emit('close', 0); });
  await expect(handoff.cancel()).rejects.toThrow('waiter');
});

it('keeps cancellation blocked when supervisor never confirms close', async () => {
  vi.useFakeTimers();
  const p = child();
  const preparing = prepareUpdateRestart(input());
  p.emit('message', { type: 'ready', workerPid: 45678 });
  const handoff = await preparing;
  const cancelled = expect(handoff.cancel()).rejects.toThrow('aggiornamento bloccato');
  await vi.advanceTimersByTimeAsync(5000);
  await cancelled;
});

it('rejects readiness failure after confirmed worker stop without leaving a cancellation wait', async () => {
  const p = child();
  const preparing = prepareUpdateRestart(input());
  p.emit('message', { type: 'stopped' });
  p.emit('close', 1);
  await expect(preparing).rejects.toThrow('prima della conferma');
});
