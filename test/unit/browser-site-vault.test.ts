// Routine site secrets stay encrypted, exact-origin and host-only; login submits no secret-valued tool result.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import vm from 'node:vm';
import { afterEach, expect, it, vi } from 'vitest';
import { SiteVault } from '../../src/main/browser/site-vault';
import { siteLogin, siteLoginScript } from '../../src/main/browser/site-login';
import { redact } from '../../src/main/log';
import type { SecretCipher } from '../../src/main/engines/secrets';
import type { BrowserTabs, Tab } from '../../src/main/browser/tabs';
const dirs:string[]=[];afterEach(()=>{for(const d of dirs.splice(0))fs.rmSync(d,{recursive:true,force:true});});
const cipher:SecretCipher={unavailable:()=>null,encrypt:s=>Buffer.from(s.split('').reverse().join('')),decrypt:b=>b.toString().split('').reverse().join('')};
const setup=()=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'site-vault-'));dirs.push(d);const file=path.join(d,'vault.json');return {file,vault:new SiteVault(file,cipher,()=>['https://qa.example.com','https://www.qa.example.com'])};};
it('CRUD is encrypted and exact origin: www, scheme and port never alias; no secrets in metadata',()=>{
 const {file,vault}=setup();vault.save({origin:'https://qa.example.com',user:'tester',password:'fixture-secret-one'});const first=vault.list().entries[0]!;
 expect(fs.readFileSync(file,'utf8')).not.toContain('fixture-secret-one');expect(JSON.stringify(vault.list())).not.toContain('fixture-secret-one');
 expect(vault.forLogin('https://www.qa.example.com')).toBeNull();expect(vault.forLogin('https://qa.example.com:444')).toBeNull();expect(vault.forLogin('http://qa.example.com')).toBeNull();
 expect(vault.forLogin('https://qa.example.com')?.password).toBe('fixture-secret-one');
 vault.save({id:first.id,origin:'https://qa.example.com',user:'tester2',password:'fixture-secret-two'});expect(vault.list().entries).toHaveLength(1);expect(vault.forLogin('https://qa.example.com')?.user).toBe('tester2');vault.remove(vault.list().entries[0]!.id);expect(vault.forLogin('https://qa.example.com')).toBeNull();
 expect(()=>vault.save({origin:'https://other.example.com',user:'x',password:'x'})).toThrow(/Approve/);
});
it('OS encryption unavailable refuses persistence and use',()=>{const {file}=setup();const vault=new SiteVault(file,{...cipher,unavailable:()=> 'no keychain'},()=>['https://qa.example.com']);expect(()=>vault.save({origin:'https://qa.example.com',user:'x',password:'x'})).toThrow(/no keychain/);expect(vault.forLogin('https://qa.example.com')).toBeNull();});
it('host login uses saved credential only on approved origin; output/logs never contain its password, missing credential returns handoff',async()=>{
 const {vault}=setup();vault.save({origin:'https://qa.example.com',user:'tester',password:'fixture-host-secret'});
 const dispatch=vi.fn(), protectLogin=vi.fn(), evaluate=vi.fn(async()=>true), policy={targets:['https://qa.example.com'],dispatch};
 const tab={owner:'worker',wc:{getURL:()=> 'https://qa.example.com/login',executeJavaScriptInIsolatedWorld:evaluate}} as unknown as Tab;
 const tabs={hostLoginAllowed:()=>true,assertRoutine:()=>policy,protectLogin,assertLoginReadable:async()=>{}} as unknown as BrowserTabs;
 expect(await siteLogin(tabs,tab,vault)).toBe(true);expect(dispatch).toHaveBeenCalledOnce();expect(protectLogin).toHaveBeenCalled();expect(evaluate.mock.calls[0]).toBeDefined();expect(redact('fixture-host-secret')).toBe('[redacted]');
 vault.remove(vault.list().entries[0]!.id);expect(await siteLogin(tabs,tab,vault)).toBe(false);expect(evaluate).toHaveBeenCalledTimes(1);
});
function formWorld(method='post',target='') {
 class Input { _value='';disabled=false;type='text';isConnected=true;form:unknown;get value(){return this._value;}set value(v:string){this._value=v;}getBoundingClientRect(){return {width:10,height:10};}dispatchEvent(){} }
 const user=new Input(),pw=new Input();pw.type='password';let submitted=false;
 const submit={disabled:false,form:undefined as unknown,getBoundingClientRect:()=>({width:10,height:10}),formAction:'',getAttribute:(k:string)=>k==='formmethod'?method:k==='formtarget'?target:null};
 const form={isConnected:true,method:'post',action:'https://qa.example.com/login',target:'',querySelectorAll:(s:string)=>s.startsWith('input[')?[user]:[submit]};user.form=form;pw.form=form;submit.form=form;
 class Form { requestSubmit(){submitted=true;} }
 const world={location:{origin:'https://qa.example.com',href:'https://qa.example.com/login'},document:{querySelectorAll:()=>[pw]},HTMLInputElement:Input,HTMLFormElement:Form,URL,Event:class {constructor(..._args:unknown[]){}},globalThis:{}};
 return {run:()=>vm.runInNewContext(siteLoginScript('https://qa.example.com','tester','synthetic-password'),world),pw,user,submitted:()=>submitted};
}
it('login script accepts one same-origin POST form and never follows submitter GET or popup overrides',()=>{
 const good=formWorld();expect(good.run()).toBe(true);expect(good.submitted()).toBe(true);
 for(const f of [formWorld('get'),formWorld('post','_blank')]){expect(f.run()).toBe(false);expect(f.pw.value).toBe('');expect(f.submitted()).toBe(false);}
});
