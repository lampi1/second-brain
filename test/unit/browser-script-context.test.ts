// Caller code never executes in these tests. Synthetic CDP contexts/navigation exercise the real guard/dispatcher.
import {expect,it,vi} from 'vitest';
import {ExecutionContexts} from '../../src/main/browser/execution-contexts';
import {TabCdp} from '../../src/main/browser/cdp';
import type {WebContents} from 'electron';
import {localScriptOrigin} from '../../src/main/browser/script-policy';
import {BrowserActions} from '../../src/main/browser/actions';
import type {BrowserTabs,Tab} from '../../src/main/browser/tabs';
const created=(uniqueId:string,origin='http://localhost:3000',id=1)=>({context:{id,uniqueId,origin,auxData:{isDefault:true,frameId:'root'}}});
it('tracks navigation by unique context and does not confuse reused numeric ids',()=>{
  const contexts=new ExecutionContexts();contexts.accept('Runtime.executionContextCreated',created('old'),'');
  const old=contexts.defaultFor('root')!;
  contexts.accept('Runtime.executionContextCreated',created('new','https://remote.invalid',1),'');
  expect(contexts.current(old)).toBe(false);
  contexts.accept('Runtime.executionContextDestroyed',{executionContextId:1,executionContextUniqueId:'old'},'');
  expect(contexts.defaultFor('root')?.uniqueId).toBe('new');
  contexts.accept('Runtime.executionContextsCleared',{},'');expect(contexts.defaultFor('root')).toBeNull();
});
it('admits only exact localhost or literal loopback and refuses aliases/opaque/remote origins',()=>{
  for(const url of ['http://localhost:3000','https://127.0.0.1','http://[::1]'])expect(localScriptOrigin(url),url).toBe(true);
  for(const url of ['http://demo.test','http://app.localhost','http://127.0.0.2','https://localhost.evil.invalid','https://remote.invalid','file:///local','data:text/html,test','null','about:blank'])expect(localScriptOrigin(url),url).toBe(false);
});
function fixture(url='http://localhost:3000/'){
  let human=false;
  const contexts=new ExecutionContexts();contexts.accept('Runtime.executionContextCreated',created('current'),'');
  const frame={url,origin:new URL(url).origin,processId:1,routingId:2,frameTreeNodeId:3,detached:false,isDestroyed:()=>false};
  const send=vi.fn(async(method:string,_args?:Record<string,unknown>)=>method==='Page.getFrameTree'?{frameTree:{frame:{id:'root',url:frame.url}}}:{result:{value:'synthetic result'}});
  const cdp={executionContexts:contexts,send};
  const tab={id:'test',env:'local',wc:{mainFrame:frame,getURL:()=>frame.url,isDestroyed:()=>false},cdp,dialog:null} as unknown as Tab;
  const cancel=vi.fn(),tabs={frames:()=>[frame],handoffs:{openFor:()=>human?{id:'human'}:null},dialogOpened:()=>({promise:new Promise(()=>{}),cancel})} as unknown as BrowserTabs;
  return {actions:new BrowserActions(tabs),frame,send,tab,contexts,cancel,handoff:()=>{human=true;}};
}
it('refuses remote and iframe caller code without dispatching Runtime.evaluate',async()=>{
  const alias=fixture('http://demo.test/');await expect(alias.actions.evaluate(alias.tab,'opaque caller source')).rejects.toThrow('local stacks');expect(alias.send).not.toHaveBeenCalled();
  const remote=fixture('https://remote.invalid/');await expect(remote.actions.evaluate(remote.tab,'opaque caller source')).rejects.toThrow('local stacks');expect(remote.send).not.toHaveBeenCalled();
  const frame=fixture();await expect(frame.actions.evaluate(frame.tab,'opaque caller source','f1')).rejects.toThrow('top page');expect(frame.send).not.toHaveBeenCalled();
});
it('binds a verified local dispatch to uniqueContextId, with no default or numeric fallback',async()=>{
  const f=fixture();expect(await f.actions.evaluate(f.tab,'opaque caller source')).toBe('synthetic result');
  expect(f.send).toHaveBeenCalledWith('Runtime.evaluate',expect.objectContaining({uniqueContextId:'current',expression:'opaque caller source'}));
  const args=f.send.mock.calls.find(call=>call[0]==='Runtime.evaluate')![1]!;expect(args).not.toHaveProperty('contextId');expect(f.cancel).toHaveBeenCalledOnce();
});
it('refuses navigation/context replacement during an awaited metadata read',async()=>{
  const f=fixture();f.send.mockImplementation(async()=>{f.frame.url='https://remote.invalid/';f.frame.origin='https://remote.invalid';f.contexts.accept('Runtime.executionContextsCleared',{},'');return {frameTree:{frame:{id:'root',url:'http://localhost:3000/'}}};});
  await expect(f.actions.evaluate(f.tab,'opaque caller source')).rejects.toThrow();
  expect(f.send.mock.calls.every(call=>call[0]!=='Runtime.evaluate')).toBe(true);
});
it('enables context events before use and discards every context when the debugger detaches',async()=>{
  const listeners=new Map<string,(...args:unknown[])=>void>();
  const sendCommand=vi.fn().mockResolvedValue({});
  const debuggerApi={isAttached:()=>false,attach:vi.fn(),removeListener:vi.fn(),on:(event:string,listener:(...args:unknown[])=>void)=>listeners.set(event,listener),sendCommand};
  const cdp=new TabCdp({isDestroyed:()=>false,debugger:debuggerApi} as unknown as WebContents,()=>{},'synthetic');
  await cdp.attach();expect(sendCommand).toHaveBeenCalledWith('Runtime.enable',{});
  listeners.get('message')!(undefined,'Runtime.executionContextCreated',created('first'),'');
  expect(cdp.executionContexts.defaultFor('root')?.uniqueId).toBe('first');
  listeners.get('detach')!(undefined,'target closed');expect(cdp.executionContexts.defaultFor('root')).toBeNull();
});
it('resumes a paused iframe even when a CDP initialization command never answers',async()=>{
  vi.useFakeTimers();
  const listeners=new Map<string,(...args:unknown[])=>void>();
  const sendCommand=vi.fn((method:string,_params:unknown,sid?:string)=>sid==='child'&&method==='Network.enable'?new Promise(()=>{}):Promise.resolve({}));
  const debuggerApi={isAttached:()=>false,attach:vi.fn(),removeListener:vi.fn(),on:(event:string,listener:(...args:unknown[])=>void)=>listeners.set(event,listener),sendCommand};
  const cdp=new TabCdp({isDestroyed:()=>false,debugger:debuggerApi} as unknown as WebContents,()=>{},'synthetic');
  try {
    await cdp.attach();
    listeners.get('message')!(undefined,'Target.attachedToTarget',{sessionId:'child',targetInfo:{type:'iframe',url:'http://localhost:3000/frame'}});
    await vi.advanceTimersByTimeAsync(2000);
    expect(sendCommand).toHaveBeenCalledWith('Runtime.runIfWaitingForDebugger',{},'child');
    expect(vi.getTimerCount()).toBe(0);
  } finally { cdp.dispose();vi.useRealTimers(); }
});
it('does not dispatch after a user handoff starts during the metadata await',async()=>{
  const f=fixture();f.send.mockImplementation(async()=>{f.handoff();return {frameTree:{frame:{id:'root',url:f.frame.url}}};});
  await expect(f.actions.evaluate(f.tab,'opaque caller source')).rejects.toThrow('user is working');
  expect(f.send.mock.calls.every(call=>call[0]!=='Runtime.evaluate')).toBe(true);expect(f.cancel).toHaveBeenCalledOnce();
});
it('keeps root and child sessions separate even when their numeric/frame ids match',()=>{
  const contexts=new ExecutionContexts();
  contexts.accept('Runtime.executionContextCreated',created('root-local'),'');
  contexts.accept('Runtime.executionContextCreated',created('child-remote','https://remote.invalid'),'child-session');
  expect(contexts.defaultFor('root')?.uniqueId).toBe('root-local');
  contexts.clear('child-session');expect(contexts.defaultFor('root')?.uniqueId).toBe('root-local');
});
