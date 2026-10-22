// Provider census and observed activity are different facts. Unknown/partial coverage never becomes a fabricated zero.
import type {AgentChildren,ChildObservation} from '@shared/agents';
import {t} from '../i18n';
export function teamLabel(children:AgentChildren|undefined):string{
  if(!children||children.coverage==='unknown')return t('appText.agentTeam.unknown');
  if(children.coverage==='complete'&&children.active!==null&&children.total!==null)return t('appText.agentTeam.complete', { active: children.active, total: children.total });
  return t('appText.agentTeam.partial', { active: children.observedActive, total: children.observedTotal });
}
export function parentLabel(child:ChildObservation,observations:readonly ChildObservation[]):string{
  if(child.parentNativeId===null)return t('appText.agentTeam.notReported');
  const parent=observations.find(p=>p.nativeId===child.parentNativeId);
  return parent?parent.task||t('appText.agentTeam.noTask'):t('appText.agentTeam.notObserved');
}
