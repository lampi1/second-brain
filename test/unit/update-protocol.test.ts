// Validate the installed writer/state boundary and exact consent arguments without running an update or subprocess.
import path from 'node:path';
import {expect,it} from 'vitest';
import {parseUpdateStatus,updateApplyArgs,updateRollbackArgs} from '../../src/main/update/protocol';

const base=path.resolve('offline-release-root');
const candidate={id:'new',version:'1.1.0',source:'a'.repeat(40),manifestSha256:'b'.repeat(64)};
const state={base,writerProtocol:1,stateProtocol:1,lock:null,current:'old',previous:null,staged:[candidate]};
const parse=(value:unknown)=>parseUpdateStatus(JSON.stringify(value),base);
it('requires both managed state and supported writer with an explicit absent lock',()=>{
  expect(parse(state)).toEqual({protocol:2,current:'old',previous:null,staged:[candidate]});
  for(const altered of [{writerProtocol:0},{stateProtocol:0},{writerProtocol:2},{lock:{}},{lock:undefined},{stateProtocol:undefined}])expect(()=>parse({...state,...altered})).toThrow();
});
it('rejects wrong root and invalid marker identities before any action can be offered',()=>{
  expect(()=>parse({...state,base:path.resolve('another-root')})).toThrow();
  for(const altered of [{id:'../bad'},{manifestSha256:'bad'},{source:'bad'},{version:'not-semver'}])expect(()=>parse({...state,staged:[{...candidate,...altered}]})).toThrow();
  expect(()=>parse({...state,current:'../bad'})).toThrow();
});
it('pins the exact approved manifest and running current; rollback always pins target and previous',()=>{
  expect(updateApplyArgs(candidate,'old')).toEqual(['apply-update','new','b'.repeat(64),'old']);
  expect(updateRollbackArgs('new','old')).toEqual(['rollback-if','new','old']);
  expect(()=>updateApplyArgs({...candidate,manifestSha256:''},'old')).toThrow();
  expect(()=>updateApplyArgs(candidate,'--bad')).toThrow();
  expect(()=>updateRollbackArgs('new','../old')).toThrow();
});
