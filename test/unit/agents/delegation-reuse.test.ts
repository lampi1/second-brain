// Parent-owned child reuse: guards are checked before mutation; assignment and creation share reserved slots.
import {describe,expect,it,vi} from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {gitWorktrees} from '../../../src/main/agents/worktrees';
import {delegationTools, type DelegationChats, type DelegationDeps} from '../../../src/main/agents/delegation';
import type {ChatSummary} from '../../../src/shared/contract';
import type {AgentCatalog, UserTaskEvents} from '../../../src/shared/agents';
import type {TaskAssignmentOptions} from '../../../src/shared/delegation';
import {DELEGATION_DEFAULTS} from '../../../src/shared/roles';

function fixture(worktrees: DelegationDeps['worktrees'] = async()=>[]) {
  const cwd=path.resolve('/repo');
  const parent={id:'parent',title:'Parent',cwd,harness:'claude',state:'idle',permissionMode:null,pending:0,agent:{id:'strategist',source:'catalog',version:1},run:{runId:'p',taskVersion:1}} as ChatSummary;
  const child={id:'child',title:'Child',cwd,harness:'claude',state:'closed',closedAt:1,permissionMode:null,pending:0,parentId:'parent',agent:{id:'scout',source:'catalog',version:1},run:{runId:'old',taskId:'task',taskVersion:1},delegation:{role:'scout',goal:'Old',doneWhen:['Old criterion'],at:1,result:{outcome:'done',summary:'Old result',at:2}}} as ChatSummary;
  const all=[parent,child];
  const catalog={profiles:[{id:'strategist',name:'Strategist',launches:['scout','sentinel'],activeVersion:1,engine:'claude',tools:{allow:['read']},skills:[]},{id:'scout',name:'Scout',activeVersion:1,engine:'claude',tools:{allow:['read']},skills:[]}]} as unknown as AgentCatalog;
  const ledger:UserTaskEvents={events:[{id:'decision',seq:1,at:2,text:'Keep the user requirement'}],latestSeq:1,acknowledgedSeq:0};
  const assign=vi.fn(async (_id:string,_prompt:string,_options:TaskAssignmentOptions)=>{ child.run={...child.run!,runId:'new',taskVersion:2}; });
  const create=vi.fn(async()=>child);
  const chats:DelegationChats={list:()=>all,create,assignTask:assign,userEvents:()=>structuredClone(ledger),agentPolicy:()=>({tools:{allow:['read']},ceiling:null}),reportDelegation:()=>({parentId:'parent',delivered:true}),limitNotice:vi.fn(),send:async()=>{}};
  const tools=delegationTools({chats,roles:()=>catalog,settings:()=>({...DELEGATION_DEFAULTS,maxParallel:1}),engineRefusal:()=>null,label:'[agent]',runs:()=>[],worktrees});
  const call=async(name:string,args:Record<string,unknown>,caller='parent')=>JSON.parse(await tools.find(t=>t.name===name)!.run(args,{params:{chatId:caller}} as never) as string);
  const args=()=>({chatId:'child',roleId:'scout',cwd,mode:'continue',expectedVersion:1,expectedEventSeq:1,contract:{goal:'Follow up',output:'Evidence',context:'User constraints',doneWhen:['New criterion']}});
  return {parent,child,catalog,ledger,chats,assign,create,call,args};
}
describe('parent child task continuity',()=>{
  it('looks up only the owned child folder and rejects ownership before Git discovery',async()=>{
    const lookup=vi.fn(async()=>[] as string[]), f=fixture(lookup);
    await f.call('agent_assign_task',f.args());
    expect(lookup).toHaveBeenCalledExactlyOnceWith(f.parent.cwd,f.child.cwd);
    lookup.mockClear();f.child.parentId='other';
    await expect(f.call('agent_assign_task',f.args())).rejects.toThrow(/YOUR direct children/);
    expect(lookup).not.toHaveBeenCalled();
  });
  it('refuses a child folder change during targeted discovery before assigning',async()=>{
    let finish!:(trees:string[])=>void;
    const f=fixture(()=>new Promise(resolve=>{finish=resolve;}));
    const pending=f.call('agent_assign_task',f.args());
    f.child.cwd=path.resolve('/changed');finish([]);
    await expect(pending).rejects.toThrow(/Child project changed/);
    expect(f.assign).not.toHaveBeenCalled();
  });
  it('reads full user decisions and reassigns the same child with explicit provenance and cursors',async()=>{
    const f=fixture();
    expect(await f.call('agent_task_events',{chatId:'child'})).toEqual(f.ledger);
    expect(await f.call('agent_assign_task',f.args())).toEqual({chatId:'child',taskId:'task',taskVersion:2,runId:'new',userInstructions:[{seq:1,text:'Keep the user requirement'}],note:expect.stringContaining('not repeated in its prompt')});
    expect(f.assign).toHaveBeenCalledWith('child',expect.stringContaining('Context: User constraints'),expect.objectContaining({mode:'continue',expectedVersion:1,expectedEventSeq:1,doneWhen:['New criterion'],source:{kind:'chat',chatId:'parent'}}));
    expect(f.create).not.toHaveBeenCalled();
  });
  it('assigns without expectedVersion or expectedEventSeq: the current version, the user\'s words returned to the parent',async()=>{
    const f=fixture();
    const {expectedVersion:_v,expectedEventSeq:_e,...bare}=f.args();
    expect(await f.call('agent_assign_task',bare)).toMatchObject({taskVersion:2,userInstructions:[{seq:1,text:'Keep the user requirement'}]});
    const options=f.assign.mock.calls[0]![2];
    expect(options.expectedVersion).toBe(1);
    expect(options).not.toHaveProperty('expectedEventSeq');
  });
  it('returns the user\'s panel answers readable, never as JSON, and keeps them out of the child\'s prompt',async()=>{
    const f=fixture();
    f.ledger.events.push({id:'answer',seq:2,at:3,text:JSON.stringify({requestId:'q1',answers:['ultimi 7 giorni']})});f.ledger.latestSeq=2;
    const out=await f.call('agent_assign_task',f.args());
    expect(out.userInstructions).toEqual([{seq:1,text:'Keep the user requirement'},{seq:2,text:'Answer to a question: ultimi 7 giorni'}]);
    const prompt=f.assign.mock.calls[0]![1];
    expect(prompt).not.toContain('Keep the user requirement');
    expect(prompt).not.toContain('ultimi 7 giorni');
  });
  it('refuses other parents, bad cursors and changing a reused contract policy',async()=>{
    const f=fixture();
    f.child.parentId='other';
    await expect(f.call('agent_task_events',{chatId:'child'})).rejects.toThrow(/YOUR direct children/);
    await expect(f.call('agent_assign_task',f.args())).rejects.toThrow(/YOUR direct children/);
    f.child.parentId='parent';
    await expect(f.call('agent_assign_task',{...f.args(),expectedEventSeq:-1})).rejects.toThrow(/event cursor/);
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
    // a change in place (same version, ADR 0186) moves the revision: a fresh chat too
    (f.catalog.profiles[1] as {updatedAt?:number}).updatedAt=5;
    await expect(f.call('agent_assign_task',f.args())).rejects.toThrow(/configuration changed/);
    delete (f.catalog.profiles[1] as {updatedAt?:number}).updatedAt;
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
  it('reassigns an own child in a sibling worktree of the same real repository, never another repo or an unlisted folder',async()=>{
    const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'sb-reuse-')));
    try {
      const git=(cwd:string,...a:string[])=>execFileSync('git',['-C',cwd,...a],{encoding:'utf8',stdio:'pipe'});
      const init=(dir:string)=>{fs.mkdirSync(dir);git(dir,'init','-q','-b','main');fs.writeFileSync(path.join(dir,'a.txt'),'a\n');git(dir,'add','.');git(dir,'-c','user.name=T','-c','user.email=t@example.com','commit','-qm','init');};
      const repo=path.join(root,'repo'),foreign=path.join(root,'foreign'),loose=path.join(root,'.second-brain-delegate-loose');
      init(repo);init(foreign);fs.mkdirSync(loose);
      // the host allocates delegate worktrees as siblings of the checkout (agents/worktrees.ts createIsolatedWorktree)
      const wt=path.join(root,'.second-brain-delegate-x');git(repo,'worktree','add','-q','-b','sb/x',wt);
      const f=fixture(gitWorktrees);f.parent.cwd=repo;
      const at=(cwd:string)=>{f.child.cwd=cwd;return f.call('agent_assign_task',{...f.args(),cwd,expectedVersion:f.child.run!.taskVersion});};
      for(const cwd of [foreign,loose]) await expect(at(cwd)).rejects.toThrow(/Project mismatch/);
      expect(f.assign).not.toHaveBeenCalled();
      await expect(at(wt)).resolves.toMatchObject({chatId:'child'});
      f.child.parentId='other';
      await expect(at(wt)).rejects.toThrow(/YOUR direct children/);
      expect(f.assign).toHaveBeenCalledOnce();
    } finally { fs.rmSync(root,{recursive:true,force:true}); }
  });
});
