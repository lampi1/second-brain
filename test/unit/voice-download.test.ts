// The voice models' download (ADR 0152, src/main/voice/download.ts + catalog.ts): every file checked before use
// (sha256 or git blob id), a bad one deleted, a .tar.bz2 voice unpacked inside its folder only, the `.ok` marker only
// after all files passed; the catalog pins every file.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { ensurePart, partReady, untar, verify } from '../../src/main/voice/download';
import { ASR, TTS, VAD, partsFor } from '../../src/main/voice/catalog';
import type { VoicePart } from '../../src/main/voice/catalog';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-voice-'));
const sha = (b: Uint8Array) => crypto.createHash('sha256').update(b).digest('hex');
const blob = (b: Uint8Array) => crypto.createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
const fetchOf = (files: Record<string, Uint8Array>) => (async (url: string | URL | Request) => {
  const body = files[String(url)];
  return body ? new Response(body as unknown as BodyInit) : new Response('no', { status: 404 });
}) as typeof fetch;

/** a ustar archive with the given entries (name → content, or null = folder) */
function tarOf(entries: [string, string | null][]): Buffer {
  const parts: Buffer[] = [];
  for (const [name, body] of entries) {
    const h = Buffer.alloc(512);
    h.write(name, 0, 'utf8');
    h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
    const data = Buffer.from(body ?? '');
    h.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
    h.write('00000000000\0', 136);
    h.write(body === null ? '5' : '0', 156);
    h.write('ustar\0', 257); h.write('00', 263);
    h.fill(' ', 148, 156);
    let sum = 0; for (const b of h) sum += b;
    h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    parts.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

describe('verify', () => {
  it('sha256 and git blob ids', () => {
    const b = Buffer.from('ciao\n');
    expect(verify(b, { sha256: sha(b) })).toBe(true);
    expect(verify(b, { sha256: '0'.repeat(64) })).toBe(false);
    expect(verify(b, { gitBlob: blob(b), size: b.length })).toBe(true);
    expect(verify(b, { gitBlob: blob(b), size: 99 })).toBe(false);
  });
  it('the blob id of a known git object', () => {
    // `git hash-object` of "hello\n"
    expect(blob(Buffer.from('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });
});

describe('ensurePart', () => {
  it('downloads, checks, marks ready; a second call fetches nothing', async () => {
    const root = tmp(), a = Buffer.from('model bytes'), b = Buffer.from('tokens');
    const part: VoicePart = { id: 'p', files: [{ name: 'm.onnx', url: 'https://x/m', check: { sha256: sha(a) }, bytes: a.length }, { name: 't.txt', url: 'https://x/t', check: { gitBlob: blob(b), size: b.length }, bytes: b.length }] };
    let calls = 0;
    const f = fetchOf({ 'https://x/m': a, 'https://x/t': b });
    const counting = (async (u: string | URL | Request) => { calls++; return f(u); }) as typeof fetch;
    const seen: number[] = [];
    await ensurePart(root, part, n => seen.push(n), counting);
    expect(partReady(root, part)).toBe(true);
    expect(fs.readFileSync(path.join(root, 'p', 'm.onnx'), 'utf8')).toBe('model bytes');
    expect(seen.at(-1)).toBe(a.length + b.length);
    await ensurePart(root, part, () => {}, counting);
    expect(calls).toBe(2);
  });
  it('a catalog change (a new hash for the same part) makes the part missing again, its old files dropped', async () => {
    const root = tmp(), a = Buffer.from('v1'), b = Buffer.from('v2');
    const v1: VoicePart = { id: 'p', files: [{ name: 'm.onnx', url: 'https://x/1', check: { sha256: sha(a) }, bytes: 2 }] };
    const v2: VoicePart = { id: 'p', files: [{ name: 'm.onnx', url: 'https://x/2', check: { sha256: sha(b) }, bytes: 2 }] };
    await ensurePart(root, v1, () => {}, fetchOf({ 'https://x/1': a }));
    expect(partReady(root, v2)).toBe(false);
    await ensurePart(root, v2, () => {}, fetchOf({ 'https://x/2': b }));
    expect(fs.readFileSync(path.join(root, 'p', 'm.onnx'), 'utf8')).toBe('v2');
    expect(partReady(root, v2)).toBe(true);
  });
  it('a file with another hash is deleted and the part never marked ready', async () => {
    const root = tmp();
    const part: VoicePart = { id: 'p', files: [{ name: 'm.onnx', url: 'https://x/m', check: { sha256: '0'.repeat(64) }, bytes: 3 }] };
    await expect(ensurePart(root, part, () => {}, fetchOf({ 'https://x/m': Buffer.from('bad') }))).rejects.toThrow(/impronta/);
    expect(fs.existsSync(path.join(root, 'p', 'm.onnx'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'p', 'm.onnx.part'))).toBe(false);
    expect(partReady(root, part)).toBe(false);
  });
  it('an HTTP error fails without a marker', async () => {
    const root = tmp();
    const part: VoicePart = { id: 'p', files: [{ name: 'm.onnx', url: 'https://x/missing', check: { sha256: '0'.repeat(64) }, bytes: 3 }] };
    await expect(ensurePart(root, part, () => {}, fetchOf({}))).rejects.toThrow(/HTTP 404/);
    expect(partReady(root, part)).toBe(false);
  });
  it('a .tar.bz2 voice is unpacked without its top folder, the archive removed', async () => {
    const root = tmp(), src = tmp();
    fs.writeFileSync(path.join(src, 'v.tar'), tarOf([['vits-x/', null], ['vits-x/it.onnx', 'onnx'], ['vits-x/tokens.txt', 'a 1'], ['vits-x/espeak-ng-data/', null], ['vits-x/espeak-ng-data/it_dict', 'dict']]));
    let bz: Buffer;
    try { execFileSync('bzip2', ['-k', path.join(src, 'v.tar')]); bz = fs.readFileSync(path.join(src, 'v.tar.bz2')); }
    catch { execFileSync('python3', ['-c', `import bz2,sys;open(sys.argv[2],'wb').write(bz2.compress(open(sys.argv[1],'rb').read()))`, path.join(src, 'v.tar'), path.join(src, 'v.tar.bz2')]); bz = fs.readFileSync(path.join(src, 'v.tar.bz2')); }
    const part: VoicePart = { id: 'piper-x', files: [{ name: 'v.tar.bz2', url: 'https://x/v', check: { sha256: sha(bz) }, bytes: bz.length, untar: true }] };
    await ensurePart(root, part, () => {}, fetchOf({ 'https://x/v': bz }));
    const d = path.join(root, 'piper-x');
    expect(fs.readFileSync(path.join(d, 'it.onnx'), 'utf8')).toBe('onnx');
    expect(fs.readFileSync(path.join(d, 'espeak-ng-data', 'it_dict'), 'utf8')).toBe('dict');
    expect(fs.existsSync(path.join(d, 'v.tar.bz2'))).toBe(false);
    expect(partReady(root, part)).toBe(true);
  });
});

describe('untar', () => {
  it('refuses an entry that would leave the folder', () => {
    const dir = tmp();
    expect(() => untar(tarOf([['top/../../evil.txt', 'x']]), dir)).toThrow(/archivio non valido/);
    expect(fs.existsSync(path.join(dir, '..', 'evil.txt'))).toBe(false);
  });
});

describe('catalog', () => {
  it('pins every file: https only, a 64-hex sha256 or a 40-hex blob id', () => {
    const parts = [VAD, ...Object.values(ASR), ...Object.values(TTS)];
    for (const p of parts) for (const f of p.files) {
      expect(f.url.startsWith('https://huggingface.co/') || f.url.startsWith('https://github.com/k2-fsa/sherpa-onnx/releases/download/')).toBe(true);
      if ('sha256' in f.check) expect(f.check.sha256).toMatch(/^[0-9a-f]{64}$/);
      else expect(f.check.gitBlob).toMatch(/^[0-9a-f]{40}$/);
      if (f.url.includes('huggingface.co')) expect(f.url).toMatch(/\/resolve\/[0-9a-f]{40}\//);
    }
  });
  it('the small VAD first, the voice before the big Whisper', () => {
    expect(partsFor('fast', 'paola').map(p => p.id)).toEqual(['vad', 'piper-paola-medium', 'whisper-small']);
    expect(partsFor('accurate', 'dii').map(p => p.id)).toEqual(['vad', 'piper-dii-high', 'whisper-turbo']);
  });
});
