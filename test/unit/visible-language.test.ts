// Runtime parity is explicit for touched UI areas, and visible labels must resolve after changing language.
import{afterEach,expect,it}from'vitest';
import{it as italian}from'../../src/renderer/i18n/it';
import{en as english}from'../../src/renderer/i18n/en';
import{productIt}from'../../src/renderer/i18n/areas/product.it';
import{productEn}from'../../src/renderer/i18n/areas/product.en';
import{settingsIt}from'../../src/renderer/i18n/areas/settings.it';
import{settingsEn}from'../../src/renderer/i18n/areas/settings.en';
import{studioIt}from'../../src/renderer/i18n/areas/studio.it';
import{studioEn}from'../../src/renderer/i18n/areas/studio.en';
import{stateInfo}from'../../src/renderer/lib/format';
import{setLang,t}from'../../src/renderer/i18n';
afterEach(()=>setLang('it'));
it('keeps Italian and English keys in parity, including all newly touched areas',()=>{
 for(const[left,right]of[[italian,english],[productIt,productEn],[settingsIt,settingsEn],[studioIt,studioEn]] as const)expect(Object.keys(left).sort()).toEqual(Object.keys(right).sort());
});
it('renders the reported legacy control labels in English',()=>{
 setLang('en');expect(stateInfo({state:'waiting',pending:1,isRegia:true}).label).toBe('waiting for you');
 expect(t('chat.input.newChatButton')).toBe('New chat');expect(t('chat.menu.copyLink')).toBe('Copy link');expect(t('ui.other')).toBe('Other…');expect(t('essential.saved')).toBe('Saved');
});
