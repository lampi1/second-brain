// The historical schema has no event model: current profile/engine names must never become retrospective attribution.
import{createElement}from'react';
import{renderToStaticMarkup}from'react-dom/server';
import{afterEach,expect,it}from'vitest';
import{ModelOrigin}from'../../src/renderer/components/ModelOrigin';
import{setLang}from'../../src/renderer/i18n';
afterEach(()=>setLang('it'));
it('labels missing history explicitly, in both supported languages',()=>{
 setLang('it');expect(renderToStaticMarkup(createElement(ModelOrigin))).toContain('Non disponibile');
 setLang('en');expect(renderToStaticMarkup(createElement(ModelOrigin))).toContain('Not available');
});
it('does not attach a model to human ideas',()=>{
 setLang('en');const html=renderToStaticMarkup(createElement(ModelOrigin,{human:true}));expect(html).toContain('User');expect(html).not.toContain('Model:');expect(html).not.toContain('Not available');
});
