// Pure readiness selection for main and renderer defaults. Explicit off switches and failed login never qualify;
// confirmed login wins over unknown status, while older CLIs with no status protocol remain manually usable.
import type { CliStatus, Harness } from './contract';

export const cliAvailable = (s: CliStatus | null | undefined): boolean => s?.found !== false && s?.loggedIn !== false;
export function availableEngine(ids: readonly Harness[], preferred: Harness | undefined, statuses: Partial<Record<Harness, CliStatus>> | null | undefined): Harness | undefined {
  const candidates = ids.filter(id => cliAvailable(statuses?.[id]));
  const ready = candidates.filter(id => statuses?.[id]?.found && statuses[id]?.loggedIn === true);
  const pool = ready.length ? ready : candidates;
  return preferred && pool.includes(preferred) ? preferred : pool[0];
}
