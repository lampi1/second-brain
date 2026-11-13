// Local transcript images (issue #83): markdown images, links to images, path-only code spans and bare absolute paths
// in the prose become main-authorized previews; code blocks, HTML, remote URLs and examples never do.
import {expect,it} from 'vitest';
import {localMessageImages} from '../../src/renderer/lib/message-images';
import {safePreviewRaster} from '../../src/renderer/lib/preview-raster';
import {currentImageResults,imageResultsKey} from '../../src/renderer/lib/image-results';
it('finds absolute local images and relative images only against the owning chat workspace',()=>{
  expect(localMessageImages('![screen](C:/brain/tmp/one.png) ![next](shots/two.webp)','C:/brain')).toEqual([{path:'C:\\brain\\tmp\\one.png',caption:'screen'},{path:'C:/brain/shots/two.webp',caption:'next'}]);
  expect(localMessageImages('![next](shots/two.webp)')).toEqual([]);
  expect(localMessageImages('![next](shots/two.webp)','//host/share')).toEqual([]);
  expect(localMessageImages('![space](<file:///C:/brain/a%20b.png>)')).toEqual([{path:'C:\\brain\\a b.png',caption:'space'}]);
});
it('ignores code examples, HTML images, network/userinfo/schemes and unsupported image formats',()=>{
  const text='`![inline](C:/brain/a.png)`\n\n```md\n![fenced](C:/brain/b.png)\n```\n\n<img src="C:/brain/c.png">\n\n![remote](https://example.com/image.png) ![UNC](//host/share/x.png) ![filehost](file://host/share/x.png) ![active](data:image/svg+xml,evil) ![svg](C:/brain/x.svg)';
  expect(localMessageImages(text,'C:/brain')).toEqual([]);
});
it('handles nested markdown images, deduplicates and caps reads',()=>{
  expect(localMessageImages('> ![a](C:/brain/a.png)\n\n- ![a again](C:/brain/a.png)\n\nC:/brain/a.png')).toEqual([{path:'C:\\brain\\a.png',caption:'a'}]);
  expect(localMessageImages('![a](C:/brain/a.png) ![same](a.png)','C:/brain')).toHaveLength(1);
  expect(localMessageImages(Array.from({length:12},(_,i)=>`![${i}](C:/brain/${i}.png)`).join(' '))).toHaveLength(8);
});
it('bounds authorized raster headers before decoder allocation and preserves main refusal',()=>{
  const png=(width:number,height:number)=>{const bytes=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);bytes.writeUInt32BE(13,8);bytes.write('IHDR',12);bytes.writeUInt32BE(width,16);bytes.writeUInt32BE(height,20);return {kind:'image' as const,path:'allowed.png',dataUrl:'data:image/png;base64,'+bytes.toString('base64')};};
  expect(safePreviewRaster(png(3840,2160)).kind).toBe('image');
  expect(safePreviewRaster(png(20000,20000)).kind).toBe('refused');
  expect(safePreviewRaster(png(8192,8192)).kind).toBe('refused');
  expect(safePreviewRaster({...png(1,1),dataUrl:'file:///C:/brain/test.png'}).kind).toBe('refused');
  const missing={kind:'refused' as const,reason:'Outside allowed folders'};expect(safePreviewRaster(missing)).toBe(missing);
});
it('never pairs old bytes with a changed/empty path list, even before effects or after late replies',()=>{
  const a={kind:'image' as const,path:'A.png',dataUrl:'data:image/png;base64,AAAA'},loaded={key:imageResultsKey(['A.png']),values:[a]};
  expect(currentImageResults([],loaded)).toEqual([]);
  expect(currentImageResults(['B.png'],loaded)).toEqual([null]);
  const pendingB={key:imageResultsKey(['B.png']),values:[null]};
  expect(currentImageResults(['B.png'],pendingB)).toEqual([null]);
  expect(currentImageResults(['A.png'],loaded)).toEqual([a]);
});
it('shows the paths an agent writes: bare in prose, as a link, as a path-only code span, in lists and tables',()=>{
  expect(localMessageImages('Prima: C:\\Users\\me\\evidence\\fix_1\\before.png, dopo /home/me/shots/after.jpg.')).toEqual([
    {path:'C:\\Users\\me\\evidence\\fix_1\\before.png',caption:'before.png'},{path:'/home/me/shots/after.jpg',caption:'after.jpg'}]);
  expect(localMessageImages('[Dopo la correzione](C:/brain/after.png) e [il report](C:/brain/report.md)')).toEqual([{path:'C:\\brain\\after.png',caption:'Dopo la correzione'}]);
  expect(localMessageImages('Salvato in `C:\\work\\Ada B\\shot.png` e `shots/a.webp`','C:/repo')).toEqual([
    {path:'C:\\work\\Ada B\\shot.png',caption:'shot.png'},{path:'C:/repo/shots/a.webp',caption:'a.webp'}]);
  expect(localMessageImages('- uno: file:///C:/brain/a%20b.png\n\n| caso | prova |\n|---|---|\n| 7 | /tmp/sb/t7.png |')).toEqual([
    {path:'C:\\brain\\a b.png',caption:'a b.png'},{path:'/tmp/sb/t7.png',caption:'t7.png'}]);
});
it('never guesses: relative prose paths, URLs with a path inside, code that is not just a path, other extensions',()=>{
  expect(localMessageImages('vedi shots/a.png e https://example.com/C:/x.png e https://h/home/u/y.png','C:/repo')).toEqual([]);
  expect(localMessageImages('`npm run shot -- out.png` `![x](C:/brain/a.png)` C:/brain/notes.png.bak C:/brain/x.gif','C:/repo')).toEqual([]);
  expect(localMessageImages('```\nC:\\x\\fenced.png\n```\n\n<img src="C:/brain/c.png">')).toEqual([]);
});
