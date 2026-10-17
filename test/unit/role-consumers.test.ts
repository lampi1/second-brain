// Saved role compositions drive actual page references and ordered agent suggestions without altering profiles or policy.
import{expect,it}from'vitest';
import type{AgentCatalog,AgentProfile,AgentModelChoice}from'../../src/shared/agents';
import{rolePreview}from'../../src/renderer/lib/role-preferences';
import{activeRole,roleAgents,profileCanStart}from'../../src/renderer/lib/role-consumers';
import{initialRolePresets}from'../../src/shared/role-preset-catalog';
const pages=[...new Set(initialRolePresets().flatMap(role=>role.pageIds))];
const profiles=['general','development','research','planning','analysis','writing'].map(id=>({id:'default-'+id,name:id,engine:'claude',model:null}as AgentProfile));
const catalog={profiles,archived:[]}as unknown as AgentCatalog;
it('Dev suggests its primary agent first and changes navigation references, with common Home kept separate',()=>{
 const raw=rolePreview(undefined,'dev',{pageIds:pages,agentIds:profiles.map(profile=>profile.id)}).next;
 expect(roleAgents(raw,catalog,pages).map(profile=>profile.id)).toEqual(['default-development','default-research','default-planning']);
 expect(activeRole(raw,catalog,pages)?.pageIds).toContain('procedure');expect(activeRole(raw,catalog,pages)?.pageIds).not.toContain('costi');
 expect(profiles[1]?.model).toBeNull();
});
it('preserves customized membership and never invents a missing catalog profile',()=>{
 const raw=rolePreview(undefined,'dev',{pageIds:pages,agentIds:profiles.map(profile=>profile.id)}).next;
 raw.overrides={addPageIds:['costi'],addAgentIds:['default-writing'],defaults:{primaryAgentId:'default-writing'}};
 expect(roleAgents(raw,catalog,pages)[0]?.id).toBe('default-writing');expect(activeRole(raw,catalog,pages)?.pageIds).toContain('costi');
 expect(activeRole(raw,{profiles:[],archived:[]}as unknown as AgentCatalog,pages)).toBeNull();expect(roleAgents(raw,null,pages)).toEqual([]);
});
it('keeps a role whose agent is archived and suggests only launchable agents',()=>{
 const raw=rolePreview(undefined,'dev',{pageIds:pages,agentIds:profiles.map(profile=>profile.id)}).next;
 const archived={profiles:profiles.filter(profile=>profile.id!=='default-research'),archived:profiles.filter(profile=>profile.id==='default-research')}as unknown as AgentCatalog;
 expect(activeRole(raw,archived,pages)?.agentIds).toContain('default-research');
 expect(roleAgents(raw,archived,pages).map(profile=>profile.id)).toEqual(['default-development','default-planning']);
});
it('keeps legacy navigation recoverable for invalid selections and proposes the real general profile without a role',()=>{
 expect(activeRole({presetId:'missing'},catalog,pages)).toBeNull();expect(roleAgents(undefined,catalog,pages)[0]?.id).toBe('default-general');
});
it('matches known start capabilities without turning unknown installation into a false denial',()=>{
 const profile={...profiles[0]!,model:null},choice={enabled:true,trusted:true,installed:null,authenticated:null,defaultModel:true,modelSelectable:true,models:[{id:'known',name:'Known'}],effort:true}as AgentModelChoice;
 expect(profileCanStart(profile,choice)).toBe(true);
 expect(profileCanStart({...profile,model:'removed'},choice)).toBe(false);
 expect(profileCanStart(profile,{...choice,defaultModel:false})).toBe(false);
 expect(profileCanStart({...profile,effort:'medium'},{...choice,effort:false})).toBe(false);
 expect(profileCanStart(profile,{...choice,enabled:false})).toBe(false);
 expect(profileCanStart(undefined,choice)).toBe(false);
});
