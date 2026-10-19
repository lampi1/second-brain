// Packaged appearance and panel migrations preserve independent theme/layout choices and reject executable IDs.
import{expect,it}from'vitest';
import{readAppearance,defaultAppearance}from'../../src/shared/appearance';
import{loadPrefs}from'../../src/renderer/store/ui';
it('accepts only packaged versioned preset/template identifiers',()=>{
 expect(readAppearance({version:1,preset:'calm',templates:{agents:'list'}})).toEqual({version:1,preset:'calm',templates:{agents:'list'}});
 for(const value of [null,{version:2,preset:'calm',templates:{agents:'list'}},{version:1,preset:'https://example.com/style.css',templates:{agents:'list'}},{version:1,preset:'calm',templates:{agents:'<script>'}}])expect(readAppearance(value)).toEqual(defaultAppearance());
});
it('gives fresh installs a dark coordinator column and compact new agent preferences',()=>{
 const prefs=loadPrefs(null,0);expect(prefs.theme).toBe('dark');expect(prefs.orchestratorOpen).toBe(true);expect(prefs.chatPanelsV).toBe(2);expect(prefs.chatExpanded).toEqual({});
});
it('keeps existing open/theme/density choices until explicit migration of chat expansion',()=>{
 const prefs=loadPrefs(JSON.stringify({orchestratorOpen:false,theme:'dark',density:'compact',cols:{2:[.4,.6]},appearance:{version:1,preset:'calm',templates:{agents:'list'}}}),0);
 expect(prefs.orchestratorOpen).toBe(false);expect(prefs.chatPanelsV).toBe(0);
 expect(prefs.theme).toBe('dark');expect(prefs.density).toBe('compact');expect(prefs).not.toHaveProperty('cols');expect(prefs.appearance.preset).toBe('calm');
});
it('restores only boolean expansion choices and drops the retired top placement',()=>{
 const prefs=loadPrefs(JSON.stringify({orchestratorPlacement:'top',orchestratorTopHeight:10000,chatPanelsV:1,chatExpanded:{a:true,b:false,c:'yes','../outside':true}}),0);
 expect(prefs.chatExpanded).toEqual({a:true,b:false});expect(prefs).not.toHaveProperty('orchestratorPlacement');expect(prefs).not.toHaveProperty('orchestratorTopHeight');
});
