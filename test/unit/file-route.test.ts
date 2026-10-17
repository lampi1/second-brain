// Retired explorer links stay useful without a directory/search page or a public file-view navigation entry.
import{expect,it,vi}from'vitest';
vi.mock('../../src/renderer/sb',()=>({sb:{invoke:vi.fn(),on:()=>()=>{}}}));
import{BRAIN_PAGES,parseTarget}from'../../src/renderer/brain';
import{go,goTarget,openFileViewer}from'../../src/renderer/actions';
import{ui}from'../../src/renderer/store/ui';
import{readFileViewArg}from'../../src/shared/file-view';
it('keeps the file viewer private and removes the retired explorer from public pages',()=>{
 expect(BRAIN_PAGES.map(page=>page.id)).not.toContain('esplora');expect(BRAIN_PAGES.map(page=>page.id)).not.toContain('file');
});
it('opens old file links at the cited line and falls back to Home only when no file was given',()=>{
 goTarget('esplora/notes/report.md:12');expect(ui.get().page).toBe('file');expect(readFileViewArg(ui.get().pageArg??undefined)).toMatchObject({path:'notes/report.md',line:12});
 const parsed=parseTarget('esplora/now.md:3');expect(parsed).toMatchObject({map:false,id:'file'});
 go({page:'esplora'});expect(ui.get().page).toBe('home');
});
it('retains chat scope and coordinates on canonical viewer navigation',()=>{
 openFileViewer('C:/work/report.ts:5','chat');expect(ui.get().page).toBe('file');expect(readFileViewArg(ui.get().pageArg??undefined)).toMatchObject({path:'C:/work/report.ts',line:5,chatId:'chat'});
});
