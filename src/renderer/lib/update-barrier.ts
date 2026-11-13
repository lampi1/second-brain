// Shared by renderer send/drain paths; no dependency on store/store or chat components.
import {createStore} from '../store/createStore';
import type {UpdateSnapshot} from '@shared/app-update';
export const updateRecovery=createStore<{problem:string|null;copy:UpdateSnapshot|null}>({problem:null,copy:null});
export const updateBarrier=createStore<{requestId:string|null}>({requestId:null});
export const updateIsFrozen=()=>updateBarrier.get().requestId!==null;
export const freezeForUpdate=(requestId:string)=>updateBarrier.set({requestId});
export function releaseUpdate(requestId:string){if(updateBarrier.get().requestId===requestId)updateBarrier.set({requestId:null});}
const holds=new Map<symbol,string>();
export function holdUpdate(reason:string):()=>void{const id=Symbol();holds.set(id,reason);return()=>{holds.delete(id);};}
export const updateHoldProblem=()=>holds.values().next().value??null;
