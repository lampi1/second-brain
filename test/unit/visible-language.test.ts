// Runtime parity is explicit for every UI area (Italian, English and German, ADR 0117), visible labels must resolve
// after changing language, and the renderer's components (components/, brain/, dashboard/, App.tsx, main.tsx) carry no
// Italian UI text outside the dictionaries (ADR 0057, 0117).
import{afterEach,expect,it}from'vitest';
import{readFileSync,readdirSync}from'node:fs';
import{join}from'node:path';
import ts from'typescript';
import{it as italian}from'../../src/renderer/i18n/it';
import{en as english}from'../../src/renderer/i18n/en';
import{de as german}from'../../src/renderer/i18n/de';
import{stateInfo}from'../../src/renderer/lib/format';
import{locale,setLang,t}from'../../src/renderer/i18n';
afterEach(()=>setLang('it'));
const AREAS=join(__dirname,'../../src/renderer/i18n/areas');
it('keeps Italian, English and German keys in parity, in the whole dictionary and in every area',async()=>{
 expect(Object.keys(italian).sort()).toEqual(Object.keys(english).sort());
 expect(Object.keys(german).sort()).toEqual(Object.keys(italian).sort());
 const areas=readdirSync(AREAS).filter(f=>f.endsWith('.it.ts')).map(f=>f.slice(0,-6));
 expect(areas.length).toBeGreaterThan(15);
 for(const area of areas){
  const[itMod,enMod,deMod]=await Promise.all([import(join(AREAS,`${area}.it.ts`)),import(join(AREAS,`${area}.en.ts`)),import(join(AREAS,`${area}.de.ts`))]);
  const[itDict,enDict,deDict]=[Object.values(itMod)[0],Object.values(enMod)[0],Object.values(deMod)[0]] as Record<string,unknown>[];
  expect(Object.keys(enDict!).sort(),area).toEqual(Object.keys(itDict!).sort());
  expect(Object.keys(deDict!).sort(),`${area} (de)`).toEqual(Object.keys(itDict!).sort());
 }
});
it('renders the reported legacy control labels in English',()=>{
 setLang('en');expect(stateInfo({state:'waiting',pending:1,isOrchestrator:true}).label).toBe('waiting for you');
 expect(t('chat.mode.quick')).toBe('Quick');expect(t('chat.menu.copyLink')).toBe('Copy link');expect(t('ui.other')).toBe('Other…');expect(t('essential.saved')).toBe('Saved');
});
it('renders the converted component labels and messages in English',()=>{
 setLang('en');
 expect(t('cmp.app.settings')).toBe('Settings');expect(t('cmp.context.resume')).toBe('Resume in a new chat');
 expect(t('cmp.palette.group.Azioni')).not.toBe('Azioni');expect(t('cmp.interview.step.Riepilogo')).toBe('Summary');
 expect(t('cmp.usage.fiveHour',{pct:'40%'})).toBe('5 hours at 40%');
 setLang('it');expect(t('cmp.context.resume')).toBe('Riprendi in chat nuova');
});

// Italian-looking UI text: accents or common Italian words. Proper nouns and keys (Esc, Claude, Orchestrator) do not match.
const ITALIAN=/[àèéìòù]|\b(il|lo|la|gli|le|di|del|della|che|non|per|una|uno|con|nel|sono|questo|questa|ancora|nessun[aoe]?|apri|chiudi|salva|annulla|errore|chat|ora|giorni?|ore|minuti)\b/i;
const VISIBLE_ATTRS=new Set(['title','aria-label','placeholder','example','label','alt']);
const VISIBLE_CALLS=new Set(['toast','announce','setError','setStatus','askConfirm']);
function shellFiles():string[]{
 const root=join(__dirname,'../../src/renderer');
 const walk=(d:string):string[]=>readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(d,e.name)):e.name.endsWith('.tsx')?[join(d,e.name)]:[]);
 // brain/testRoute.tsx is the e2e suite's own route; the genui preview and fixtures are a developer page with sample data
 const own=(f:string)=>!/testRoute\.tsx$|genui[\\/](fixtures|preview)|genui-preview\.tsx$/.test(f);
 return[...walk(join(root,'components')),...walk(join(root,'brain')),...walk(join(root,'dashboard')),join(root,'App.tsx'),join(root,'main.tsx')].filter(own);
}
function italianLiterals(file:string):string[]{
 const src=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const out:string[]=[];
 const hit=(n:ts.Node,text:string)=>{if(ITALIAN.test(text))out.push(`${file}:${src.getLineAndCharacterOfPosition(n.getStart()).line+1} ${text.trim().slice(0,80)}`);};
 const lit=(n:ts.Node|undefined)=>{if(n&&(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)))hit(n,n.text);else if(n&&ts.isTemplateExpression(n))hit(n,n.head.text+n.templateSpans.map(s=>s.literal.text).join(' '));};
 const visit=(n:ts.Node):void=>{
  if(ts.isJsxText(n))hit(n,n.text);
  else if(ts.isJsxAttribute(n)&&VISIBLE_ATTRS.has(n.name.getText(src))){const v=n.initializer;lit(v&&ts.isJsxExpression(v)?v.expression:v);}
  else if(ts.isJsxExpression(n)&&n.parent&&(ts.isJsxElement(n.parent)||ts.isJsxFragment(n.parent)))lit(n.expression);
  else if(ts.isCallExpression(n)&&VISIBLE_CALLS.has(n.expression.getText(src)))lit(n.arguments[0]);
  ts.forEachChild(n,visit);
 };
 visit(src);return out;
}
it('keeps the renderer\'s components free of hard-coded Italian UI text',()=>{
 const files=shellFiles();expect(files.length).toBeGreaterThan(80);
 expect(files.flatMap(italianLiterals)).toEqual([]);
});
it('renders German with the Austrian locale',()=>{
 setLang('de');
 expect(locale()).toBe('de-AT');expect(t('settings.language')).toBe('Sprache');expect(t('common.close')).toBe('Schließen');
});
