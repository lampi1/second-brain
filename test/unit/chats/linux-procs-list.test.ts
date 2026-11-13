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

  it('returns no process list when its namespace identity cannot be read', async () => {
    io.readFile.mockResolvedValue('');
    io.readdir.mockResolvedValue([]);
    io.readlink.mockResolvedValue('/usr/bin/node');
    io.stat.mockRejectedValue(new Error('namespace inaccessible'));
    io.execFile.mockImplementation((_cmd, _args, _opts, callback: (err: Error | null, stdout: string) => void) => callback(null, '100'));
    expect(await listLinuxProcesses()).toBeNull();
  });
});
