// Background updates verify portable immutable assets and leave active state/data untouched until explicit apply.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without types
import { hashFile, manifestPayload, prepareApply as prepareApplyLocked, withReleaseLock, safePayloadPath, stageUpdate, stagedUpdates } from '../../scripts/update.mjs';

const roots: string[] = [];
const temp = () => { const p = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-update-')); roots.push(p); return p; };
const put = (root: string, name: string, text: string) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const id = '1.0.0-abcdef0';
const prepareApply = (root: string, target: string, expected?: string) => withReleaseLock(root, 'test-apply', (lease: unknown) => prepareApplyLocked(root, target, expected ?? JSON.parse(fs.readFileSync(path.join(root, 'staged', `${target}.json`), 'utf8')).manifestSha256, lease));
function setup(clean = true) {
  const payload = temp(), base = temp();
  const rel = { id, writerProtocol: 1, electron: '1.0.0', version: '1.0.0', claudeEngine: 'engines/claude/1.0.0/claude.exe' };
  for (const name of ['release.mjs', 'update.mjs', 'icon.ico', 'LICENSE', `releases/${id}/package.json`, `releases/${id}/out/main/index.js`, 'electron/1.0.0/electron.exe', rel.claudeEngine]) put(payload, name, `new ${name}`);
  put(payload, `releases/${id}/release.json`, JSON.stringify(rel));
  const { sha256 } = manifestPayload(payload, rel, 'a'.repeat(40), clean);
  put(base, 'current.json', '{"current":"old","previous":null,"writerProtocol":1,"bad":[],"history":[]}');
  put(base, 'release.mjs', 'old bootstrap');
  put(base, 'userData/chats.json', 'keep chats');
  return { payload, base, sha256 };
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('verified staged updates', () => {
  it('stages idempotently without changing current, launcher, bootstrap or chats', () => {
    const { payload, base, sha256 } = setup();
    const before = fs.readFileSync(path.join(base, 'current.json'), 'utf8');
    stageUpdate(base, payload, sha256);
    stageUpdate(base, payload, sha256);
    expect(fs.readFileSync(path.join(base, 'current.json'), 'utf8')).toBe(before);
    expect(fs.readFileSync(path.join(base, 'release.mjs'), 'utf8')).toBe('old bootstrap');
    expect(fs.existsSync(path.join(base, 'launch.cmd'))).toBe(false);
    expect(fs.readFileSync(path.join(base, 'userData/chats.json'), 'utf8')).toBe('keep chats');
    expect(stagedUpdates(base)).toMatchObject([{ id, manifestSha256: sha256 }]);
  });
  it('apply rechecks assets and prepares the new bootstrap while leaving activation to release.mjs', () => {
    const { payload, base, sha256 } = setup();
    stageUpdate(base, payload, sha256);
    expect(prepareApply(base, id)).toBe(id);
    expect(fs.readFileSync(path.join(base, 'release.mjs'), 'utf8')).toBe('new release.mjs');
    expect(JSON.parse(fs.readFileSync(path.join(base, 'current.json'), 'utf8')).current).toBe('old');
    expect(fs.readFileSync(path.join(base, 'userData/chats.json'), 'utf8')).toBe('keep chats');
  });
  it('refuses wrong digest, tampered assets and dirty source before changing active files', () => {
    const a = setup();
    expect(() => stageUpdate(a.base, a.payload, '0'.repeat(64))).toThrow(/SHA-256/);
    put(a.payload, 'icon.ico', 'tampered');
    expect(() => stageUpdate(a.base, a.payload, a.sha256)).toThrow(/hash mismatch/);
    const b = setup(false);
    expect(() => stageUpdate(b.base, b.payload, b.sha256)).toThrow(/draft/);
    expect(fs.readFileSync(path.join(a.base, 'release.mjs'), 'utf8')).toBe('old bootstrap');
  });
  it('refuses a changed immutable runtime and leaves other new assets uncopied', () => {
    const { payload, base, sha256 } = setup();
    put(base, 'electron/1.0.0/electron.exe', 'already running binary');
    expect(() => stageUpdate(base, payload, sha256)).toThrow(/immutable/);
    expect(fs.existsSync(path.join(base, 'releases', id))).toBe(false);
  });
  it('never adds files to an existing active runtime directory', () => {
    const { payload, base, sha256 } = setup();
    fs.mkdirSync(path.join(base, 'electron/1.0.0'), { recursive: true });
    expect(() => stageUpdate(base, payload, sha256)).toThrow(/immutable update directory is incomplete/);
    expect(fs.readdirSync(path.join(base, 'electron/1.0.0'))).toEqual([]);
    expect(fs.existsSync(path.join(base, 'releases', id))).toBe(false);
  });
  it('rechecks at apply and refuses tampering after staging', () => {
    const { payload, base, sha256 } = setup();
    stageUpdate(base, payload, sha256);
    put(base, `releases/${id}/out/main/index.js`, 'tampered after staging');
    expect(() => prepareApply(base, id)).toThrow(/hash mismatch/);
    expect(fs.readFileSync(path.join(base, 'release.mjs'), 'utf8')).toBe('old bootstrap');
  });
  it('refuses manifest traversal and junctions into other folders', () => {
    const { payload, base, sha256 } = setup();
    expect(() => safePayloadPath(base, '../outside')).toThrow(/unsafe/);
    expect(() => safePayloadPath(base, 'C:/outside')).toThrow(/unsafe/);
    fs.symlinkSync(temp(), path.join(base, 'engines'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => stageUpdate(base, payload, sha256)).toThrow(/symlinks/);
    const file = path.join(payload, 'payload.json');
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    m.files['../outside'] = 'b'.repeat(64);
    fs.writeFileSync(file, JSON.stringify(m));
    expect(() => stageUpdate(temp(), payload, hashFile(file))).toThrow(/unexpected/);
  });
  it('refuses a manifest leaf junction before copying the staged manifest', () => {
    const { payload, base, sha256 } = setup();
    const staged = path.join(base, 'staged', id);
    fs.mkdirSync(staged, { recursive: true });
    const outside = temp();
    put(outside, 'sentinel', 'preserve');
    fs.symlinkSync(outside, path.join(staged, 'payload.json'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => stageUpdate(base, payload, sha256)).toThrow(/symlinks/);
    expect(fs.readFileSync(path.join(outside, 'sentinel'), 'utf8')).toBe('preserve');
  });
});
