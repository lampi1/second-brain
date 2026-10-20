// The user's own pictures for the roles: main's store (main/agents/agent-images.ts) accepts only a PNG for one of
// the nine roles, re-encodes it before writing, tells the renderer, and "Immagine predefinita" removes it; the
// renderer crops the centre square (renderer/lib/agent-images.ts).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentImageStore, nativeReencode, type Reencode } from '../../src/main/agents/agent-images';
import { centreSquare } from '../../src/renderer/lib/agent-images';
import { AGENT_IMAGE_BYTES } from '../../src/shared/agent-images';

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const dirs: string[] = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-agent-images-')); dirs.push(d); return path.join(d, 'agent-images'); };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('AgentImageStore', () => {
  const reencoded = Buffer.from('re-encoded');
  const ok: Reencode = (_bytes, side) => (side === 256 ? reencoded : null);

  it('stores the re-encoded picture, serves it as a data URL and tells the renderer', () => {
    const seen: unknown[] = [];
    const dir = tmp();
    const store = new AgentImageStore(dir, ok, i => seen.push(i));
    expect(store.get()).toEqual({});
    const after = store.set('scout', PNG);
    expect(after.scout).toBe(`data:image/png;base64,${reencoded.toString('base64')}`);
    expect(fs.readFileSync(path.join(dir, 'scout.png'))).toEqual(reencoded);
    expect(seen).toEqual([after]);
    expect(new AgentImageStore(dir, ok).get()).toEqual(after);
  });

  it('removes the picture on reset (the character comes back)', () => {
    const dir = tmp();
    const store = new AgentImageStore(dir, ok);
    store.set('orchestrator', PNG);
    expect(store.reset('orchestrator')).toEqual({});
    expect(fs.existsSync(path.join(dir, 'orchestrator.png'))).toBe(false);
    expect(store.reset('orchestrator')).toEqual({});
  });

  it('refuses unknown roles, paths, non-PNG bytes, oversized and undecodable pictures', () => {
    const store = new AgentImageStore(tmp(), ok);
    expect(() => store.set('../../evil', PNG)).toThrow('AGENT_IMAGE_ROLE');
    expect(() => store.set('pulse', PNG)).toThrow('AGENT_IMAGE_ROLE');
    expect(() => store.set('judge', PNG)).toThrow('AGENT_IMAGE_ROLE'); // retired (ADR 0100)
    expect(() => store.reset('nope')).toThrow('AGENT_IMAGE_ROLE');
    expect(() => store.set('sentinel', new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0]))).toThrow('AGENT_IMAGE_INVALID');
    expect(() => store.set('sentinel', 'data:image/png;base64,AAAA')).toThrow('AGENT_IMAGE_INVALID');
    const big = new Uint8Array(AGENT_IMAGE_BYTES + 1); big.set(PNG);
    expect(() => store.set('sentinel', big)).toThrow('AGENT_IMAGE_INVALID');
    expect(() => new AgentImageStore(tmp(), () => null).set('sentinel', PNG)).toThrow('AGENT_IMAGE_INVALID');
    expect(store.get()).toEqual({});
  });
});

describe('nativeReencode', () => {
  const fake = (width: number, height: number, empty = false) => ({
    createFromBuffer: () => ({ isEmpty: () => empty, getSize: () => ({ width, height }), resize: (o: { width: number }) => ({ toPNG: () => Buffer.from(`png${o.width}`) }) }),
  });
  it('re-encodes a square picture at the stored side', () => {
    expect(nativeReencode(fake(300, 300))(Buffer.from(''), 256)?.toString()).toBe('png256');
  });
  it('refuses empty, tiny, huge or not square pictures', () => {
    for (const f of [fake(256, 256, true), fake(8, 8), fake(5000, 5000), fake(256, 128)]) expect(nativeReencode(f)(Buffer.from(''), 256)).toBeNull();
  });
});

describe('centreSquare', () => {
  it('takes the middle of a wide or tall picture', () => {
    expect(centreSquare(400, 200)).toEqual({ x: 100, y: 0, side: 200 });
    expect(centreSquare(200, 401)).toEqual({ x: 0, y: 100, side: 200 });
    expect(centreSquare(64, 64)).toEqual({ x: 0, y: 0, side: 64 });
  });
});
