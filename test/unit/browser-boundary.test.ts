// Synthetic clipboard syntax and nested secret values exercise actual parser/redaction, with no clipboard or pages.
import { expect,it,vi } from 'vitest';
import { containsPaste } from '../../src/main/browser/keys';
import { redactBody } from '../../src/main/browser/netlog';
import { consoleLine } from '../../src/main/browser/console-line';
import { BrowserActions } from '../../src/main/browser/actions';
import type { BrowserTabs,Tab } from '../../src/main/browser/tabs';
it('recognizes parser-equivalent clipboard shortcuts and multi-stroke sequences',()=>{
  for(const spec of ['ctrl+v','shift+ctrl+v','shift+control+v','ctrl+ctrl+v','cmd+v','shift+meta+v','command+shift+v','alt+ctrl+v','ctrl+a shift+ctrl+v','shift+Insert']) expect(containsPaste(spec),spec).toBe(true);
  for(const spec of ['v','ctrl+a','ctrl+c','Insert','shift+Tab']) expect(containsPaste(spec),spec).toBe(false);
});
it('refuses invalid key syntax before it can produce any strokes',()=>{
  expect(()=>containsPaste('ctrl+v bogus+q')).toThrow();
});
it('masks whole sensitive JSON containers, including nested arrays and wrappers',()=>{
  const input={password:['synthetic-only'],nested:{token:{value:'opaque-only'}},credentials:[{name:'synthetic-login'}],ordinary:{count:3},nullable:{token:null}};
  const result=JSON.parse(redactBody(JSON.stringify(input),'application/json'));
  expect(result).toEqual({password:'[redacted]',nested:{token:'[redacted]'},credentials:'[redacted]',ordinary:{count:3},nullable:{token:null}});
  expect(JSON.stringify(result)).not.toContain('synthetic-only');
});
it('redacts old console entries at output even if their source URL was not sanitized during capture',()=>{
  const result=consoleLine({level:'error',text:'request failed',source:'https://example.invalid/app.js?token=synthetic-only:4',frame:'https://example.invalid/?password=<password>'});
  expect(result).not.toContain('synthetic-only');expect(result).not.toContain('<password>');expect(result).toContain('[redacted]');
});
it('rechecks clipboard protection after a modifier event awaited CDP, before dispatching the paste key',async()=>{
  let copied=false;
  const sent:Record<string,unknown>[]=[];
  const cancel=vi.fn();
  const tabs={credentials:{pasteBlocked:()=>copied},cssScale:()=>1,dialogOpened:()=>({promise:new Promise(()=>{}),cancel})} as unknown as BrowserTabs;
  const actions=new BrowserActions(tabs);
  vi.spyOn(actions,'guardPassword').mockResolvedValue();
  const tab={agentInput:0,dialog:null,cdp:{send:async (_method:string,params:Record<string,unknown>)=>{sent.push(params);if(params.key==='Control')copied=true;}}} as unknown as Tab;
  await expect(actions.key(tab,'ctrl+v')).rejects.toThrow('pasting is blocked');
  expect(sent.some(p=>p.key==='v' && p.type!=='keyUp')).toBe(false);
  expect(sent.some(p=>p.key==='Control' && p.type==='keyUp')).toBe(true);
  expect(tab.agentInput).toBe(0);expect(cancel).toHaveBeenCalledTimes(2);
});
