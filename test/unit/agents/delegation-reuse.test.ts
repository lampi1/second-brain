// Parent-owned child reuse: guards are checked before mutation; assignment and creation share reserved slots.
import {describe,expect,it,vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
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
  const chats:DelegationChats={list:()=>all,create,assignTask:assign,userEvents:()=>structuredClone(ledger),agentPolicy:()=>({tools:{allow:['read']},ceiling:null}),reportDelegation:()=>({parentId:'parent',delivered:true}),limitNotice:vi.fn(),send:async()=>{},ladderAsk:()=>({asked:'x'}),ladderReply:async()=>({answered:'x',askUser:false})};
  const tools=delegationTools({chats,roles:()=>catalog,settings:()=>DELEGATION_DEFAULTS,engineRefusal:()=>null,label:'[agent]',runs:()=>[]});
  const call=async(name:string,args:Record<string,unknown>,caller='parent')=>JSON.parse(await tools.find(t=>t.name===name)!.run(args,{params:{chatId:caller}} as never) as string);
  const args=()=>({chatId:'child',roleId:'scout',cwd,mode:'continue',expectedVersion:1,expectedEventSeq:1,contract:{goal:'Follow up',output:'Evidence',context:'User constraints',doneWhen:['New criterion']}});
  return {parent,child,catalog,ledger,chats,assign,create,call,args};
}
describe('parent child task continuity',()=>{
  it('reuses a child in whatever folder it works in, also another repository, and refuses a folder that is gone (#460)',async()=>{
    const other=fs.mkdtempSync(path.join(os.tmpdir(),'sb-reuse-other-')), f=fixture();
    f.child.cwd=other;
    const {cwd:_cwd,...rest}=f.args();
    await expect(f.call('agent_assign_task',rest)).resolves.toMatchObject({chatId:'child'});
    fs.rmSync(other,{recursive:true,force:true});
    await expect(f.call('agent_assign_task',rest)).rejects.toThrow(/Cartella non valida: .*non esiste/);
    f.child.parentId='other';
    await expect(f.call('agent_assign_task',f.args())).rejects.toThrow(/YOUR direct children/);
    expect(f.assign).toHaveBeenCalledOnce();
  });
  it('reads full user decisions and reassigns the same child with explicit provenance and cursors',async()=>{
    const f=fixture();
    expect(await f.call('agent_task_events',{chatId:'child'})).toEqual(f.ledger);
    expect(await f.call('agent_assign_task',f.args())).toEqual({chatId:'child',taskId:'task',taskVersion:2,runId:'new',userInstructions:[{seq:1,text:'Keep the user requirement'}],note:expect.stringContaining('not repeated in its prompt'),warnings:[expect.stringContaining('contract.why is missing')]});
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
  it('a parent in any mode reuses its child: the manager narrows the child to it, never a refusal (ADR 0290, 0352)',async()=>{
    for(const mode of ['default','acceptEdits','plan'] as const){
      const f=fixture();
      f.parent.permissionMode=mode;
      expect(await f.call('agent_assign_task',f.args())).toMatchObject({taskVersion:2});
    }
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
  it('refuses another role and scope changes; a card changed since the child started does not stop it (ADR 0352)',async()=>{
    const f=fixture();
    await expect(f.call('agent_assign_task',{...f.args(),roleId:'sentinel'})).rejects.toThrow(/Role mismatch/);
    await expect(f.call('agent_assign_task',{...f.args(),cwd:path.resolve('/elsewhere')})).rejects.toThrow(/Cartella non valida: .*elsewhere: non esiste/);
    expect(f.assign).not.toHaveBeenCalled();
    f.catalog.profiles[1]!.activeVersion=2;
    (f.catalog.profiles[1] as {updatedAt?:number}).updatedAt=5;
    await expect(f.call('agent_assign_task',f.args())).resolves.toMatchObject({chatId:'child'});
  });
  it('its own folder (omitted, or named) reuses the child in place; any other existing folder goes on in a linked chat (ADR 0360)',async()=>{
    const wt=fs.mkdtempSync(path.join(os.tmpdir(),'sb-reuse-wt-')), other=fs.mkdtempSync(path.join(os.tmpdir(),'sb-reuse-to-'));
    for(const cwd of [undefined,wt+path.sep]){
      const f=fixture();f.child.cwd=wt;
      const {cwd:_cwd,...rest}=f.args();
      await expect(f.call('agent_assign_task',cwd===undefined?rest:{...rest,cwd})).resolves.toMatchObject({chatId:'child'});
      expect(f.assign).toHaveBeenCalledOnce();
    }
    const f=fixture();f.child.cwd=wt;
    const linked={...f.child,id:'linked',cwd:other,run:{runId:'r2',taskId:'task',taskVersion:1},folderNotes:['La cartella ha 2 modifiche non committate']} as ChatSummary;
    const elsewhere=vi.fn(async()=>linked);
    f.chats.assignElsewhere=elsewhere;
    const out=await f.call('agent_assign_task',{...f.args(),cwd:other});
    expect(out).toMatchObject({chatId:'linked',continuedFrom:'child',cwd:other});
    expect(out.warnings).toContain('La cartella ha 2 modifiche non committate');
    expect(elsewhere).toHaveBeenCalledWith('child',expect.stringContaining('Follow up'),expect.objectContaining({mode:'continue',doneWhen:['New criterion']}),{cwd:other});
    expect(f.assign).not.toHaveBeenCalled();
    for(const d of [wt,other]) fs.rmSync(d,{recursive:true,force:true});
  });
  it('a child whose role now starts on another engine goes on in a linked chat there (ADR 0359)',async()=>{
    const f=fixture(), elsewhere=vi.fn(async()=>({...f.child,id:'linked',harness:'opencode'}) as ChatSummary);
    f.chats.assignElsewhere=elsewhere;
    let ordered=false, allOut=false;
    const tools=delegationTools({chats:f.chats,roles:()=>f.catalog,settings:()=>DELEGATION_DEFAULTS,engineRefusal:()=>null,label:'[agent]',runs:()=>[],ordered:()=>ordered,
      presetChoice:()=>({preset:'base',model:'gpt',engine:'opencode',route:'OpenAI Sol: primo disponibile',warnings:[],...(allOut?{allOut:true as const}:{})})});
    // no engine order: a reuse stays on its engine while that one can run (ADR 0352); nor onto a level with no room
    const {expectedVersion:_v,...again}=f.args() as Record<string,unknown>;void _v;
    const run=()=>tools.find(t=>t.name==='agent_assign_task')!.run(again,{params:{chatId:'parent'}} as never);
    expect(JSON.parse(await run() as string)).toMatchObject({chatId:'child'});
    ordered=true;allOut=true;
    expect(JSON.parse(await run() as string)).toMatchObject({chatId:'child'});
    expect(elsewhere).not.toHaveBeenCalled();f.assign.mockClear();allOut=false;
    const out=JSON.parse(await run() as string);
    expect(out).toMatchObject({chatId:'linked',continuedFrom:'child',harness:'opencode'});
    expect(elsewhere).toHaveBeenCalledWith('child',expect.any(String),expect.any(Object),{on:{harness:'opencode',model:'gpt',effort:null,route:'OpenAI Sol: primo disponibile'}});
    expect(f.assign).not.toHaveBeenCalled();
  });
  it('has no slot to reserve: a new child starts while a reuse is pending, and the reuse works again after a failure',async()=>{
    const f=fixture();let reject!:(e:Error)=>void;
    f.assign.mockImplementationOnce(()=>new Promise<void>((_resolve,no)=>{reject=no;}));
    const reuse=f.call('agent_assign_task',f.args());
    await Promise.resolve();await Promise.resolve();
    await expect(f.call('agent_delegate',{tasks:[{role:'scout',title:'New child',contract:{goal:'Read',doneWhen:['Evidence']}}]})).resolves.toMatchObject({children:[expect.any(Object)]});
    reject(new Error('Assignment refused'));await expect(reuse).rejects.toThrow(/Assignment refused/);
    await expect(f.call('agent_assign_task',f.args())).resolves.toMatchObject({chatId:'child'});
  });
  it('refuses a role that does not delegate, whatever its saved launches say',async()=>{
    const f=fixture();
    // a stale roles.json: the Scout still lists launches, and the parent runs as a Scout
    (f.catalog.profiles[1] as {launches?:string[]}).launches=['scout'];
    f.parent.agent={...f.parent.agent!,id:'scout'};
    await expect(f.call('agent_delegate',{tasks:[{role:'scout',title:'Nipote',contract:{goal:'Read',doneWhen:['Evidence']}}]})).rejects.toThrow(/does not delegate/);
    await expect(f.call('agent_assign_task',f.args())).rejects.toThrow(/does not delegate|only the Orchestrator and the Strategist/);
    expect(f.create).not.toHaveBeenCalled();
    expect(f.assign).not.toHaveBeenCalled();
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
