// Unit tests of main/peek-file.ts: which paths a message names are resolved to a local file.
import { describe, expect, it } from 'vitest';
import { resolvePeek } from '../../src/main/peek-file';

describe('resolvePeek: which paths are read', () => {
  it('absolute drive paths, and relative ones inside the chat folder', () => {
    expect(resolvePeek('C:\\x\\a.md', undefined, 'win32')).toBe('C:\\x\\a.md');
    expect(resolvePeek('src/a.ts', 'C:\\repo', 'win32')).toBe('C:\\repo\\src\\a.ts');
  });
  it('never a share, a way out of the folder, another scheme or a relative path without a folder', () => {
    expect(resolvePeek('\\\\host\\share\\a.md', 'C:\\repo', 'win32')).toBeNull();
    expect(resolvePeek('../secret.txt', 'C:\\repo', 'win32')).toBeNull();
    expect(resolvePeek('src/../../x.md', 'C:\\repo', 'win32')).toBeNull();
    expect(resolvePeek('/etc/passwd', 'C:\\repo', 'win32')).toBeNull();
    expect(resolvePeek('https://x.example.com/a.md', 'C:\\repo', 'win32')).toBeNull();
    expect(resolvePeek('src/a.ts', undefined, 'win32')).toBeNull();
    expect(resolvePeek('src/a.ts', '\\\\host\\share', 'win32')).toBeNull();
  });
  it('macOS and Linux: /-rooted paths, relative ones inside the chat folder, never a drive path or //host', () => {
    for (const os of ['darwin', 'linux'] as const) {
      expect(resolvePeek('/Users/u/a.md', undefined, os)).toBe('/Users/u/a.md');
      expect(resolvePeek('src/a.ts', '/home/u/repo', os)).toBe('/home/u/repo/src/a.ts');
      expect(resolvePeek('../secret.txt', '/home/u/repo', os)).toBeNull();
      expect(resolvePeek('//host/share/a.md', '/home/u/repo', os)).toBeNull();
      expect(resolvePeek('C:\\x\\a.md', undefined, os)).toBeNull();
      expect(resolvePeek('src/a.ts', 'C:\\repo', os)).toBeNull();
    }
  });
});
