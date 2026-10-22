// Retired explorer links stay useful without a directory/search page or a public file-view navigation entry: every file
// link (sb://esplora/…, sb://file/…, a chat's path) opens the viewer overlay above the page, which keeps its place.
import{expect,it,vi}from'vitest';
vi.mock('../../src/renderer/sb',()=>({sb:{invoke:vi.fn(),on:()=>()=>{}}}));
import{BRAIN_PAGES,parseTarget}from'../../src/renderer/brain';
import{closeViewer,currentLink,escapeOne,go,goTarget,openFileViewer,openLink,openShots,viewerStep}from'../../src/renderer/actions';
import{callQuestions,setQuestionsAside,setQuestionsShown,ui}from'../../src/renderer/store/ui';
import{currentEntry}from'../../src/renderer/lib/viewer-stack';
import{readFileViewArg}from'../../src/shared/file-view';
const shownFile=()=>{const e=currentEntry(ui.get().viewer);return e?.kind==='file'?readFileViewArg(e.arg):null;};
it('keeps the file viewer private and removes the retired explorer from public pages',()=>{
 expect(BRAIN_PAGES.map(page=>page.id)).not.toContain('esplora');expect(BRAIN_PAGES.map(page=>page.id)).not.toContain('file');
});
it('opens old file links in the viewer overlay at the cited line, over the page, and falls back to Home only when no file was given',()=>{
 go({page:'costi'});const history=ui.get().history.length;
 goTarget('esplora/notes/report.md:12');expect(ui.get().page).toBe('costi');expect(ui.get().viewer.open).toBe(true);
 expect(shownFile()).toMatchObject({path:'notes/report.md',line:12});expect(ui.get().history).toHaveLength(history);
 const parsed=parseTarget('esplora/now.md:3');expect(parsed).toMatchObject({map:false,id:'file'});
 expect(currentLink().startsWith('sb://file/')).toBe(true);
 expect(escapeOne()).toBe(true);expect(ui.get().viewer.open).toBe(false);expect(ui.get().page).toBe('costi');
 go({page:'esplora'});expect(ui.get().page).toBe('home');expect(ui.get().viewer.open).toBe(false);
});
it('retains chat scope and coordinates on canonical viewer navigation, and moves back and forward among the files',()=>{
 openFileViewer('C:/work/report.ts:5','chat');expect(shownFile()).toMatchObject({path:'C:/work/report.ts',line:5,chatId:'chat'});
 openShots({path:'C:/e/a-before.png',caption:'Prima'},{path:'C:/e/a-after.png',caption:'Dopo'});expect(currentEntry(ui.get().viewer)?.kind).toBe('shots');
 viewerStep(-1);expect(shownFile()).toMatchObject({path:'C:/work/report.ts'});
 viewerStep(1);expect(currentEntry(ui.get().viewer)?.kind).toBe('shots');
 // a copied line link opens the same file at that line
 expect(openLink('sb://file/@file:'+encodeURIComponent(JSON.stringify({path:'/r/a.md',line:9})))).toBe(true);
 expect(shownFile()).toMatchObject({path:'/r/a.md',line:9});
 closeViewer();expect(currentEntry(ui.get().viewer)).toBeNull();
});
it('a file link clicked in the questions window puts the window aside so the viewer is in front (review of PR 19, finding 1)',()=>{
 // the window not on screen (a tile, a procedure, a profile link): nothing changes for it
 ui.set(s=>({...s,later:false,qwin:{open:false,first:null,call:0,shown:false}}));
 openFileViewer('C:/work/a.md','chat');expect(ui.get().qwin.aside).toBeFalsy();
 // on screen: the click came from it; it steps aside without answering or turning "Rispondi dopo" on
 setQuestionsShown(true);openFileViewer('C:/work/report.md:3','chat');
 expect(ui.get().viewer.open).toBe(true);expect(ui.get().qwin).toMatchObject({aside:true,open:false,first:null});expect(ui.get().later).toBe(false);
 // Ctrl+J, the pill or a tile's "Apri" bring it back in front
 callQuestions('chat/q1');expect(ui.get().qwin).toMatchObject({aside:false,open:true,first:'chat/q1'});
 setQuestionsAside(true);setQuestionsAside(false);expect(ui.get().qwin.aside).toBe(false);
});
