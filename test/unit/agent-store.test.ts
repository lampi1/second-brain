// Delayed typed IPC responses exercise the actual store's save/read ordering without providers or disk.
import { beforeEach, expect, it, vi } from 'vitest';
import type { SetupState } from '@shared/agents';
const bridge=vi.hoisted(()=>({invoke:vi.fn(),on:vi.fn()}));
vi.mock('../../src/renderer/sb',()=>({sb:bridge}));
import { agents, refreshSetup, saveSetup } from '../../src/renderer/store/agents';
import { emptySetup } from '../../src/renderer/lib/agent-setup';
const state=(status:SetupState['status']):SetupState=>({version:1,status,preferences:emptySetup(),updatedAt:1});
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{promise,resolve};};
beforeEach(()=>{bridge.invoke.mockReset();agents.set({catalog:null,setup:null,error:null});});
it('does not let a read begun during a save replace its completed state',async()=>{
  const write=deferred<SetupState>(), read=deferred<SetupState>();
  bridge.invoke.mockImplementation((channel:string)=>channel==='setup:save'?write.promise:read.promise);
  const saving=saveSetup(emptySetup(),'completed');
  await Promise.resolve();
  const refreshing=refreshSetup();
  write.resolve(state('completed'));await saving;
  read.resolve(state('draft'));await refreshing;
  expect(agents.get().setup?.status).toBe('completed');
});
it('serializes a draft and terminal completion so the final write wins',async()=>{
  const draft=deferred<SetupState>();
  bridge.invoke.mockImplementation((_channel:string,args:{status:string})=>args.status==='draft'?draft.promise:Promise.resolve(state('completed')));
  const first=saveSetup(emptySetup(),'draft'),second=saveSetup({...emptySetup(),goals:'finish'},'completed');
  await Promise.resolve();await Promise.resolve();
  expect(bridge.invoke).toHaveBeenCalledTimes(1);
  draft.resolve(state('draft'));await first;await second;
  expect(agents.get().setup?.status).toBe('completed');
});
