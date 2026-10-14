// Opening a local file from a question's context (src/main/open-path.ts): only absolute local paths (file:/// or a drive
// letter), never a network share; documents open with their app, anything else is only shown in its folder; a missing
// file says so and opens nothing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { localPath, openLocal, type Shell } from '../../src/main/open-path';

const fakeShell = () => {
  const calls: string[] = [];
  const shell: Shell = { openPath: async p => { calls.push(`open ${p}`); return ''; }, showItemInFolder: p => { calls.push(`folder ${p}`); } };
  return { shell, calls };
};

describe('localPath', () => {
  it('file:/// URLs and drive paths; never UNC, file://host, relative or another scheme', () => {
    expect(localPath('file:///C:/rep/tc16.md')).toBe('C:\\rep\\tc16.md');
    expect(localPath('C:/rep/x.md')).toBe('C:\\rep\\x.md');
    expect(localPath('\\\\host\\share\\x.md')).toBeNull();
    expect(localPath('//host/share/x.md')).toBeNull();
    expect(localPath('file://host/share/x.md')).toBeNull();
    expect(localPath('\\\\?\\C:\\x.md')).toBeNull();
    expect(localPath('rep/x.md')).toBeNull();
    expect(localPath('C:\\rep\\evil.exe:a.md')).toBeNull(); // an alternate data stream
    expect(localPath('https://example.com/x.md')).toBeNull();
  });
});

describe('openLocal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-open-'));
  const md = path.join(dir, 'report.md');
  const cmd = path.join(dir, 'tool.cmd');
  fs.writeFileSync(md, '# r');
  fs.writeFileSync(cmd, 'echo hi');
  it('a document opens with its app', async () => {
    const { shell, calls } = fakeShell();
    expect(await openLocal(pathToFileURL(md).href, shell)).toEqual({ how: 'opened' });
    expect(calls).toEqual([`open ${fs.realpathSync.native(md)}`]);
  });
  it('anything Windows would run, or a folder, is only shown in Explorer', async () => {
    const { shell, calls } = fakeShell();
    expect(await openLocal(cmd, shell)).toEqual({ how: 'folder' });
    expect(await openLocal(dir, shell)).toEqual({ how: 'folder' });
    expect(calls.length).toBe(2);
    expect(calls.every(c => c.startsWith('folder '))).toBe(true);
  });
  it('missing or refused: nothing opens, the reason is in Italian', async () => {
    const { shell, calls } = fakeShell();
    expect((await openLocal(path.join(dir, 'nope.md'), shell)).how).toBe('missing');
    expect((await openLocal('\\\\host\\share\\x.md', shell)).how).toBe('refused');
    expect(calls).toEqual([]);
  });
});
