// Frozen bridge regression: action counting must preserve native bridge descriptors and subscription cleanup.
import {expect,it} from 'vitest';
import type {Bridge} from '../../src/shared/contract';
import {trackBridge} from '../../src/renderer/lib/tracked-bridge';
it('wraps a frozen bridge while preserving counts, receiver, rejection and cleanup',async()=>{
  let count=0,cleaned=false,finish!:(value:unknown)=>void;
  const raw=Object.freeze({invoke:function(this:unknown,channel:string){expect(this).toBe(raw);if(channel==='sync')throw Error('sync');if(channel==='reject')return Promise.reject(Error('reject'));return new Promise(resolve=>{finish=resolve;});},on:function(this:unknown){expect(this).toBe(raw);return()=>{cleaned=true;};}}) as unknown as Bridge;
  const descriptor=Object.getOwnPropertyDescriptor(raw,'invoke');
  const bridge=trackBridge(raw,delta=>{count+=delta;});
  const invoke=bridge.invoke as (channel:string,arg?:unknown)=>Promise<unknown>;
  const pending=invoke('pending');expect(count).toBe(1);finish('done');await expect(pending).resolves.toBe('done');expect(count).toBe(0);
  await expect(invoke('reject')).rejects.toThrow('reject');expect(count).toBe(0);
  expect(()=>invoke('sync')).toThrow('sync');expect(count).toBe(0);
  bridge.on('chat:updated',()=>{})();expect(cleaned).toBe(true);
  expect(Object.isFrozen(raw)).toBe(true);expect(Object.getOwnPropertyDescriptor(raw,'invoke')).toEqual(descriptor);
});
