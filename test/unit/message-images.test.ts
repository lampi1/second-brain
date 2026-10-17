// Local transcript images use token context and main-authorized paths, never raw file URLs or code examples.
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
it('handles nested markdown images, deduplicates and caps reads without treating text paths as images',()=>{
  expect(localMessageImages('> ![a](C:/brain/a.png)\n\n- ![a again](C:/brain/a.png)\n\nC:/brain/plain.png')).toEqual([{path:'C:\\brain\\a.png',caption:'a'}]);
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
