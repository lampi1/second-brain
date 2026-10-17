// Offline transaction tests: staging never activates; consent pins identity, checkpoints precede apply, failures stay safe.
import { describe, expect, it, vi } from 'vitest';
import { AppUpdateService, type UpdateServiceDeps, type UpdateStatus } from '../../src/main/update/service';
import { UpdateActivity } from '../../src/main/update/activity';

function fixture(protocol: 1 | 2 = 2) {
  const calls: string[] = [];
  const candidate = { id: 'new', version: '1.1.0', source: 'a'.repeat(40), manifestSha256: 'b'.repeat(64), payloadDir: 'offline-fixture', changes: 'Public change', releaseUrl: 'https://github.com/example/product/releases/tag/v1.1.0' };
  let current = 'old', previous: string | null = null, staged = false;
  const gate = new UpdateActivity();
  const status = (): UpdateStatus => ({ protocol, current, previous, staged: staged ? [candidate] : [] });
  const deps: UpdateServiceDeps = {
    running: 'old', capability: { available: true, canApply: true }, status: async () => { calls.push('status'); return status(); },
    acquire: async () => { calls.push('acquire'); return candidate; }, discard: vi.fn(() => { calls.push('discard'); }),
    stage: async () => { calls.push('stage'); staged = true; },
    activate: async (row, expected) => { calls.push('activate'); expect(row).toEqual({ id: candidate.id, version: candidate.version, source: candidate.source, manifestSha256: candidate.manifestSha256 }); expect(expected).toBe('old'); previous = current; current = row.id; },
    rollback: async (expected, before) => { calls.push('rollback'); expect(current).toBe(expected); expect(previous).toBe(before); current = before; },
    pause: () => { calls.push('pause'); const unlock = gate.acquire(); return () => { calls.push('unlock'); unlock(); }; },
    problem: () => null,
    checkpoint: { capture: async () => { calls.push('capture'); return 'checkpoint'; }, arm: vi.fn(() => { calls.push('arm'); }), release: vi.fn(() => { calls.push('release'); }) },
    saveChats: () => { calls.push('save'); }, flush: () => { calls.push('flush'); },
    restart: async () => { calls.push('restart-ready'); return { cancel: async () => { calls.push('restart-cancel'); } }; },
    quit: vi.fn(() => { calls.push('quit'); }), emit: vi.fn(),
  };
  return { deps, calls, candidate, gate, status, service: new AppUpdateService(deps) };
}
describe('single staged updater', () => {
  it('prepares and verifies a staged marker without applying or quitting', async () => {
    const f = fixture(); const state = await f.service.prepare();
    expect(state).toMatchObject({ checking: false, update: { phase: 'ready', blocked: null } });
    expect(f.calls).toEqual(['status', 'acquire', 'stage', 'status', 'discard']);
    expect(f.deps.quit).not.toHaveBeenCalled();
  });
  it('allows preparation on the legacy stage protocol but refuses automatic apply', async () => {
    const f = fixture(1); await f.service.prepare();
    expect(f.service.state().update).toMatchObject({ phase: 'ready', blocked: expect.any(String) });
    await expect(f.service.apply('new')).rejects.toThrow(/non supportata/);
    expect(f.calls).not.toContain('activate');
  });
  it('requires the separately verified application capability even if a newer protocol reports itself', async () => {
    const f = fixture(); f.deps.capability.canApply = false; await f.service.prepare();
    await expect(f.service.apply('new')).rejects.toThrow(/non supportata/);
  });
  it('returns checking false when no newer release exists', async () => {
    const f = fixture(); f.deps.acquire = async () => null;
    expect(await f.service.prepare()).toMatchObject({ checking: false, update: null });
  });
  it('does not call a mismatched staged marker ready', async () => {
    const f = fixture(); f.deps.status = async () => ({ ...f.status(), staged: [] });
    await f.service.prepare(); expect(f.service.state().update).toMatchObject({ phase: 'failed' });
    await expect(f.service.apply('new')).rejects.toThrow(); expect(f.calls).not.toContain('activate');
  });
  it('checkpoints and readies restart before activation, then keeps the pause for quit', async () => {
    const f = fixture(); await f.service.prepare(); f.calls.length = 0;
    await f.service.apply('new');
    expect(f.calls).toEqual(['pause', 'status', 'capture', 'save', 'flush', 'restart-ready', 'status', 'arm', 'activate', 'status', 'save', 'quit']);
    expect(f.gate.frozen).toBe(true); expect(f.deps.checkpoint.release).not.toHaveBeenCalled();
  });
  it('aborts the checkpoint before unlocking if strict chat save fails', async () => {
    const f = fixture(); await f.service.prepare(); f.deps.saveChats = () => { throw new Error('disk denied'); };
    await expect(f.service.apply('new')).rejects.toThrow('disk denied');
    expect(f.calls).not.toContain('activate'); expect(f.gate.frozen).toBe(false);
    expect(f.calls.indexOf('release')).toBeLessThan(f.calls.indexOf('unlock'));
  });
  it('cancels restart and conditionally restores only its own activation on a reported apply failure', async () => {
    const f = fixture(); await f.service.prepare(); const activate = f.deps.activate;
    f.deps.activate = async (...args) => { await activate(...args); throw new Error('reported failure'); };
    await expect(f.service.apply('new')).rejects.toThrow('reported failure');
    expect(f.calls).toContain('rollback'); expect(f.calls.indexOf('restart-cancel')).toBeLessThan(f.calls.indexOf('rollback'));
    expect(f.status().current).toBe('old'); expect(f.gate.frozen).toBe(false); expect(f.deps.quit).not.toHaveBeenCalled();
  });
  it('does not release editing if the restart helper cannot be proven cancelled', async () => {
    const f = fixture(); await f.service.prepare();
    f.deps.restart = async () => ({ cancel: async () => { throw new Error('cancel unconfirmed'); } });
    f.deps.activate = async () => { throw new Error('apply failed'); };
    await expect(f.service.apply('new')).rejects.toThrow('cancel unconfirmed');
    expect(f.gate.frozen).toBe(true); expect(f.deps.checkpoint.release).not.toHaveBeenCalled();
  });
});

describe('update activity owner', () => {
  it('waits for in-flight work, blocks new work, and ignores an old release after a newer pause', async () => {
    const gate = new UpdateActivity(), leave = gate.enter();
    expect(() => gate.acquire()).toThrow(/operazioni/); leave(); leave();
    const old = gate.acquire(); expect(() => gate.enter()).toThrow(/Aggiornamento/); old();
    const next = gate.acquire(); old(); expect(gate.frozen).toBe(true); next();
    await expect(gate.run(async () => 'done')).resolves.toBe('done');
  });
});
