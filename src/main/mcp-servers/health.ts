// The health of each app-managed MCP server, as one small state machine per server (ADR 0370, owner proposal 6,
// 2026-11-27: «air-mcp-test risponde 401 a ogni chat, ~700 volte in 7 ore; oris-knowledge non parte mai»). Why: the
// gateway opened every broken connector again for every chat that started (#417 held a dead program back for 10 minutes
// only, #437 never held a refused login back), so one server the user had not signed in to cost a network round trip and
// a log line per chat. Here a server that fails N times in a row is marked «needs-login» (it refuses the access: HTTP
// 401/403) or «broken» (its program does not start, or it times out or is unreachable); while marked, the gateway gives
// every chat the same answer at once and opens nothing, until the user signs in, edits or tries it («Accedi», a token,
// a changed definition, «Prova»: reset) or a long back-off ends (one probe at a time, each failed probe a longer wait).
// One transition = one log line (by the caller); repeats change nothing. Pure, the clock injected: used by gateway.ts;
// unit tests: test/unit/mcp-servers/health.test.ts.

/** ok = nothing known against it; failing = 1..N-1 failures in a row; needs-login / broken = held back (`until`). */
export type HealthState = 'ok' | 'failing' | 'needs-login' | 'broken';
/** auth = refused (401/403); spawn = its program did not start; down = timeout, network, HTTP or protocol error */
export type FailKind = 'auth' | 'spawn' | 'down';

/** Failures in a row (of any kind) that mark a server, by the kind of the last one. */
export const FAILS_TO_MARK: Readonly<Record<FailKind, number>> = { auth: 2, spawn: 2, down: 3 };
const MIN = 60_000, HOUR = 60 * MIN;
/** How long a marked server is held back after its n-th failed probe (the last value repeats). A refused login does not
 *  heal by itself: only a long wait; a dead program or a down service may come back sooner. */
export const BACKOFF_MS: Readonly<Record<'needs-login' | 'broken', readonly number[]>> = {
  'needs-login': [6 * HOUR, 24 * HOUR],
  broken: [15 * MIN, HOUR, 6 * HOUR],
};
/** A probe that never reported (its connection closed by the app) frees the slot after this long. */
export const PROBE_LEASE_MS = 2 * MIN;

export interface ServerHealth {
  state: HealthState;
  /** failures in a row */
  streak: number;
  kind: FailKind | null;
  /** the last failure's message (redacted by the client), for the chat's answer and the notice */
  cause: string;
  /** held back until (marked states only) */
  until: number;
  /** failed probes since it was marked (picks the back-off) */
  probes: number;
  /** when the probe in flight was let through (0 = none) */
  probeAt: number;
}

/** What a failure or a success changed: `to` differs from `from` exactly when the state changed. */
export interface Transition { server: string; from: HealthState; to: HealthState; health: ServerHealth }

const marked = (s: HealthState): s is 'needs-login' | 'broken' => s === 'needs-login' || s === 'broken';
const backoff = (s: 'needs-login' | 'broken', probes: number): number => { const l = BACKOFF_MS[s]; return l[Math.min(probes, l.length - 1)]!; };

export class ConnectorHealth {
  private readonly map = new Map<string, ServerHealth>();
  constructor(private readonly now: () => number = Date.now) {}

  get(server: string): ServerHealth {
    return structuredClone(this.map.get(server) ?? { state: 'ok', streak: 0, kind: null, cause: '', until: 0, probes: 0, probeAt: 0 });
  }

  /** May a new connection to `server` be opened now? A marked server: only once its wait ended, one probe at a time
   *  (the caller reports the probe's outcome with failed/worked). */
  gate(server: string): { open: true; probe: boolean } | { open: false; health: ServerHealth; waitMs: number } {
    const h = this.map.get(server);
    if (!h || !marked(h.state)) return { open: true, probe: false };
    const t = this.now();
    if (t < h.until) return { open: false, health: structuredClone(h), waitMs: h.until - t };
    if (h.probeAt && t - h.probeAt < PROBE_LEASE_MS) return { open: false, health: structuredClone(h), waitMs: PROBE_LEASE_MS - (t - h.probeAt) };
    h.probeAt = t;
    return { open: true, probe: true };
  }

  failed(server: string, kind: FailKind, cause: string): Transition {
    const prev = this.get(server), t = this.now();
    const h: ServerHealth = { ...prev, streak: prev.streak + 1, kind, cause: cause.slice(0, 300), probeAt: 0 };
    if (marked(prev.state)) {
      // a failed probe (or a chat's connection that was already in flight): the same state, a longer wait. A refused
      // access seen on a broken server (or the reverse) is the newer truth.
      // Only a probe lengthens the wait: connections opened before the server was marked fail too, and count for nothing.
      h.state = kind === 'auth' ? 'needs-login' : 'broken';
      if (h.state !== prev.state) { h.probes = 0; h.until = t + backoff(h.state, 0); }
      else if (prev.probeAt) { h.probes = prev.probes + 1; h.until = t + backoff(h.state, h.probes); }
    } else if (h.streak >= FAILS_TO_MARK[kind]) {
      h.state = kind === 'auth' ? 'needs-login' : 'broken';
      h.probes = 0;
      h.until = t + backoff(h.state, 0);
    } else h.state = 'failing';
    this.map.set(server, h);
    return { server, from: prev.state, to: h.state, health: structuredClone(h) };
  }

  /** It listed its tools (or answered a call) on a request made now. */
  worked(server: string): Transition {
    const prev = this.get(server);
    this.map.delete(server);
    return { server, from: prev.state, to: 'ok', health: this.get(server) };
  }

  /** The user acted on it (signed in, a token, an edited definition, «Prova») or it was removed: forgotten. */
  reset(server?: string): void { if (server) this.map.delete(server); else this.map.clear(); }
}

/** The kind of a failure, from the client's error code (anything unknown counts as down). */
export function failKind(code: string | undefined): FailKind {
  return code === 'auth' ? 'auth' : code === 'spawn' ? 'spawn' : 'down';
}

/** "6 h" / "15 min": how long until the next try, as the chat and the notice say it. */
export function waitText(ms: number): string {
  const min = Math.max(1, Math.ceil(ms / MIN));
  return min >= 120 ? `${Math.round(min / 60)} h` : `${min} min`;
}
