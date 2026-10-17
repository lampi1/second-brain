// Native ZIP extraction uses only tiny local fixture archives, never network/app/runtime payloads or user data.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { extractUpdateZip } from '../../src/main/update/extract';
import { fixtureZip } from './zip-fixture';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture(bytes: Buffer) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-zip-')); roots.push(root);
  const archive = path.join(root, 'input.zip'), payload = path.join(root, 'payload');
  fs.writeFileSync(archive, bytes); fs.mkdirSync(payload);
  return { root, archive, payload };
}
describe.skipIf(process.platform !== 'win32')('native bounded ZIP extraction', () => {
  it('extracts regular stored/deflated files and dotfiles literally', async () => {
    const f = fixture(fixtureZip([{ name: 'release.mjs', data: 'stored' }, { name: 'releases/a/.claude/AGENTS.md', data: 'deflated '.repeat(20), deflate: true }]));
    await extractUpdateZip(f.archive, f.payload);
    expect(fs.readFileSync(path.join(f.payload, 'release.mjs'), 'utf8')).toBe('stored');
    expect(fs.readFileSync(path.join(f.payload, 'releases/a/.claude/AGENTS.md'), 'utf8')).toBe('deflated '.repeat(20));
  });
  it.each(['../outside.txt', '/outside.txt', 'C:/outside.txt', 'safe\\..\\outside.txt', '\\outside.txt', 'safe/../outside.txt', 'safe//x', 'NUL.txt', 'safe/file:stream', 'safe/trailing.'])('rejects %s before writing any entry', async name => {
    const f = fixture(fixtureZip([{ name: 'good.txt', data: 'must not be written' }, { name, data: 'bad' }]));
    await expect(extractUpdateZip(f.archive, f.payload)).rejects.toThrow();
    expect(fs.readdirSync(f.payload)).toEqual([]);
    expect(fs.existsSync(path.join(f.root, 'outside.txt'))).toBe(false);
  });
  it.each(['case', 'slash-alias', 'link', 'file-parent', 'size'])('rejects unsafe %s metadata before any writes', async kind => {
    const entries = kind === 'case' ? [{ name: 'A.txt' }, { name: 'a.TXT' }] : kind === 'slash-alias' ? [{ name: 'a/b' }, { name: 'a\\b' }] : kind === 'link' ? [{ name: 'linked', mode: 0xa1ff, data: '../outside' }] : kind === 'file-parent' ? [{ name: 'parent/child' }, { name: 'parent', data: 'file' }] : [{ name: 'too-large', length: 536870913 }];
    const f = fixture(fixtureZip([{ name: 'good.txt', data: 'no writes' }, ...entries]));
    await expect(extractUpdateZip(f.archive, f.payload)).rejects.toThrow();
    expect(fs.readdirSync(f.payload)).toEqual([]);
  });
  it('rejects nonempty and linked extraction roots without overwriting anything', async () => {
    const f = fixture(fixtureZip([{ name: 'keep.txt', data: 'replace' }]));
    fs.writeFileSync(path.join(f.payload, 'keep.txt'), 'keep');
    await expect(extractUpdateZip(f.archive, f.payload)).rejects.toThrow();
    expect(fs.readFileSync(path.join(f.payload, 'keep.txt'), 'utf8')).toBe('keep');
    const alias = path.join(f.root, 'alias'); fs.symlinkSync(f.payload, alias, 'junction');
    await expect(extractUpdateZip(f.archive, alias)).rejects.toThrow();
    expect(fs.readFileSync(path.join(f.payload, 'keep.txt'), 'utf8')).toBe('keep');
  });
  it('round-trips the real producer script and its native Compress-Archive path/type metadata', async () => {
    const f = fixture(Buffer.alloc(0)), source = path.join(f.root, 'source');
    const names = ['release.mjs', 'update.mjs', 'icon.ico', 'LICENSE', 'payload.json', 'releases/a/brain-template/.claude/AGENTS.md', 'electron/1.0.0/electron.exe', 'engines/claude/1.0.0/claude.exe'];
    for (const name of names) { const file = path.join(source, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `fixture ${name}`); }
    fs.unlinkSync(f.archive);
    // The trusted producer script itself, not a second archive implementation. Only the two literal env paths vary.
    const script = fs.readFileSync(path.resolve(import.meta.dirname, '../../scripts/zip-payload.ps1'), 'utf8');
    execFileSync(path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `& {\n${script}\n} -PayloadRoot $env:SB_ZIP_SOURCE -Output $env:SB_ZIP_OUTPUT`], { shell: false, windowsHide: true, timeout: 15000, env: { ...process.env, SB_ZIP_SOURCE: source, SB_ZIP_OUTPUT: f.archive } });
    await extractUpdateZip(f.archive, f.payload);
    for (const name of names) expect(fs.readFileSync(path.join(f.payload, name), 'utf8')).toBe(`fixture ${name}`);
  });
  it('cancels before extraction without writing entries', async () => {
    const f = fixture(fixtureZip([{ name: 'entry.txt', data: 'fixture' }])), controller = new AbortController(); controller.abort();
    await expect(extractUpdateZip(f.archive, f.payload, controller.signal)).rejects.toThrow();
    expect(fs.readdirSync(f.payload)).toEqual([]);
  });
});
