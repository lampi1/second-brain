// The renderer's OS check (renderer/lib/host-os.ts): only Windows names PowerShell on screen.
import { expect, it } from 'vitest';
import { hostIsWindows } from '../../src/renderer/lib/host-os';

it('Windows by Chromium\'s navigator.platform; macOS, Linux and an unknown value are not', () => {
  expect(hostIsWindows('Win32')).toBe(true);
  expect(hostIsWindows('MacIntel')).toBe(false);
  expect(hostIsWindows('Linux x86_64')).toBe(false);
  expect(hostIsWindows('')).toBe(false);
});
