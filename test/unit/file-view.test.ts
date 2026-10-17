// Cited files remain scoped and bounded; opening a citation never reads credentials or executes its contents.
import fs from'node:fs';import os from'node:os';import path from'node:path';
import{afterEach,expect,it}from'vitest';
import{readFileView,FILE_VIEW_BYTES}from'../../src/main/file-view';
import{fileReference,fileViewArg,readFileViewArg}from'../../src/shared/file-view';
const temporary:string[]=[];const setup=()=>{const base=fs.mkdtempSync(path.join(os.tmpdir(),'sb-viewer-'));temporary.push(base);const root=path.join(base,'work');fs.mkdirSync(root);return{base,root};};
afterEach(()=>{for(const dir of temporary.splice(0))fs.rmSync(dir,{recursive:true,force:true});});
it('preserves Windows and POSIX citation coordinates in a validated internal route',()=>{
 expect(fileReference('C:/work/report.md:42:3','c1')).toEqual({path:'C:/work/report.md',line:42,column:3,chatId:'c1'});
 const ref=fileReference('/work/report.md#L10C2');expect(ref).toMatchObject({path:'/work/report.md',line:10,column:2});expect(readFileViewArg(fileViewArg(ref))).toEqual(ref);
 expect(readFileViewArg('@file:broken')).toBeNull();expect(fileReference('a.ts:0').line).toBeUndefined();
});
it('loads source beyond the old small peek and keeps markdown/HTML inert text',()=>{
 const{root}=setup(),text='line\n'.repeat(2500);fs.writeFileSync(path.join(root,'report.md'),text);
 expect(readFileView('report.md:1200',{cwd:root,roots:[root]})).toMatchObject({kind:'text',text,more:false});
 fs.writeFileSync(path.join(root,'page.html'),'<script>doNotRun()</script>');expect(readFileView('page.html',{cwd:root,roots:[root]})).toMatchObject({kind:'text',text:'<script>doNotRun()</script>'});
});
it('refuses outside roots, missing relative context, private paths and executable formats',()=>{
 const{base,root}=setup();fs.writeFileSync(path.join(base,'outside.txt'),'outside');fs.writeFileSync(path.join(root,'credentials.json'),'{}');fs.writeFileSync(path.join(root,'run.exe'),'inert');
 expect(readFileView(path.join(base,'outside.txt'),{roots:[root]})).toMatchObject({kind:'refused',reason:'outside'});
 expect(readFileView('missing.txt',{roots:[root]})).toMatchObject({kind:'refused',reason:'outside'});
 expect(readFileView('credentials.json',{cwd:root,roots:[root]})).toMatchObject({kind:'refused',reason:'private'});
 expect(readFileView('run.exe',{cwd:root,roots:[root]})).toMatchObject({kind:'unsupported'});
});
it('does not let an innocuous hard link expose a file outside the scoped root',()=>{
 const{base,root}=setup(),outside=path.join(base,'private.txt');fs.writeFileSync(outside,'private fixture');fs.linkSync(outside,path.join(root,'alias.txt'));
 expect(readFileView('alias.txt',{cwd:root,roots:[root]})).toMatchObject({kind:'refused',reason:'outside'});
});
it('blocks unenumerated hidden credential containers while allowing public source folders',()=>{
 const{root}=setup();for(const folder of['.docker','.local','.other-client']){fs.mkdirSync(path.join(root,folder));fs.writeFileSync(path.join(root,folder,'config.json'),'{}');expect(readFileView(`${folder}/config.json`,{cwd:root,roots:[root]})).toMatchObject({kind:'refused',reason:'private'});}
 fs.mkdirSync(path.join(root,'.github'));fs.writeFileSync(path.join(root,'.github','README.md'),'public fixture');expect(readFileView('.github/README.md',{cwd:root,roots:[root]})).toMatchObject({kind:'text',text:'public fixture'});
});
it('bounds the bytes actually read and rejects binary text masquerades',()=>{
 const{root}=setup();fs.writeFileSync(path.join(root,'large.log'),'x'.repeat(FILE_VIEW_BYTES+100));const result=readFileView('large.log',{cwd:root,roots:[root]});
 expect(result.kind).toBe('text');if(result.kind==='text'){expect(result.text.length).toBe(FILE_VIEW_BYTES);expect(result.more).toBe(true);}
 fs.writeFileSync(path.join(root,'binary.txt'),Buffer.from([1,0,2]));expect(readFileView('binary.txt',{cwd:root,roots:[root]})).toMatchObject({kind:'unsupported',reason:'binary'});
});
