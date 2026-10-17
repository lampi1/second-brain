// Opened file links show any local file read-only and bounded (SPEC 22); never a network share, never executed.
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
 expect(readFileView('report.md:1200',{cwd:root})).toMatchObject({kind:'text',text,more:false,shown:text.length});
 fs.writeFileSync(path.join(root,'page.html'),'<script>doNotRun()</script>');expect(readFileView('page.html',{cwd:root})).toMatchObject({kind:'text',text:'<script>doNotRun()</script>'});
});
it('shows any local file: outside the work folders, dotfiles, credentials, any extension',()=>{
 const{base,root}=setup();fs.writeFileSync(path.join(base,'outside.txt'),'outside');fs.mkdirSync(path.join(root,'.docker'));fs.writeFileSync(path.join(root,'.docker','credentials.json'),'{"a":1}');fs.writeFileSync(path.join(root,'run.exe'),'inert text');fs.writeFileSync(path.join(root,'.env'),'A=1');
 expect(readFileView(path.join(base,'outside.txt'))).toMatchObject({kind:'text',text:'outside'});
 expect(readFileView('.docker/credentials.json',{cwd:root})).toMatchObject({kind:'text',text:'{"a":1}'});
 expect(readFileView('.env',{cwd:root})).toMatchObject({kind:'text',text:'A=1'});
 expect(readFileView('run.exe',{cwd:root})).toMatchObject({kind:'text',text:'inert text'});
});
it('refuses network shares, unresolvable relative paths and folders',()=>{
 const{root}=setup();
 expect(readFileView('\\\\host\\share\\x.md')).toMatchObject({kind:'refused',reason:'outside'});
 expect(readFileView('//host/share/x.md')).toMatchObject({kind:'refused',reason:'outside'});
 expect(readFileView('file://host/share/x.md')).toMatchObject({kind:'refused',reason:'outside'});
 expect(readFileView('missing.txt')).toMatchObject({kind:'refused',reason:'outside'});
 expect(readFileView('../up.txt',{cwd:root})).toMatchObject({kind:'refused',reason:'outside'});
 expect(readFileView(root)).toMatchObject({kind:'unsupported',reason:'unsupported'});
 expect(readFileView(path.join(root,'nope.txt'))).toMatchObject({kind:'missing'});
});
it('bounds the bytes actually read, never cuts a UTF-8 character, and rejects binary text masquerades',()=>{
 const{root}=setup();fs.writeFileSync(path.join(root,'large.log'),'x'.repeat(FILE_VIEW_BYTES+100));const result=readFileView('large.log',{cwd:root});
 expect(result.kind).toBe('text');if(result.kind==='text'){expect(result.text.length).toBe(FILE_VIEW_BYTES);expect(result.more).toBe(true);expect(result.shown).toBe(FILE_VIEW_BYTES);expect(result.size).toBe(FILE_VIEW_BYTES+100);}
 fs.writeFileSync(path.join(root,'accent.txt'),'x'.repeat(FILE_VIEW_BYTES-1)+'èèè');const accent=readFileView('accent.txt',{cwd:root});
 expect(accent.kind==='text'&&accent.text).toBe('x'.repeat(FILE_VIEW_BYTES-1));
 fs.writeFileSync(path.join(root,'binary.txt'),Buffer.from([1,0,2]));expect(readFileView('binary.txt',{cwd:root})).toMatchObject({kind:'unsupported',reason:'binary'});
});
