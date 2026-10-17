// Account readiness is not model discovery: show installation, login and trust separately; use existing login action.
import type { AgentModelChoice } from '@shared/agents';
import { cliLogin } from '../store/store';

export function AgentReadiness({ choice }: { choice: AgentModelChoice | undefined }) {
  if (!choice) return <p role="status">Disponibilità del motore non ancora verificata.</p>;
  return <div className="agent-readiness" role="status">
    <span>{choice.label}: {!choice.enabled ? 'disattivato' : !choice.trusted ? 'da autorizzare nelle impostazioni' : choice.installed === false ? 'da configurare su questo computer' : choice.authenticated === false ? 'accesso necessario' : choice.installed === true && choice.authenticated === true ? 'installato e con accesso verificato' : 'installazione o accesso da verificare'}</span>
    {choice.enabled && choice.trusted && choice.installed === true && choice.authenticated === false && <button type="button" className="btn btn-ghost" onClick={() => void cliLogin(choice.engine)}>Accedi</button>}
  </div>;
}
