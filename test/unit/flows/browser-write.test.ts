// Exact browser declarations stay inert until activation, and canonical effect outcomes have bounded evidence.
import { describe, expect, it } from 'vitest';
import { validateDefinition, digest } from '../../../src/main/flows/schema';
import { browserOrigins, browserWriteResult } from '../../../src/shared/flow-browser';
import { checkResult } from '../../../src/shared/delegation';
import { markdown } from '../../../src/main/flows/portable';
const definition = () => ({ id:'browser-task',title:'Browser task',description:'Synthetic fixture',aliases:[],scope:{},steps:[{id:'write',title:'Write to fixture',kind:'agent',effect:'external-write',writeVia:'browser',browserTargets:['https://qa.example.com'],instructions:'Write the approved fixture and read back.',inputs:['workspace'],workspaceInput:'workspace',evidence:['proof'],timeoutMs:10000,maxAttempts:2}] });
describe('browser routine declarations', () => {
  it('preserves browser scope in validation, digest and readable export', () => {
    const d = validateDefinition(definition()); expect(d.steps[0]).toMatchObject({writeVia:'browser',browserTargets:['https://qa.example.com']});
    expect(markdown(d,1)).toContain('https://qa.example.com');
    const other=definition();other.steps[0]!.browserTargets=['https://other.example.com'];expect(digest(validateDefinition(other))).not.toBe(digest(d));
  });
  it.each(['https://qa.example.com/path','https://*.example.com','https://user:pass@qa.example.com','https://qa.example.com?x=1','https://qa.example.com#x','http://qa.example.com','file:///tmp/x','https://qa.example.com/'])('refuses non-origin target %s', value => expect(()=>browserOrigins([value])).toThrow());
  it('refuses empty targets, duplicate targets, production and adapter ambiguity', () => {
    expect(()=>browserOrigins([])).toThrow();expect(()=>browserOrigins(['https://qa.example.com','https://qa.example.com'])).toThrow();
    for (const patch of [{effect:'production'},{kind:'manual'},{adapter:'devops-write'},{writeVia:'shell'},{browserTargets:undefined},{testDbRead:true}]) {
      const d=definition();Object.assign(d.steps[0]!,patch);expect(()=>validateDefinition(d)).toThrow();
    }
  });
  it('accepts bounded outcomes but rejects contradictory canonical completion', () => {
    expect(browserWriteResult({outcome:'not-done',evidence:['Read-back: unchanged']})).toMatchObject({outcome:'not-done'});
    expect(()=>browserWriteResult({outcome:'done',evidence:[]})).toThrow();
    const r={outcome:'blocked',summary:'Not written',output:'Nothing changed',doneWhen:[{criterion:'proof',met:false,evidence:'Unchanged'}],browserWrite:{outcome:'not-done',evidence:['Read-back unchanged']}};
    expect(checkResult(r,['proof']).browserWrite?.outcome).toBe('not-done');
    expect(()=>checkResult({...r,outcome:'done',doneWhen:[{criterion:'proof',met:true,evidence:'x'}]},['proof'])).toThrow(/agree/);
  });
});
