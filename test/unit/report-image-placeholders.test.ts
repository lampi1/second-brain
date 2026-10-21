// Legacy report tokens use Marked's inline lexer, preserve literal code, and retain explicit comparison identity.
import {expect,it} from 'vitest';
import {Marked} from 'marked';
import {imageComparison,reportImageExtension,isImageGalleryLead} from '../../src/renderer/brain/lib/report-images';
const marked = new Marked({gfm:true},reportImageExtension);
it('renders legacy placeholders beside normal Markdown images',()=>{
  const html=marked.parse('Evidence {{img:126097-before-heading.png}}\n\n![After](shots/after.png)',{async:false});
  expect(html).toContain('<img src="126097-before-heading.png" alt="126097-before-heading.png">');
  expect(html).toContain('<img src="shots/after.png" alt="After">');
});
it('does not expand fenced, indented or inline code',()=>{
  for(const text of ['`{{img:x.png}}`','```text\n{{img:x.png}}\n```','    {{img:x.png}}']){
    const html=marked.parse(text,{async:false});
    expect(html).not.toContain('<img');expect(html).toContain('{{img:x.png}}');
  }
});
it('escapes token attributes before sanitization and does not match multiline tokens',()=>{
  expect(marked.parse('{{img:a" onerror="boom.png}}',{async:false})).toContain('src="a&quot; onerror=&quot;boom.png"');
  expect(marked.parse('{{img:a\nb.png}}',{async:false})).not.toContain('<img');
});
it('pairs only matching explicit before and after filenames in the same folder',()=>{
  const before=imageComparison('/shots/126097-before-heading.png');
  const after=imageComparison('/shots/126097-after-heading.png');
  expect(before?.key).toBe(after?.key);expect(before?.side).toBe('before');expect(after?.side).toBe('after');
  expect(imageComparison('/other/126097-after-heading.png')?.key).not.toBe(before?.key);
  expect(imageComparison('126098-after-heading.png')?.key).not.toBe(before?.key);
  for(const path of ['heading.png','beforehand.png','afterthought.png','/before/heading.png'])expect(imageComparison(path)).toBeNull();
});

it('accepts only explicit gallery leads, including the reported viewport caption',()=>{
  for(const lead of ['Before / after:', 'Before / after (1280×600):', 'Prima / dopo (1280x600):']) expect(isImageGalleryLead(lead)).toBe(true);
  for(const lead of ['Evidence:', 'This is before / after:', 'Before / after: changed heading', 'Before:']) expect(isImageGalleryLead(lead)).toBe(false);
});
