// Exercises procfs collection with a delayed clock-frequency command: creation times must use uptime's own sample.
// Mocked I/O also verifies that missing namespace identity makes the reaper fail closed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ChildProcess from 'node:child_process';
import { listLinuxProcesses } from '../../../src/main/chats/linux-procs';

const io = vi.hoisted(() => ({ readFile: vi.fn(), readdir: vi.fn(), stat: vi.fn(), readlink: vi.fn(), execFile: vi.fn() }));
vi.mock('node:fs/promises', () => ({ default: io }));
vi.mock('node:child_process', async original => ({ ...await original<typeof ChildProcess>(), execFile: io.execFile }));
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });

describe('Linux procfs collection', () => {
  it('does not shift process creation times when getconf finishes after the uptime sample', async () => {
    let now = 20000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    let finish: ((err: Error | null, stdout: string) => void) | undefined;
    io.execFile.mockImplementation((_cmd, _args, _opts, callback: typeof finish) => { finish = callback; });
    io.readdir.mockResolvedValue(['1000']);
    io.stat.mockResolvedValue({ dev: 4, ino: 123 });
    io.readlink.mockResolvedValue('/usr/bin/node');
    const fields = Array<string>(19).fill('0'); fields[1] = '1000'; fields[18] = '500';
    io.readFile.mockImplementation((file: string) => Promise.resolve(file.endsWith('/uptime') ? '10.00 0.00'
      : file.endsWith('/stat') ? `1000 (node) S ${fields.join(' ')}`
        : `NSpid:\t1000\t${process.pid}\nNSpgid:\t1000\t${process.pid}\n`));
    const listed = listLinuxProcesses();
    await vi.waitFor(() => expect(clock).toHaveBeenCalled());
    now = 24000;
    finish!(null, '100\n');
    expect(await listed).toEqual([{ pid: process.pid, ppid: 0, created: 15000, name: 'node' }]);
  });

  it('returns no process list when its namespace identity cannot be read', async () => {
    io.readFile.mockResolvedValue('');
    io.readdir.mockResolvedValue([]);
    io.readlink.mockResolvedValue('/usr/bin/node');
    io.stat.mockRejectedValue(new Error('namespace inaccessible'));
    io.execFile.mockImplementation((_cmd, _args, _opts, callback: (err: Error | null, stdout: string) => void) => callback(null, '100'));
    expect(await listLinuxProcesses()).toBeNull();
  });
});
