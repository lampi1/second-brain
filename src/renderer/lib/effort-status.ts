// Honest effort labels: requested/submitted are not evidence of a provider's effective setting.
import type { ChatEffortStatus } from '@shared/effort';

const display = (value: string | null) => value === null ? 'non riportato' : value.slice(0, 40);
export function effortSummary(status: ChatEffortStatus) {
  const known = status.effectiveSource === 'provider' && status.effective !== null;
  const pending=status.pending ? `Prossimo turno: ${status.requested ?? 'default del motore'}` : null;
  return {
    active: known ? display(status.effective) : 'non riportato',
    requested: status.requested ?? 'default del motore',
    submitted: status.submitted === null ? 'non riportato' : display(status.submitted),
    sessionDefault: status.sessionDefault === null ? 'non riportato' : display(status.sessionDefault),
    badge: known ? `Attivo: ${display(status.effective)}` : status.supported ? 'Attivo: non riportato' : 'Ragionamento: non supportato',
    pending,
    compactBadge:known?`Attivo: ${display(status.effective)}${pending?` · ${pending}`:''}`:pending,
  };
}
