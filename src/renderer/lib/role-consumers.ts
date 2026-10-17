// Resolve saved role references for navigation and new-chat suggestions; never grants engine permissions.
import type {AgentCatalog,AgentProfile,AgentModelChoice} from '@shared/agents';
import {savedRole} from './role-preferences';
export function activeRole(raw:unknown,catalog:AgentCatalog|null,pageIds:readonly string[]){
 if(raw===undefined||!catalog)return null;
 try{return savedRole(raw,{agentIds:catalog.profiles.map(profile=>profile.id),pageIds}).resolved;}catch{return null;}
}
export function roleAgents(raw:unknown,catalog:AgentCatalog|null,pageIds:readonly string[]){
 if(!catalog)return[];
 const role=activeRole(raw,catalog,pageIds);
 const ids=role?[role.defaults.primaryAgentId,...role.agentIds.filter(id=>id!==role.defaults.primaryAgentId)]:['default-general'];
 return ids.flatMap(id=>catalog.profiles.find(profile=>profile.id===id)??[]);
}
export function profileCanStart(profile:AgentProfile|undefined,choice:AgentModelChoice|undefined):boolean{
 return !!profile&&!!choice&&choice.enabled&&choice.trusted&&choice.installed!==false&&choice.authenticated!==false&&
  (profile.model?choice.modelSelectable&&choice.models.some(model=>model.id===profile.model):choice.defaultModel)&&(!profile.effort||choice.effort);
}
