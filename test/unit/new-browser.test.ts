// Manual browser creation reuses the native open channel with no agent ownership and navigates to the Grindhouse.
import{afterEach,expect,it,vi}from'vitest';
const invoke=vi.fn();vi.mock('../../src/renderer/sb',()=>({sb:{invoke:(...args:unknown[])=>invoke(...args),on:()=>()=>{}}}));
import{newBrowser,openFileViewer}from'../../src/renderer/actions';import{ui,dismissToast}from'../../src/renderer/store/ui';
import{readFileViewArg}from'../../src/shared/file-view';
afterEach(()=>{invoke.mockReset();for(const item of ui.get().toasts)dismissToast(item.id);});
it('opens an unowned blank tab and brings the Grindhouse, where it shows, on screen',async()=>{
 invoke.mockResolvedValue({id:'manual-tab'});ui.set(state=>({...state,page:'costi',map:false,focusMode:null,maximized:null,prefs:{...state.prefs,browsersHidden:false}}));
 await newBrowser();expect(invoke).toHaveBeenCalledWith('browser:open',{url:'about:blank',ownerChatId:null});expect(ui.get().page).toBe('home');
});
it('keeps the page and reports an unavailable browser without making a fake tile',async()=>{
 invoke.mockRejectedValue(new Error('unavailable'));ui.set(state=>({...state,page:'home'}));await newBrowser();expect(ui.get().page).toBe('home');expect(ui.get().toasts).toHaveLength(1);
});
it('opens a cited file outside a visual focus trap without answering a request',()=>{
 ui.set(state=>({...state,page:'home',modal:'visual'}));
 openFileViewer('C:/work/report.ts:40','owner');
 expect(ui.get().page).toBe('file');expect(ui.get().modal).toBeNull();
 expect(readFileViewArg(ui.get().pageArg??undefined)).toMatchObject({path:'C:/work/report.ts',line:40,chatId:'owner'});
 expect(invoke).not.toHaveBeenCalled();
});
it('does not dismiss an unrelated permission or confirmation modal when resolving a file reference',()=>{
 ui.set(state=>({...state,modal:'confirm'}));openFileViewer('C:/work/report.ts','owner');expect(ui.get().modal).toBe('confirm');
});
