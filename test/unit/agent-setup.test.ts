// Offline recommendation/migration cases use catalog fixtures, without implicit connections or provider calls.
import { expect, it } from 'vitest';
import type { AgentProfile } from '@shared/agents';
import { emptySetup, recommendedAgents, validSetupStep } from '../../src/renderer/lib/agent-setup';
const profile=(id:string):AgentProfile=>({id,name:id,purpose:'Useful work',instructions:'',engine:'claude',model:null,avatar:{kind:'symbol',value:'briefcase'},createdAt:1,updatedAt:1,role:'',category:'other',tools:null,permissionCeiling:null,origin:{kind:'user'},version:1,activeVersion:1,lastEditedBy:'user',userLocked:true,status:'active'});
const catalog=['general','planning','writing','analysis','research','development'].map(role=>profile(`default-${role}`));
it('starts an offline interview with no assumed work context or connections',()=>{
  expect(emptySetup()).toEqual({step:0,work:'',goals:'',tools:'',style:'balanced',agentIds:[]});
});
it('recommends everyday roles and adds development only for a stated goal',()=>{
  const selected=recommendedAgents({...emptySetup(),work:'independent',goals:'Preparare offerte e confrontare dati'},catalog);
  expect(selected).toEqual(['default-general','default-planning','default-writing','default-analysis']);
  expect(selected).not.toContain('default-development');
  expect(recommendedAgents({...emptySetup(),goals:'sviluppo software'},catalog)).toContain('default-development');
});
it('never invents profiles absent from the real catalog',()=>{
  expect(recommendedAgents({...emptySetup(),goals:'ricerca e analisi dati'},[profile('custom-research')])).toEqual([]);
});
it('restores only a valid interview step from old or malformed state',()=>{
  expect([NaN,-1,90,1.5,3].map(validSetupStep)).toEqual([0,0,4,0,3]);
});
