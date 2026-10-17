// Private checkpoint handshake regressions: capture cancellation, size/allowlist, recovery replay and disk failure.
// No Electron, updater activation, network, real user data or process restart is involved.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdateCheckpoint } from '../../src/main/update/checkpoint';
import { UPDATE_SNAPSHOT_KEYS, type UpdateSnapshot } from '../../src/shared/app-update';

const dirs: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const directory = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-update-checkpoint-')); dirs.push(d); return d; };
const data = (): UpdateSnapshot => Object.fromEntries(UPDATE_SNAPSHOT_KEYS.map(k => [k, 'null'])) as UpdateSnapshot;

describe('update checkpoint', () => {
  it('keeps the renderer frozen after ACK and preserves recovery for target and rollback until each adopts it', async () => {
    const root = directory(), release = vi.fn();
    const service: UpdateCheckpoint = new UpdateCheckpoint({ userData: root, running: 'old', release, request: r => service.answer({ requestId: r.requestId, snapshot: data() }) });
    const id = await service.capture('new'); expect(release).not.toHaveBeenCalled(); service.arm(id);
    const next = new UpdateCheckpoint({ userData: root, running: 'new', request: vi.fn(), release: vi.fn() });
    expect(next.recovery()).toEqual({ id, snapshot: data() });
    expect(next.recovery()).toEqual({ id, snapshot: data() }); // get is not destructive
    next.acknowledge(id); next.acknowledge(id); expect(next.recovery()).toBe(null);
    expect(new UpdateCheckpoint({ userData: root, running: 'new', request: vi.fn(), release: vi.fn() }).recovery()).toBe(null);
    const rollback = new UpdateCheckpoint({ userData: root, running: 'old', request: vi.fn(), release: vi.fn() });
    expect(rollback.recovery()?.id).toBe(id); rollback.acknowledge(id); expect(rollback.recovery()).toBe(null);
    expect(fs.existsSync(path.join(root, 'update-checkpoint.json'))).toBe(true);
  });
  it('rejects release between ACK and continuation without writing a false successful checkpoint', async () => {
    const root = directory(), release = vi.fn();
    const service: UpdateCheckpoint = new UpdateCheckpoint({ userData: root, running: 'old', release, request: r => { service.answer({ requestId: r.requestId, snapshot: data() }); service.release(r.requestId); } });
    await expect(service.capture('new')).rejects.toThrow(/annullato/);
    expect(release).toHaveBeenCalledTimes(1); expect(fs.existsSync(path.join(root, 'update-checkpoint.json'))).toBe(false);
  });
  it('refuses oversized data before JSON parsing and releases the renderer on the rejected ACK', async () => {
    const root = directory(), release = vi.fn(), huge = data(); huge['sb.prefs.v1'] = `"${'x'.repeat(8_000_001)}"`;
    const parse = vi.spyOn(JSON, 'parse');
    const service: UpdateCheckpoint = new UpdateCheckpoint({ userData: root, running: 'old', release, request: r => service.answer({ requestId: r.requestId, snapshot: huge }) });
    parse.mockClear(); await expect(service.capture('new')).rejects.toThrow(/8 MB/);
    expect(parse).not.toHaveBeenCalled(); expect(release).toHaveBeenCalledTimes(1);
  });
  it('does not clear the next request when an already answered capture is cancelled', async () => {
    const root = directory(); let second: Promise<string> | undefined, secondId = '';
    let calls = 0;
    const service: UpdateCheckpoint = new UpdateCheckpoint({ userData: root, running: 'old', release: vi.fn(), request: r => {
      if (++calls === 1) { service.answer({ requestId: r.requestId, snapshot: data() }); service.release(r.requestId); second = service.capture('second'); }
      else secondId = r.requestId;
    } });
    await expect(service.capture('first')).rejects.toThrow(/annullato/);
    service.answer({ requestId: secondId, snapshot: data() });
    await expect(second).resolves.toBe(secondId); service.release(secondId);
  });
  it('reserves both adoption markers before accepting a near-limit snapshot', async () => {
    const root = directory(), row = data(); row['sb.prefs.v1'] = JSON.stringify('');
    const envelope = { version: 1, id: '00000000-0000-4000-8000-000000000000', from: 'old', target: 'new', phase: 'captured', adopted: [], snapshot: row };
    row['sb.prefs.v1'] = JSON.stringify('x'.repeat(7_999_999 - Buffer.byteLength(JSON.stringify(envelope), 'utf8')));
    const service: UpdateCheckpoint = new UpdateCheckpoint({ userData: root, running: 'old', release: vi.fn(), request: r => service.answer({ requestId: r.requestId, snapshot: row }) });
    await expect(service.capture('new')).rejects.toThrow(/dati di recupero/);
    expect(fs.existsSync(path.join(root, 'update-checkpoint.json'))).toBe(false);
    const reserve = Buffer.byteLength(JSON.stringify({ ...envelope, adopted: ['old', 'new'] }), 'utf8') - Buffer.byteLength(JSON.stringify(envelope), 'utf8');
    row['sb.prefs.v1'] = JSON.stringify(JSON.parse(row['sb.prefs.v1']).slice(0, -reserve));
    const id = await service.capture('new'); service.arm(id);
    const next = new UpdateCheckpoint({ userData: root, running: 'new', request: vi.fn(), release: vi.fn() });
    next.recovery(); next.acknowledge(id);
    const rollback = new UpdateCheckpoint({ userData: root, running: 'old', request: vi.fn(), release: vi.fn() });
    rollback.recovery(); rollback.acknowledge(id);
    expect(fs.statSync(path.join(root, 'update-checkpoint.json')).size).toBeLessThanOrEqual(8_000_000);
  });
  it('refuses missing/extra namespaces, stale ACKs, and renderer refusal without replacing prior data', async () => {
    const root = directory();
    const service: UpdateCheckpoint = new UpdateCheckpoint({ userData: root, running: 'old', release: vi.fn(), request: r => service.answer({ requestId: r.requestId, snapshot: { ...data(), extra: 'null' } } as never) });
    await expect(service.capture('new')).rejects.toThrow(/non previsti/);
    expect(() => service.answer({ requestId: 'stale', snapshot: data() })).toThrow(/scaduta/);
    const denied = new UpdateCheckpoint({ userData: root, running: 'old', release: vi.fn(), request: r => denied.answer({ requestId: r.requestId, problem: 'Coda non vuota' }) });
    await expect(denied.capture('new')).rejects.toThrow('Coda non vuota');
    expect(fs.existsSync(path.join(root, 'update-checkpoint.json'))).toBe(false);
  });
  it('times out an absent ACK and rejects duplicate capture', async () => {
    const root = directory(), release = vi.fn();
    const service = new UpdateCheckpoint({ userData: root, running: 'old', release, request: vi.fn(), timeoutMs: 10 });
    const pending = service.capture('new'); await expect(service.capture('new')).rejects.toThrow(/già/);
    await expect(pending).rejects.toThrow(/non ha confermato/); expect(release).toHaveBeenCalledTimes(1);
  });
  it('preserves corrupt files and refuses activation capture before inherited recovery adoption', async () => {
    const root = directory(), file = path.join(root, 'update-checkpoint.json'); fs.writeFileSync(file, 'invalid');
    expect(() => new UpdateCheckpoint({ userData: root, running: 'old', request: vi.fn(), release: vi.fn() })).toThrow();
    expect(fs.readFileSync(file, 'utf8')).toBe('invalid'); fs.unlinkSync(file);
    const source: UpdateCheckpoint = new UpdateCheckpoint({ userData: root, running: 'old', release: vi.fn(), request: r => source.answer({ requestId: r.requestId, snapshot: data() }) });
    const id = await source.capture('new'); source.arm(id);
    const next = new UpdateCheckpoint({ userData: root, running: 'new', request: vi.fn(), release: vi.fn() });
    await expect(next.capture('newer')).rejects.toThrow(/recupero/);
    expect(() => next.acknowledge(id)).toThrow(/non richiesto/);
  });
  it('releases on a failed atomic publication and leaves the previous checkpoint bytes untouched', async () => {
    const root = directory(), release = vi.fn();
    const service: UpdateCheckpoint = new UpdateCheckpoint({ userData: root, running: 'old', release, request: r => service.answer({ requestId: r.requestId, snapshot: data() }) });
    const id = await service.capture('new'); service.release(id);
    const file = path.join(root, 'update-checkpoint.json'), before = fs.readFileSync(file, 'utf8');
    vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('disk denied'); });
    await expect(service.capture('other')).rejects.toThrow('disk denied');
    expect(fs.readFileSync(file, 'utf8')).toBe(before); expect(release).toHaveBeenCalledTimes(2);
  });
  it('keeps aborted attempts on disk but never offers their stale drafts after editing resumes', async () => {
    const root = directory(), release = vi.fn();
    const service: UpdateCheckpoint = new UpdateCheckpoint({ userData: root, running: 'old', release, request: r => service.answer({ requestId: r.requestId, snapshot: data() }) });
    const id = await service.capture('new'); service.arm(id); service.release(id);
    expect(release).toHaveBeenCalledWith({ requestId: id });
    const restarted = new UpdateCheckpoint({ userData: root, running: 'old', request: vi.fn(), release: vi.fn() });
    expect(restarted.recovery()).toBe(null); expect(fs.existsSync(path.join(root, 'update-checkpoint.json'))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(root, 'update-checkpoint.json'), 'utf8')).phase).toBe('aborted');
  });
});
