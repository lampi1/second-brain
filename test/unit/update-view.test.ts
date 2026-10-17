// Regression coverage for main update capability, malformed state and competing asynchronous responses.
import {expect,it,vi} from 'vitest';
import type {AppUpdateState} from '../../src/shared/app-update';
import {blockedUpdate,connectUpdateView,validUpdateState} from '../../src/renderer/lib/update-view';
const ready:AppUpdateState={available:true,checking:false,checkedAt:1,update:{id:'release-2',version:'2.0.0',changes:['A change'],phase:'ready',blocked:'Protocollo di applicazione non disponibile.'}};
it('keeps main stage-only/unknown capability blocked and never converts missing fields into ready',()=>{
  expect(blockedUpdate(ready,null)?.blocked).toBe(ready.update!.blocked);
  expect(blockedUpdate({...ready,available:false,reason:'Unavailable',update:{...ready.update!,blocked:null}},null)?.blocked).toBe('Unavailable');
  expect(blockedUpdate({...ready,update:{...ready.update!,blocked:null}},'Read failed')?.blocked).toBe('Read failed');
  expect(validUpdateState(null)).toBe(false);expect(validUpdateState({...ready,update:{...ready.update!,blocked:undefined}})).toBe(false);
});
it('blocks after a rejected apply without an event until a valid reread',async()=>{
  let problem:string|null=null;
  const available={...ready,update:{...ready.update!,blocked:null}};
  const connection=connectUpdateView({get:async()=>available,listen:()=>()=>{}},()=>{problem=null;},()=>{problem='State uncertain';});await Promise.resolve();
  await expect(connection.perform(async()=>{throw Error('Disconnected');})).rejects.toThrow('Disconnected');
  expect(blockedUpdate(available,problem)?.blocked).toBe('State uncertain');await connection.refresh();expect(problem).toBeNull();connection.dispose();
});
it('does not replace newer events with initial or action responses and handles malformed data without an unhandled rejection',async()=>{
  let initial!:(state:AppUpdateState)=>void,event!:(state:AppUpdateState)=>void,finish!:(state:AppUpdateState)=>void;
  const render=vi.fn(),failed=vi.fn();const connection=connectUpdateView({get:()=>new Promise(resolve=>{initial=resolve;}),listen:accept=>{event=accept;return()=>{};}},render,failed);
  event(ready);initial({...ready,update:null});await Promise.resolve();expect(render).toHaveBeenCalledTimes(1);
  const pending=connection.perform(()=>new Promise(resolve=>{finish=resolve;}));const newer={...ready,checking:true};event(newer);finish(ready);await pending;expect(render).toHaveBeenLastCalledWith(newer);
  event(null as unknown as AppUpdateState);expect(failed).toHaveBeenCalledOnce();connection.dispose();
});
it('invalidates a reread started before an action rejection',async()=>{
  let reads=0,event!:(state:AppUpdateState)=>void,finishRead!:(state:AppUpdateState)=>void,rejectAction!:(error:Error)=>void;
  const render=vi.fn(),failed=vi.fn();
  const connection=connectUpdateView({get:()=>++reads===1?Promise.resolve(ready):new Promise(resolve=>{finishRead=resolve;}),listen:accept=>{event=accept;return()=>{};}},render,failed);
  await Promise.resolve();
  const action=connection.perform(()=>new Promise((_resolve,reject)=>{rejectAction=reject;}));
  event(null as unknown as AppUpdateState);const reread=connection.refresh();
  rejectAction(Error('Disconnected'));await expect(action).rejects.toThrow('Disconnected');
  const rendered=render.mock.calls.length;finishRead(ready);await reread;
  expect(render).toHaveBeenCalledTimes(rendered);expect(failed).toHaveBeenCalledTimes(2);connection.dispose();
});
