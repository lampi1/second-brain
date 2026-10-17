// Unknown observability must not become a fabricated empty team; provider census is displayed only when complete.
import {expect,it} from 'vitest';
import {parentLabel,teamLabel} from '../../src/renderer/lib/agent-team';
import type {ChildObservation} from '@shared/agents';
const base={coverage:'unknown' as const,active:null,total:null,observedActive:0,observedTotal:0,observedAt:0,children:[]};
it('keeps missing and unknown provider telemetry explicit',()=>{expect(teamLabel(undefined)).toContain('non disponibili');expect(teamLabel(base)).not.toContain('0');});
it('distinguishes observed partial counts from a complete census',()=>{expect(teamLabel({...base,coverage:'partial',observedActive:1,observedTotal:2})).toContain('visione parziale');expect(teamLabel({...base,coverage:'complete',active:0,total:3})).toBe('Sottoagenti: 0 attivi · 3 totali');});
it('does not invent the owner as parent when a provider reports no relationship',()=>{
  const child:ChildObservation={key:'child',nativeId:'n1',parentNativeId:null,toolCallId:null,kind:'agent',state:'running',task:'Inspect',observedAt:1,source:'live'};
  expect(parentLabel(child,[child])).toBe('non riportato');
  expect(parentLabel({...child,parentNativeId:'missing'},[child])).toBe('non presente nelle osservazioni');
  expect(parentLabel({...child,parentNativeId:'p'},[{...child,nativeId:'p',task:'Plan'}])).toBe('Plan');
});
