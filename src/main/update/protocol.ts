// Strict adapter for the cooperative release writer protocol. Renderer values never become CLI paths or commands.
import path from 'node:path';
import type {StagedUpdate,UpdateStatus} from './service';

const ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const SHA = /^[a-f0-9]{64}$/;
const SOURCE = /^[a-f0-9]{40}$/;
export function parseUpdateStatus(text:string,base:string):UpdateStatus {
  const raw = JSON.parse(text) as Record<string,unknown>;
  const samePath = (a:string,b:string):boolean => process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
  if(!raw||typeof raw.base!=='string'||!samePath(path.resolve(raw.base),base)||!Array.isArray(raw.staged)||raw.staged.length>256||
    ![raw.current,raw.previous].every(value=>value===null||typeof value==='string'&&ID.test(value)))throw Error('Stato locale degli aggiornamenti non verificabile.');
  // A newer executable alone cannot upgrade legacy state or prove that another writer is absent.
  if(raw.writerProtocol!==1||raw.stateProtocol!==1||raw.lock!==null)throw Error('Installazione precedente o modifica in corso: aggiornamento automatico non disponibile.');
  const staged = raw.staged.map(value=>{
    const row = value as StagedUpdate;
    if(!row||typeof row.id!=='string'||typeof row.version!=='string'||typeof row.source!=='string'||typeof row.manifestSha256!=='string'||!ID.test(row.id)||!/^\d+\.\d+\.\d+$/.test(row.version)||!SOURCE.test(row.source)||!SHA.test(row.manifestSha256))throw Error('Indicatore del pacchetto non valido.');
    return {id:row.id,version:row.version,source:row.source,manifestSha256:row.manifestSha256};
  });
  return {protocol:2,current:raw.current as string|null,previous:raw.previous as string|null,staged};
}
export function updateApplyArgs(candidate:StagedUpdate,expectedCurrent:string):string[] {
  if(!ID.test(candidate.id)||!SHA.test(candidate.manifestSha256)||!ID.test(expectedCurrent))throw Error('Identità del consenso non valida.');
  return ['apply-update',candidate.id,candidate.manifestSha256,expectedCurrent];
}
export function updateRollbackArgs(expectedTarget:string,expectedPrevious:string):string[] {
  if(!ID.test(expectedTarget)||!ID.test(expectedPrevious))throw Error('Identità del ripristino non valida.');
  return ['rollback-if',expectedTarget,expectedPrevious];
}
