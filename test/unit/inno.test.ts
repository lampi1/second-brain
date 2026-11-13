// Packaging must verify the full compiler engine version, not the major-only help banner. No downloads or setup.
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ spawnSync: vi.fn() }));
vi.mock('node:child_process', () => ({ spawnSync: mocks.spawnSync }));
// @ts-expect-error plain .mjs script without types
import { verifyCompiler } from '../../scripts/inno.mjs';

beforeEach(() => mocks.spawnSync.mockReset());

it('uses a bounded no-output stdin compilation and accepts the exact engine version', () => {
  mocks.spawnSync.mockReturnValue({ status: 0, stdout: 'Compiler engine version: Inno Setup 6.5.4\r\n', stderr: '' });
  expect(() => verifyCompiler('compiler.exe')).not.toThrow();
  expect(mocks.spawnSync).toHaveBeenCalledWith('compiler.exe', ['/O-', '-'], expect.objectContaining({ input: expect.stringContaining('Output=no'), windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 }));
});

it.each([
  { status: 1, stdout: 'Inno Setup 6 Command-Line Compiler', stderr: 'Usage: iscc' },
  { status: 0, stdout: 'Compiler engine version: Inno Setup 6.5.40\r\n', stderr: '' },
  { status: 0, stdout: 'Compiler engine version: Inno Setup 6.5.3\r\n', stderr: '' },
  { status: 2, stdout: 'Compiler engine version: Inno Setup 6.5.4\r\n', stderr: 'Compile aborted.' },
  { status: null, stdout: '', error: new Error('spawn failed') },
])('rejects failed/help/missing or nonexact engine version: %j', result => {
  mocks.spawnSync.mockReturnValue(result);
  expect(() => verifyCompiler('compiler.exe')).toThrow('expected Inno Setup 6.5.4');
});
