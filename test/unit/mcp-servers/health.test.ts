// The health state machine of the app's MCP servers (ADR 0370): N failures in a row mark a server needs-login (a refused
// access) or broken (its program does not start, it is down); a marked server is held back, one probe at a time after
// a back-off that grows only with failed probes; a success or the user's action (reset) forgets it. A fake clock.
import { describe, expect, it } from 'vitest';
import { BACKOFF_MS, ConnectorHealth, FAILS_TO_MARK, PROBE_LEASE_MS, failKind, waitText } from '../../../src/main/mcp-servers/health';

const clock = () => { let t = 1_000; return { now: () => t, at: (ms: number) => { t = ms; }, add: (ms: number) => { t += ms; } }; };

describe('ConnectorHealth', () => {
  it('a refused access: failing, then needs-login after FAILS_TO_MARK.auth in a row, held back for the long wait', () => {
    const c = clock(), h = new ConnectorHealth(c.now);
    expect(h.gate('air')).toEqual({ open: true, probe: false });
    expect(h.failed('air', 'auth', 'HTTP 401')).toMatchObject({ from: 'ok', to: 'failing' });
    expect(h.gate('air').open).toBe(true);                      // one failure holds nothing back
    expect(FAILS_TO_MARK.auth).toBe(2);
    const t = h.failed('air', 'auth', 'HTTP 401');
    expect(t).toMatchObject({ from: 'failing', to: 'needs-login', health: { streak: 2, until: 1_000 + BACKOFF_MS['needs-login'][0]!, cause: 'HTTP 401' } });
    const g = h.gate('air');
    expect(g.open).toBe(false);
    if (!g.open) expect(waitText(g.waitMs)).toBe('6 h');
  });

  it('a program that does not start and a down service: broken after their own count', () => {
    const c = clock(), h = new ConnectorHealth(c.now);
    h.failed('kb', 'spawn', 'ENOENT');
    expect(h.failed('kb', 'spawn', 'ENOENT').to).toBe('broken');
    for (let i = 1; i < FAILS_TO_MARK.down; i++) expect(h.failed('teams', 'down', 'timeout 30 s').to).toBe('failing');
    expect(h.failed('teams', 'down', 'timeout 30 s')).toMatchObject({ to: 'broken', health: { until: 1_000 + BACKOFF_MS.broken[0]! } });
  });

  it('a success in between starts the count again', () => {
    const h = new ConnectorHealth(clock().now);
    h.failed('teams', 'down', 'x'); h.failed('teams', 'down', 'x');
    expect(h.worked('teams')).toMatchObject({ from: 'failing', to: 'ok' });
    expect(h.failed('teams', 'down', 'x').to).toBe('failing');
    expect(h.get('teams').streak).toBe(1);
  });

  it('after the wait one probe goes through; others wait for it; a failed probe waits longer, capped', () => {
    const c = clock(), h = new ConnectorHealth(c.now);
    h.failed('kb', 'spawn', 'x'); h.failed('kb', 'spawn', 'x');
    c.add(BACKOFF_MS.broken[0]!);
    expect(h.gate('kb')).toEqual({ open: true, probe: true });
    expect(h.gate('kb').open).toBe(false);                      // the probe is in flight
    const t = h.failed('kb', 'spawn', 'x');
    expect(t).toMatchObject({ from: 'broken', to: 'broken', health: { probes: 1, until: c.now() + BACKOFF_MS.broken[1]! } });
    for (let i = 0; i < 5; i++) { c.add(h.get('kb').until - c.now()); expect(h.gate('kb').open).toBe(true); h.failed('kb', 'spawn', 'x'); }
    expect(h.get('kb').until - c.now()).toBe(BACKOFF_MS.broken[BACKOFF_MS.broken.length - 1]);
  });

  it('a probe that never reports frees its slot after the lease', () => {
    const c = clock(), h = new ConnectorHealth(c.now);
    h.failed('kb', 'spawn', 'x'); h.failed('kb', 'spawn', 'x');
    c.add(BACKOFF_MS.broken[0]!);
    expect(h.gate('kb').open).toBe(true);
    c.add(PROBE_LEASE_MS);
    expect(h.gate('kb')).toEqual({ open: true, probe: true });
  });

  it('failures of connections opened before the mark do not lengthen the wait; a refusal seen on a broken one wins', () => {
    const c = clock(), h = new ConnectorHealth(c.now);
    h.failed('air', 'auth', 'x'); h.failed('air', 'auth', 'x');
    const until = h.get('air').until;
    c.add(1000);
    expect(h.failed('air', 'auth', 'x')).toMatchObject({ from: 'needs-login', to: 'needs-login', health: { probes: 0, until } });
    h.failed('kb', 'spawn', 'x'); h.failed('kb', 'spawn', 'x');
    expect(h.failed('kb', 'auth', 'HTTP 403')).toMatchObject({ from: 'broken', to: 'needs-login', health: { probes: 0 } });
  });

  it('a probe that works, or the user acting on it, forgets everything', () => {
    const c = clock(), h = new ConnectorHealth(c.now);
    h.failed('air', 'auth', 'x'); h.failed('air', 'auth', 'x');
    c.add(BACKOFF_MS['needs-login'][0]!);
    expect(h.gate('air').open).toBe(true);
    expect(h.worked('air')).toMatchObject({ from: 'needs-login', to: 'ok' });
    expect(h.get('air')).toMatchObject({ state: 'ok', streak: 0 });
    h.failed('air', 'auth', 'x'); h.failed('air', 'auth', 'x');
    h.reset('air');
    expect(h.gate('air')).toEqual({ open: true, probe: false });
    h.failed('a', 'auth', 'x'); h.failed('b', 'spawn', 'x');
    h.reset();
    expect([h.get('a').state, h.get('b').state]).toEqual(['ok', 'ok']);
  });

  it('kinds and wait texts', () => {
    expect([failKind('auth'), failKind('spawn'), failKind('timeout'), failKind('network'), failKind(undefined)]).toEqual(['auth', 'spawn', 'down', 'down', 'down']);
    expect([waitText(1), waitText(15 * 60_000), waitText(6 * 3_600_000)]).toEqual(['1 min', '15 min', '6 h']);
  });
});
