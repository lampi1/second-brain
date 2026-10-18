// Showing a local file in its folder (src/main/open-path.ts): only absolute local paths (file:/// or a drive letter),
// never a network share; nothing is ever opened with its app or run, only selected in Explorer; a missing file says so.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { localPath, showLocal, type Shell } from '../../src/main/open-path';

const fakeShell = () => {
  const calls: string[] = [];
  const shell: Shell = { showItemInFolder: p => { calls.push(`folder ${p}`); } };
  return { shell, calls };
};

describe('localPath', () => {
  it('file:/// URLs and drive paths; never UNC, file://host, relative or another scheme', () => {
    const w = (p: string) => localPath(p, 'win32');
    expect(w('file:///C:/rep/tc16.md')).toBe('C:\\rep\\tc16.md');
    expect(w('C:/rep/x.md')).toBe('C:\\rep\\x.md');
    expect(w('\\\\host\\share\\x.md')).toBeNull();
    expect(w('//host/share/x.md')).toBeNull();
    expect(w('file://host/share/x.md')).toBeNull();
    expect(w('\\\\?\\C:\\x.md')).toBeNull();
    expect(w('rep/x.md')).toBeNull();
    expect(w('C:\\rep\\evil.exe:a.md')).toBeNull(); // an alternate data stream
    expect(w('https://example.com/x.md')).toBeNull();
    expect(w('/Users/u/x.md')).toBeNull();
  });
  it('macOS and Linux: /-rooted paths and file:/// URLs; never //host, file://host, a drive path or relative', () => {
    for (const os of ['darwin', 'linux'] as const) {
      const u = (p: string) => localPath(p, os);
      expect(u('/Users/u/rep/x.md')).toBe('/Users/u/rep/x.md');
      expect(u('/home/u/a/../rep/x.md')).toBe('/home/u/rep/x.md');
      expect(u('file:///home/u/my%20rep/x.md')).toBe('/home/u/my rep/x.md');
      expect(u('//host/share/x.md')).toBeNull();
      expect(u('file://host/share/x.md')).toBeNull();
      expect(u('C:\\rep\\x.md')).toBeNull();
      expect(u('rep/x.md')).toBeNull();
      expect(u('https://example.com/x.md')).toBeNull();
    }
  });
});

describe('showLocal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-open-'));
  const md = path.join(dir, 'report.md');
  const cmd = path.join(dir, 'tool.cmd');
  fs.writeFileSync(md, '# r');
  fs.writeFileSync(cmd, 'echo hi');
  it('a document, a script or a folder is only shown in Explorer, never opened', () => {
    const { shell, calls } = fakeShell();
    expect(showLocal(pathToFileURL(md).href, shell)).toEqual({ how: 'folder' });
    expect(showLocal(cmd, shell)).toEqual({ how: 'folder' });
    expect(showLocal(dir, shell)).toEqual({ how: 'folder' });
    expect(calls).toEqual([md, cmd, dir].map(p => `folder ${fs.realpathSync.native(p)}`));
  });
  it('missing or refused: nothing is shown, the reason is in Italian', () => {
    const { shell, calls } = fakeShell();
    expect(showLocal(path.join(dir, 'nope.md'), shell).how).toBe('missing');
    expect(showLocal('\\\\host\\share\\x.md', shell).how).toBe('refused');
    expect(calls).toEqual([]);
  });
});
