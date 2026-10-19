// Main lifecycle deadline regression tests: injected clock, no timers, models or actual chat closure.
import { describe, expect, it } from 'vitest';
import { AUTO_CLOSE_WARNING_MS as WARNING, AutoCloseService, type AutoCloseCandidate, type AutoCloseDeps } from '../../src/main/chats/auto-close';
import type { AutoClosePresence } from '../../src/shared/auto-close';

function fixture() {
  let now = 1_000_000;
  let candidate: AutoCloseCandidate = { id: 'agent', stamp: 'turn-1', activityAt: now - 900_000, eligible: true };
  const archived: string[] = [];
  const deps: AutoCloseDeps = { now: () => now, delayMs: () => 120_000, candidates: () => [candidate], emit: () => {}, archive: async (id, _expected, valid) => { if (!valid()) return false; archived.push(id); return true; } };
  const service = new AutoCloseService(deps);
  const presence = (patch: Partial<AutoClosePresence> = {}) => {
    const row = service.state()[0];
    service.setPresence([{ chatId: 'agent', draft: false, shown: false, browser: false, queued: 0, touchedAt: 0,
      ...(row?.warningStartedAt != null ? { ackDeadline: row.deadline!, ackGeneration: row.generation } : {}), ...patch }]);
  };
  const advance = (ms: number) => { now += ms; };
  const heartbeatUntil = async (at: number) => { while (now < at) { advance(Math.min(5_000, at - now)); presence(); await service.tick(); } };
  const acknowledge = () => { const s = service.state()[0]!; presence({ ackDeadline: s.deadline!, ackGeneration: s.generation }); };
  return { service, deps, archived, presence, advance, acknowledge, heartbeatUntil, now: () => now, change: (p: Partial<AutoCloseCandidate>) => { candidate = { ...candidate, ...p }; } };
}

