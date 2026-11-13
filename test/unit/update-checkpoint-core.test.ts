// src/renderer/lib/update-checkpoint-core.ts: the UI snapshot kept across an update (allowed keys, size, freeze/release).
import {expect,it,vi} from 'vitest';
import {UPDATE_SNAPSHOT_KEYS,type UpdateSnapshot} from '../../src/shared/app-update';
import {adoptUpdateRecovery,createCheckpointCoordinator,validateUpdateSnapshot} from '../../src/renderer/lib/update-checkpoint-core';
const snapshot=()=>Object.fromEntries(UPDATE_SNAPSHOT_KEYS.map(key=>[key,'null'])) as UpdateSnapshot;
it('allows only five JSON namespaces and enforces UTF8 bytes including record overhead',()=>{
  expect(validateUpdateSnapshot(snapshot())).toEqual(snapshot());
  expect(()=>validateUpdateSnapshot({...snapshot(),token:'"secret"'})).toThrow('campi');
  expect(()=>validateUpdateSnapshot({...snapshot(),'sb.read.v1':'not JSON'})).toThrow('leggibile');
  expect(()=>validateUpdateSnapshot(snapshot(),20)).toThrow('limite');
});
it('freezes before async flush, refuses a nonempty queue and holds until matching release',async()=>{
  const freeze=vi.fn(),release=vi.fn(),answer=vi.fn(),flush=vi.fn();
  const coordinator=createCheckpointCoordinator({freeze,release,answer,flush,problem:()=> 'Ci sono messaggi in coda.',snapshot});
  await coordinator.request({requestId:'a',maxBytes:8000000});
  expect(freeze).toHaveBeenCalledWith('a');expect(flush).not.toHaveBeenCalled();expect(answer).toHaveBeenCalledWith({requestId:'a',problem:'Ci sono messaggi in coda.'});expect(release).not.toHaveBeenCalled();
  coordinator.release('old');expect(release).not.toHaveBeenCalled();coordinator.release('a');expect(release).toHaveBeenCalledOnce();
});
it('ignores duplicate requests and never sends an ACK after release during a pending flush',async()=>{
  let done!:()=>void;const answer=vi.fn(),flush=vi.fn(()=>new Promise<void>(resolve=>{done=resolve;}));
  const coordinator=createCheckpointCoordinator({freeze:vi.fn(),release:vi.fn(),answer,flush,problem:()=>null,snapshot});
  const pending=coordinator.request({requestId:'a',maxBytes:8000000});await coordinator.request({requestId:'a',maxBytes:8000000});
  coordinator.release('a');done();await pending;expect(answer).not.toHaveBeenCalled();expect(flush).toHaveBeenCalledOnce();
});
it('adopts only after exact durable writes, preserving newer edits and retaining backup on storage failure',()=>{
  const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
  const adopt=vi.fn();adoptUpdateRecovery(snapshot(),storage,()=>{},adopt);expect(adopt).toHaveBeenCalledOnce();
  values.set('sb.prefs.v1','{"newer":true}');expect(()=>adoptUpdateRecovery(snapshot(),storage,()=>{},adopt)).toThrow('recenti');expect(values.get('sb.prefs.v1')).toContain('newer');
  values.clear();const fail={...storage,setItem:(key:string,value:string)=>{if(key==='sb.read.v1')throw Error('quota');storage.setItem(key,value);}};
  expect(()=>adoptUpdateRecovery(snapshot(),fail,()=>{},adopt)).toThrow('quota');expect(values.size).toBe(0);expect(adopt).toHaveBeenCalledOnce();
});
