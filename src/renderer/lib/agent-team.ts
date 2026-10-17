// Provider census and observed activity are different facts. Unknown/partial coverage never becomes a fabricated zero.
import type {AgentChildren,ChildObservation} from '@shared/agents';
export function teamLabel(children:AgentChildren|undefined):string{
  if(!children||children.coverage==='unknown')return 'Sottoagenti: dati non disponibili';
  if(children.coverage==='complete'&&children.active!==null&&children.total!==null)return `Sottoagenti: ${children.active} attivi · ${children.total} totali`;
  return `Sottoagenti osservati: ${children.observedActive} attivi · ${children.observedTotal} totali · visione parziale`;
}
export function parentLabel(child:ChildObservation,observations:readonly ChildObservation[]):string{
  if(child.parentNativeId===null)return 'non riportato';
  const parent=observations.find(p=>p.nativeId===child.parentNativeId);
  return parent?parent.task||'attività osservata senza compito riportato':'non presente nelle osservazioni';
}
