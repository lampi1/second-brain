// Temporary, fail-closed Battito IPC handlers to let the renderer integrate the shared contract.
// Replaced by the persistent service at startup; no stub reports successful actions or spends tokens.
import type { Handlers } from '../ipc';
import type { PulseStatus } from '../../shared/pulse';

type PulseChannels = Extract<keyof Handlers, `pulse:${string}` | `approvals:${string}`>;
export function pulseStubHandlers(): Pick<Handlers, PulseChannels> {
  const error = 'Battito non ancora disponibile.';
  const status = (): PulseStatus => ({
    on: false, engine: null, reason: error, nextSlot: null, running: false,
    canSave: false, saveReason: error, engines: [],
    today: { date: '', runs: 0, usd: 0, limitUsd: 0.25, basis: 'reported', jobs: {
      pulse: { runs: 0, usd: 0, limitUsd: 0.20, maxRuns: 4, basis: 'reported' },
      headline: { runs: 0, usd: 0, limitUsd: 0.05, maxRuns: 24, basis: 'reported' },
    } },
  });
  return {
    'pulse:list': () => ({ cards: [], status: status() }),
    'pulse:status': status,
    'pulse:seen': () => {},
    'pulse:save': () => ({ ok: false, error }),
    'pulse:act': () => ({ ok: false, error }),
    'pulse:dismiss': () => ({ ok: false, error }),
    'pulse:runNow': () => ({ ok: false, error }),
    'approvals:list': () => [],
    'approvals:decide': () => ({ ok: false, error }),
  };
}
