// Opened file links show any local file read-only and bounded (SPEC 22); never a network share, never executed.
import fs from'node:fs';import os from'node:os';import path from'node:path';
import{afterEach,expect,it}from'vitest';
import{readFileView,FILE_VIEW_BYTES,PDF_BYTES}from'../../src/main/file-view';
import{fileReference,fileViewArg,readFileViewArg,type FileViewResult}from'../../src/shared/file-view';
const temporary:string[]=[];const setup=()=>{const base=fs.mkdtempSync(path.join(os.tmpdir(),'sb-viewer-'));temporary.push(base);const root=path.join(base,'work');fs.mkdirSync(root);return{base,root};};
afterEach(()=>{for(const dir of temporary.splice(0))fs.rmSync(dir,{recursive:true,force:true});});
it('preserves Windows and POSIX citation coordinates in a validated internal route',async()=>{
 expect(fileReference('C:/work/report.md:42:3','c1')).toEqual({path:'C:/work/report.md',line:42,column:3,chatId:'c1'});
 const ref=fileReference('/work/report.md#L10C2');expect(ref).toMatchObject({path:'/work/report.md',line:10,column:2});expect(readFileViewArg(fileViewArg(ref))).toEqual(ref);
 expect(readFileViewArg('@file:broken')).toBeNull();expect(fileReference('a.ts:0').line).toBeUndefined();
});
it('loads source beyond the old small peek and keeps markdown/HTML inert text',async()=>{
 const{root}=setup(),text='line\n'.repeat(2500);fs.writeFileSync(path.join(root,'report.md'),text);
 expect(await readFileView('report.md:1200',{cwd:root})).toMatchObject({kind:'text',text,more:false,shown:text.length});
 fs.writeFileSync(path.join(root,'page.html'),'<script>doNotRun()</script>');expect(await readFileView('page.html',{cwd:root})).toMatchObject({kind:'text',text:'<script>doNotRun()</script>'});
});
it('shows any local file: outside the work folders, dotfiles, credentials, any extension',async()=>{
 const{base,root}=setup();fs.writeFileSync(path.join(base,'outside.txt'),'outside');fs.mkdirSync(path.join(root,'.docker'));fs.writeFileSync(path.join(root,'.docker','credentials.json'),'{"a":1}');fs.writeFileSync(path.join(root,'run.exe'),'inert text');fs.writeFileSync(path.join(root,'.env'),'A=1');
 expect(await readFileView(path.join(base,'outside.txt'))).toMatchObject({kind:'text',text:'outside'});
 expect(await readFileView('.docker/credentials.json',{cwd:root})).toMatchObject({kind:'text',text:'{"a":1}'});
 expect(await readFileView('.env',{cwd:root})).toMatchObject({kind:'text',text:'A=1'});
 expect(await readFileView('run.exe',{cwd:root})).toMatchObject({kind:'text',text:'inert text'});
});
it('refuses network shares, unresolvable relative paths and folders',async()=>{
 const{root}=setup();
 expect(await readFileView('\\\\host\\share\\x.md')).toMatchObject({kind:'refused',reason:'outside'});
 expect(await readFileView('//host/share/x.md')).toMatchObject({kind:'refused',reason:'outside'});
 expect(await readFileView('file://host/share/x.md')).toMatchObject({kind:'refused',reason:'outside'});
 expect(await readFileView('missing.txt')).toMatchObject({kind:'refused',reason:'outside'});
 expect(await readFileView('../up.txt',{cwd:root})).toMatchObject({kind:'refused',reason:'outside'});
 expect(await readFileView(root)).toMatchObject({kind:'unsupported',reason:'unsupported'});
 expect(await readFileView(path.join(root,'nope.txt'))).toMatchObject({kind:'missing'});
});
it('bounds the bytes actually read, never cuts a UTF-8 character, and rejects binary text masquerades',async()=>{
 const{root}=setup();fs.writeFileSync(path.join(root,'large.log'),'x'.repeat(FILE_VIEW_BYTES+100));const result=await readFileView('large.log',{cwd:root});
 expect(result.kind).toBe('text');if(result.kind==='text'){expect(result.text.length).toBe(FILE_VIEW_BYTES);expect(result.more).toBe(true);expect(result.shown).toBe(FILE_VIEW_BYTES);expect(result.size).toBe(FILE_VIEW_BYTES+100);}
 fs.writeFileSync(path.join(root,'accent.txt'),'x'.repeat(FILE_VIEW_BYTES-1)+'èèè');const accent=await readFileView('accent.txt',{cwd:root});
 expect(accent.kind==='text'&&accent.text).toBe('x'.repeat(FILE_VIEW_BYTES-1));
 fs.writeFileSync(path.join(root,'binary.txt'),Buffer.from([1,0,2]));expect(await readFileView('binary.txt',{cwd:root})).toMatchObject({kind:'unsupported',reason:'binary'});
});
const numbered=(n:number)=>Array.from({length:n},(_,i)=>`L${String(i+1).padStart(6,'0')}\n`).join('');
/** Every page from the top following `offset + shown`, as the pager's Next does. */
async function pages(root:string,name:string){
 const all:Extract<FileViewResult,{kind:'text'}>[]=[];let offset=0;
 for(;;){const page=await readFileView(name,{cwd:root,offset});if(page.kind!=='text')throw new Error(page.kind);all.push(page);if(!page.more||all.length>20)return all;offset=page.offset+page.shown;}
}
it('pages a big text file at line ends, from any byte offset, with the line number of each page',async()=>{
 const{root}=setup(),text=numbered(400_000);fs.writeFileSync(path.join(root,'big.log'),text);
 const all=await pages(root,'big.log');let firstLine=1,offset=0;
 for(const page of all){expect(page).toMatchObject({offset,firstLine,size:text.length});expect(page.shown%8).toBe(0);expect(page.shown).toBeLessThanOrEqual(FILE_VIEW_BYTES);offset+=page.shown;firstLine+=page.shown/8;}
 expect(all.length).toBe(4);expect(all.map(p=>p.text).join('')).toBe(text);
 // a jump inside a line moves to the next line start
 expect(await readFileView('big.log',{cwd:root,offset:1_000_003,align:true})).toMatchObject({offset:1_000_008,firstLine:125_002});
 const last=await readFileView('big.log',{cwd:root,offset:text.length-FILE_VIEW_BYTES,align:true});expect(last).toMatchObject({more:false});expect(last.kind==='text'&&last.text.endsWith('L400000\n')).toBe(true);
 expect(await readFileView('big.log',{cwd:root,offset:text.length+50})).toMatchObject({kind:'text',text:'',more:false});
 // Previous: the page that ends exactly where the shown one starts
 const third=all[2]!,previous=await readFileView('big.log',{cwd:root,before:third.offset});
 expect(previous).toMatchObject({kind:'text',more:true});if(previous.kind==='text'){expect(previous.offset+previous.shown).toBe(third.offset);expect(previous.text.startsWith('L')).toBe(true);expect(previous.firstLine).toBe(previous.offset/8+1);}
 expect(await readFileView('big.log',{cwd:root,before:500})).toMatchObject({offset:0,shown:500,firstLine:1});
});
it('pages a Latin-1 file without dropping bytes that look like UTF-8 continuations',async()=>{
 const{root}=setup(),bytes=Buffer.alloc(FILE_VIEW_BYTES+10,0x41);bytes[FILE_VIEW_BYTES]=0xb0;bytes[FILE_VIEW_BYTES+1]=0xb0;fs.writeFileSync(path.join(root,'latin.txt'),bytes);
 const all=await pages(root,'latin.txt');expect(all.reduce((n,p)=>n+p.shown,0)).toBe(bytes.length);
});
it('joins every byte of a line longer than a page, and steps back over it',async()=>{
 const{root}=setup(),text='short\n'+'é'.repeat(900_000)+'\nafter\n'+numbered(10);fs.writeFileSync(path.join(root,'wide.log'),text);
 const all=await pages(root,'wide.log');
 expect(all.map(p=>p.text).join('')).toBe(text);expect(all.length).toBe(3);
 for(const page of all.slice(1)){const back=await readFileView('wide.log',{cwd:root,before:page.offset});expect(back.kind==='text'&&back.offset+back.shown).toBe(page.offset);expect(back.kind==='text'&&back.offset).toBeLessThan(page.offset);}
});
it('opens the page around a cited line, or the top when the line is near it or past the end',async()=>{
 const{root}=setup(),text=numbered(400_000);fs.writeFileSync(path.join(root,'big.log'),text);
 const cited=await readFileView('big.log',{cwd:root,line:300_000});
 expect(cited).toMatchObject({kind:'text',offset:299_899*8,firstLine:299_900});expect(cited.kind==='text'&&cited.text.startsWith('L299900\nL299901\n')).toBe(true);
 expect(await readFileView('big.log',{cwd:root,line:10})).toMatchObject({offset:0,firstLine:1});
 expect(await readFileView('big.log',{cwd:root,line:900_000})).toMatchObject({offset:0,firstLine:1});
 // long lines above the cited one: fewer of them, so the cited line stays on its page
 const long=Array.from({length:300},(_,i)=>`${i+1}:${'x'.repeat(20_000)}\n`).join('');fs.writeFileSync(path.join(root,'long.log'),long);
 const far=await readFileView('long.log',{cwd:root,line:250});
 expect(far.kind).toBe('text');if(far.kind==='text'){const lines=far.text.split('\n');expect(lines[250-far.firstLine!]!.startsWith('250:')).toBe(true);expect(far.firstLine).toBeGreaterThan(150);}
 // a cited line too long to end on the page is still on it, cut at a whole character
 fs.writeFileSync(path.join(root,'tail.log'),Array.from({length:50},()=>'y'.repeat(8_000)+'\n').join('')+'CITED'+'z'.repeat(700_000)+'\n');
 const tail=await readFileView('tail.log',{cwd:root,line:51});expect(tail.kind==='text'&&tail.more&&tail.text.includes('CITED')).toBe(true);
 // a UTF-16 file is shown from the top and says it cannot be paged
 fs.writeFileSync(path.join(root,'wide.txt'),Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from('a\nb\n','utf16le')]));
 expect(await readFileView('wide.txt',{cwd:root,offset:4})).toMatchObject({kind:'text',offset:0,text:'a\nb\n',paged:false});
});
it('reads a PDF whole as bytes for pdf.js, bounded and only with the PDF header',async()=>{
 const{root}=setup(),bytes=Buffer.from('%PDF-1.4\n%%EOF\n');fs.writeFileSync(path.join(root,'doc.pdf'),bytes);
 const pdf=await readFileView('doc.pdf',{cwd:root});expect(pdf).toMatchObject({kind:'pdf',size:bytes.length});expect(pdf.kind==='pdf'&&Buffer.from(pdf.data).equals(bytes)).toBe(true);
 fs.writeFileSync(path.join(root,'fake.pdf'),'<html>not a pdf');expect(await readFileView('fake.pdf',{cwd:root})).toMatchObject({kind:'unsupported',reason:'pdf'});
 const fd=fs.openSync(path.join(root,'huge.pdf'),'w');fs.writeSync(fd,'%PDF-1.4');fs.ftruncateSync(fd,PDF_BYTES+1);fs.closeSync(fd);
 expect(await readFileView('huge.pdf',{cwd:root})).toMatchObject({kind:'unsupported',reason:'pdf'});
});
