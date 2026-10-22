// Parent-owned child reuse: guards are checked before mutation; assignment and creation share reserved slots.
import {describe,expect,it,vi} from 'vitest';
import path from 'node:path';
import {delegationTools, type DelegationChats} from '../../../src/main/agents/delegation';
import type {ChatSummary} from '../../../src/shared/contract';
import type {AgentCatalog, UserTaskEvents} from '../../../src/shared/agents';
import type {TaskAssignmentOptions} from '../../../src/shared/delegation';
import {DELEGATION_DEFAULTS} from '../../../src/shared/roles';

function fixture() {
  const cwd=path.resolve('/repo');
  const parent={id:'parent',title:'Parent',cwd,harness:'claude',state:'idle',permissionMode:null,pending:0,agent:{id:'strategist',source:'catalog',version:1},run:{runId:'p',taskVersion:1}} as ChatSummary;
  const child={id:'child',title:'Child',cwd,harness:'claude',state:'closed',closedAt:1,permissionMode:null,pending:0,parentId:'parent',agent:{id:'scout',source:'catalog',version:1},run:{runId:'old',taskId:'task',taskVersion:1},delegation:{role:'scout',goal:'Old',doneWhen:['Old criterion'],at:1,result:{outcome:'done',summary:'Old result',at:2}}} as ChatSummary;
  const all=[parent,child];
  const catalog={profiles:[{id:'strategist',name:'Strategist',launches:['scout','sentinel'],activeVersion:1,engine:'claude',tools:{allow:['read']},skills:[]},{id:'scout',name:'Scout',activeVersion:1,engine:'claude',tools:{allow:['read']},skills:[]}]} as unknown as AgentCatalog;
  const ledger:UserTaskEvents={events:[{id:'decision',seq:1,at:2,text:'Keep the user requirement'}],latestSeq:1,acknowledgedSeq:0};
  const assign=vi.fn(async (_id:string,_prompt:string,_options:TaskAssignmentOptions)=>{ child.run={...child.run!,runId:'new',taskVersion:2}; });
  const create=vi.fn(async()=>child);
  const chats:DelegationChats={list:()=>all,create,assignTask:assign,userEvents:()=>structuredClone(ledger),agentPolicy:()=>({tools:{allow:['read']},ceiling:null}),reportDelegation:()=>({parentId:'parent',delivered:true}),limitNotice:vi.fn(),send:async()=>{}};
  const tools=delegationTools({chats,roles:()=>catalog,settings:()=>({...DELEGATION_DEFAULTS,maxParallel:1}),engineRefusal:()=>null,label:'[agent]',runs:()=>[],worktrees:async()=>[]});
  const call=async(name:string,args:Record<string,unknown>,caller='parent')=>JSON.parse(await tools.find(t=>t.name===name)!.run(args,{params:{chatId:caller}} as never) as string);
  const args=()=>({chatId:'child',roleId:'scout',cwd,mode:'continue',expectedVersion:1,expectedEventSeq:1,contract:{goal:'Follow up',output:'Evidence',context:'User constraints',doneWhen:['New criterion']}});
  return {parent,child,catalog,ledger,chats,assign,create,call,args};
}
describe('parent child task continuity',()=>{
  it('reads full user decisions and reassigns the same child with explicit provenance and cursors',async()=>{
    const f=fixture();
    expect(await f.call('agent_task_events',{chatId:'child'})).toEqual(f.ledger);
    expect(await f.call('agent_assign_task',f.args())).toEqual({chatId:'child',taskId:'task',taskVersion:2,runId:'new'});
    expect(f.assign).toHaveBeenCalledWith('child',expect.stringContaining('Context: User constraints'),expect.objectContaining({mode:'continue',expectedVersion:1,expectedEventSeq:1,doneWhen:['New criterion'],source:{kind:'chat',chatId:'parent'}}));
    expect(f.create).not.toHaveBeenCalled();
  });
  it('refuses other parents, stale cursors and changing a reused contract policy',async()=>{
    const f=fixture();
    f.child.parentId='other';
    await expect(f.call('agent_task_events',{chatId:'child'})).rejects.toThrow(/YOUR direct children/);
    await expect(f.call('agent_assign_task',f.args())).rejects.toThrow(/YOUR direct children/);
    f.child.parentId='parent';
    await expect(f.call('agent_assign_task',{...f.args(),expectedEventSeq:0})).rejects.toThrow(/agent_task_events/);
    await expect(f.call('agent_assign_task',{...f.args(),expectedVersion:2})).rejects.toThrow(/version/);
    for(const field of ['tools','skills','tier']) await expect(f.call('agent_assign_task',{...f.args(),contract:{...f.args().contract,[field]:[]}})).rejects.toThrow(/fresh chat/);
    expect(f.assign).not.toHaveBeenCalled();
  });
  it('keeps closed and reported parent guards actionable, including delegation',async()=>{
    const f=fixture();f.parent.closedAt=1;
    await expect(f.call('agent_assign_task',f.args())).rejects.toThrow(/app_assign_task/);
    await expect(f.call('agent_delegate',{tasks:[]})).rejects.toThrow(/app_assign_task/);
    delete f.parent.closedAt;f.parent.parentId='grandparent';f.parent.run!.endedAt=3;
    await expect(f.call('agent_assign_task',f.args())).rejects.toThrow(/agent_assign_task/);
    expect(f.assign).not.toHaveBeenCalled();
  });
  it('refuses stale role configuration, Sentinel reuse, scope changes and current permission narrowing',async()=>{
    const f=fixture();
    f.catalog.profiles[1]!.activeVersion=2;
    await expect(f.call('agent_assign_task',f.args())).rejects.toThrow(/configuration changed/);
    f.catalog.profiles[1]!.activeVersion=1;
    await expect(f.call('agent_assign_task',{...f.args(),roleId:'sentinel'})).rejects.toThrow(/Sentinel/);
    await expect(f.call('agent_assign_task',{...f.args(),cwd:path.resolve('/elsewhere')})).rejects.toThrow(/Project mismatch/);
    f.parent.permissionMode='plan';
    await expect(f.call('agent_assign_task',f.args())).rejects.toThrow(/permissions exceed/);
    expect(f.assign).not.toHaveBeenCalled();
  });
  it('reserves the last slot across reuse and creation, releases it after failure',async()=>{
    const f=fixture();let reject!:(e:Error)=>void;
    f.assign.mockImplementationOnce(()=>new Promise<void>((_resolve,no)=>{reject=no;}));
    const reuse=f.call('agent_assign_task',f.args());
    // Flush the worktree lookup, without timers or a runtime engine.
    await Promise.resolve();await Promise.resolve();
    await expect(f.call('agent_delegate',{tasks:[{role:'scout',title:'New child',contract:{goal:'Read',doneWhen:['Evidence']}}]})).rejects.toThrow(/already running/);
    reject(new Error('Assignment refused'));await expect(reuse).rejects.toThrow(/Assignment refused/);
    await expect(f.call('agent_assign_task',f.args())).resolves.toMatchObject({chatId:'child'});
  });
  it('passes approved step identity into the atomic assignment and refuses unapproved plans',async()=>{
    const f=fixture();
    f.chats.planOf=()=>({phase:'proposed',steps:[],at:1} as never);
    await expect(f.call('agent_assign_task',f.args())).rejects.toThrow(/not approved/);
    f.chats.planOf=()=>({phase:'running',steps:[{title:'Read',state:'todo',chatIds:[]}],at:1} as never);
    await f.call('agent_assign_task',{...f.args(),step:1});
    expect(f.assign).toHaveBeenCalledWith('child',expect.any(String),expect.objectContaining({planStep:0}));
  });
});