describe('backend automatic-close warning', () => {
  it('never closes an old restored result immediately, and requires a full acknowledged two-minute warning', async () => {
    const f = fixture(); f.presence();
    const first = f.service.state()[0]!;
    expect(first.deadline).toBe(f.now() + WARNING); f.acknowledge();
    await f.heartbeatUntil(first.deadline! - 1); expect(f.archived).toEqual([]);
    await f.heartbeatUntil(first.deadline!); expect(f.archived).toEqual(['agent']);
  });
  it('does not mistake a scheduled timer for a warning that the renderer actually received', async () => {
    const f = fixture(); f.presence(); const deadline = f.service.state()[0]!.deadline!;
    await f.heartbeatUntil(deadline + 5_000); expect(f.archived).toEqual([]);
    expect(f.service.state()[0]!.deadline).toBeGreaterThan(deadline);
  });
  it('fails closed when renderer heartbeat is lost or clock moves backwards', async () => {
    const f = fixture(); f.presence(); f.acknowledge(); f.advance(WARNING + 1); await f.service.tick();
    expect(f.archived).toEqual([]); expect(f.service.state()[0]!.deadline).toBe(null);
    f.advance(-WARNING * 2); await f.service.tick(); expect(f.archived).toEqual([]);
  });
  it.each(['draft', 'shown', 'browser'] as const)('cancels deadline for %s and grants a fresh warning afterwards', async hold => {
    const f = fixture(); f.presence(); f.acknowledge(); f.advance(100_000);
    f.presence({ [hold]: true }); expect(f.service.state()[0]!.deadline).toBe(null);
    f.presence(); expect(f.service.state()[0]!.deadline).toBeGreaterThanOrEqual(f.now() + WARNING);
  });
  it('keep-open invalidates old acknowledgements and stale archive reservations', async () => {
    const f = fixture(); f.presence(); const old = f.service.state()[0]!; f.acknowledge();
    f.service.keepOpen('agent'); expect(f.service.state()[0]!.keptOpen).toBe(true);
    await f.heartbeatUntil(f.now() + WARNING * 2); expect(f.archived).toEqual([]);
    f.service.keepOpen('agent', false); f.presence({ ackDeadline: old.deadline!, ackGeneration: old.generation });
    expect(f.service.state()[0]!.warningStartedAt).toBe(null);
  });
  it('cancels on backend work/tool/child/mail/delivery guard changes', async () => {
    const f = fixture(); f.presence(); f.acknowledge();
    f.change({ eligible: false, reason: 'Mail delivery in progress', stamp: 'delivery-1' }); await f.service.tick();
    expect(f.service.state()[0]!.deadline).toBe(null); expect(f.archived).toEqual([]);
  });
  it('rechecks touch/draft acquired while archive awaits, without trusting the old renderer fade', async () => {
    const f = fixture(); f.presence(); f.acknowledge();
    let resume: (() => void) | undefined;
    f.deps.archive = async (_id, _reservation, valid) => { await new Promise<void>(resolve => { resume = resolve; }); if (valid()) f.archived.push('agent'); return valid(); };
    await f.heartbeatUntil(f.now() + WARNING - 1);
    f.advance(1); f.presence(); const closing = f.service.tick();
    f.presence({ draft: true, touchedAt: f.now() }); resume?.(); await closing;
    expect(f.archived).toEqual([]);
  });
  it('rejects backend stamp changes while the manager prepares a handoff', async () => {
    const f = fixture(); f.presence(); f.acknowledge();
    f.deps.archive = async (_id, _reservation, valid) => { f.change({ stamp: 'new-mail', eligible: false }); expect(valid()).toBe(false); return false; };
    await f.heartbeatUntil(f.now() + WARNING); expect(f.archived).toEqual([]);
  });
  it('stamps interaction on receipt and cannot move it backwards using a stale renderer timestamp', () => {
    const f = fixture(); f.presence({ touchedAt: 9e12 });
    const first = f.service.state()[0]!;
    expect(first.deadline).toBe(f.now() + WARNING);
    f.advance(1000); f.presence({ touchedAt: 0 });
    expect(f.service.state()[0]!.deadline).toBe(first.deadline);
  });
  it('holds UI queue and never creates an IPC feedback loop for unchanged heartbeat state', () => {
    const f = fixture(); let events = 0; f.deps.emit = () => { events++; };
    f.presence(); const first = events;
    f.presence(); f.presence(); expect(events).toBe(first);
    f.presence({ queued: 1 }); expect(f.service.state()[0]!.deadline).toBe(null);
  });
  it('starts the warning again if it disappears behind a modal or scroll clipping', () => {
    const f = fixture(); f.presence(); f.acknowledge(); f.advance(90_000);
    f.presence({ ackDeadline: undefined, ackGeneration: undefined });
    expect(f.service.state()[0]!.warningStartedAt).toBe(null);
    expect(f.service.state()[0]!.deadline).toBe(f.now() + WARNING);
  });
  it('renews on a new positive interaction marker after renderer restart or backward wall-clock change', () => {
    const f = fixture(); f.presence({ touchedAt: 9e12 }); const previous = f.service.state()[0]!.deadline!;
    f.advance(1_000); f.presence({ touchedAt: 1 });
    expect(f.service.state()[0]!.deadline).toBe(previous + 1_000);
  });
  it('names what a held chat waits for, and drops the label once it is eligible or kept open (ADR 0076)', () => {
    const f = fixture();
    f.change({ eligible: false, waitingFor: 'user', reason: 'In attesa dell’utente' }); f.presence();
    expect(f.service.state()[0]).toMatchObject({ deadline: null, waitingFor: 'user', reason: 'In attesa dell’utente' });
    f.service.keepOpen('agent'); expect(f.service.state()[0]?.waitingFor).toBeUndefined();
    f.service.keepOpen('agent', false); expect(f.service.state()[0]?.waitingFor).toBe('user');
    f.change({ eligible: true, waitingFor: undefined, stamp: 'turn-2' }); f.presence();
    expect(f.service.state()[0]?.waitingFor).toBeUndefined();
    expect(f.service.state()[0]?.deadline).not.toBeNull();
  });
});
