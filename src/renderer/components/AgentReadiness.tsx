// Account readiness is not model discovery: show installation, login and trust separately; use existing login action.
import type { AgentModelChoice } from '@shared/agents';
import { cliLogin } from '../store/store';
import{t}from'../i18n';

export function AgentReadiness({ choice }: { choice: AgentModelChoice | undefined }) {
  if (!choice) return <p role="status">{t('readiness.unknown')}</p>;
  return <div className="agent-readiness" role="status">
    <span>{choice.label}: {t(!choice.enabled?'readiness.disabled':!choice.trusted?'readiness.trust':choice.installed===false?'readiness.configure':choice.authenticated===false?'readiness.signIn':choice.installed===true&&choice.authenticated===true?'readiness.ready':'readiness.unchecked')}</span>
    {choice.enabled && choice.trusted && choice.installed === true && choice.authenticated === false && <button type="button" className="btn btn-ghost" onClick={() => void cliLogin(choice.engine)}>{t('readiness.login')}</button>}
  </div>;
}
