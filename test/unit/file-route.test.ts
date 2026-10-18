// Retired explorer links stay useful without a directory/search page or a public file-view navigation entry.
import{expect,it,vi}from'vitest';
vi.mock('../../src/renderer/sb',()=>({sb:{invoke:vi.fn(),on:()=>()=>{}}}));
import{BRAIN_PAGES,parseTarget}from'../../src/renderer/brain';
import{go,goTarget,openFileViewer}from'../../src/renderer/actions';
import{callQuestions,setQuestionsAside,setQuestionsShown,ui}from'../../src/renderer/store/ui';
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
it('a file link clicked in the questions window puts the window aside so the viewer is in front (review of PR 19, finding 1)',()=>{
 // the window not on screen (a tile, a procedure, a profile link): nothing changes for it
 ui.set(s=>({...s,later:false,qwin:{open:false,first:null,call:0,shown:false}}));
 openFileViewer('C:/work/a.md','chat');expect(ui.get().qwin.aside).toBeFalsy();
 // on screen: the click came from it; it steps aside without answering or turning "Rispondi dopo" on
 setQuestionsShown(true);openFileViewer('C:/work/report.md:3','chat');
 expect(ui.get().page).toBe('file');expect(ui.get().qwin).toMatchObject({aside:true,open:false,first:null});expect(ui.get().later).toBe(false);
 // Ctrl+J, the pill or a tile's "Apri" bring it back in front
 callQuestions('chat/q1');expect(ui.get().qwin).toMatchObject({aside:false,open:true,first:'chat/q1'});
 setQuestionsAside(true);setQuestionsAside(false);expect(ui.get().qwin.aside).toBe(false);
});
