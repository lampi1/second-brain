// Report images in the file viewer (issue #83): embedded rasters stay, local files (relative to the report, absolute,
// file:///) go to main, remote and non-raster sources never load; a report's CSS can never fetch.
import {expect,it} from 'vitest';
import {classifyImageSrc,embeddedRasterOk,joinPath,scrubCss} from '../../src/renderer/brain/lib/report-images';

const png=(w:number,h:number)=>{const b=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(b);b.writeUInt32BE(13,8);b.write('IHDR',12);b.writeUInt32BE(w,16);b.writeUInt32BE(h,20);return 'data:image/png;base64,'+b.toString('base64');};

it('resolves relative images against the report folder on Windows and POSIX, never above the root',()=>{
  expect(classifyImageSrc('shots/after.png','C:\\Users\\me\\evidence\\fix-1\\report.html')).toEqual({kind:'local',path:'C:\\Users\\me\\evidence\\fix-1\\shots\\after.png'});
  expect(classifyImageSrc('./a%20b.PNG?v=2#x','/home/me/ev/report.md')).toEqual({kind:'local',path:'/home/me/ev/a b.PNG'});
  expect(classifyImageSrc('../before.jpg','/home/me/ev/fix/report.html')).toEqual({kind:'local',path:'/home/me/ev/before.jpg'});
  expect(joinPath('C:\\a','..\\..\\..\\x.png')).toBe('C:\\x.png');expect(joinPath('/a','../../x.png')).toBe('/x.png');
});
it('keeps absolute local paths and file:/// URLs of this PC',()=>{
  expect(classifyImageSrc('C:/brain/x.webp','/any/r.html')).toEqual({kind:'local',path:'C:\\brain\\x.webp'});
  expect(classifyImageSrc('file:///C:/brain/a%20b.png','/any/r.html')).toEqual({kind:'local',path:'C:\\brain\\a b.png'});
  expect(classifyImageSrc('/home/me/x.jpeg','C:\\r.html')).toEqual({kind:'local',path:'/home/me/x.jpeg'});
});
it('keeps embedded rasters and blocks remote, network shares, other schemes and non-rasters',()=>{
  const data=png(2,2);expect(classifyImageSrc(` ${data} `,'/r.html')).toEqual({kind:'data',src:data});
  for(const src of ['https://example.com/x.png','http://x/y.png','//host/share/x.png','\\\\host\\share\\x.png','file://host/share/x.png','blob:abc','javascript:alert(1)'])expect(classifyImageSrc(src,'/home/r.html')).toEqual({kind:'blocked',why:'remote'});
  for(const src of ['data:image/svg+xml;base64,PHN2Zz4=','data:text/html,<b>x</b>','C:/brain/x.svg','x.gif'])expect(classifyImageSrc(src,'/home/r.html')).toEqual({kind:'blocked',why:'type'});
  expect(classifyImageSrc('x.png','report.html')).toEqual({kind:'blocked',why:'remote'}); // no folder to resolve against
});
it('decodes an embedded raster only when its header declares a sane size',()=>{
  expect(embeddedRasterOk(png(1280,9000))).toBe(true);
  expect(embeddedRasterOk(png(20000,20000))).toBe(false);expect(embeddedRasterOk(png(16000,16000))).toBe(false);
  expect(embeddedRasterOk('data:image/png;base64,AAAA')).toBe(false);expect(embeddedRasterOk('data:image/png;base64,!!')).toBe(false);
});
it('scrubs every way CSS could load something',()=>{
  const css=scrubCss('@import url(https://x/a.css); body{background:url( "https://x/t.png" ) no-repeat;color:red} .a{background-image:image-set("a.png" 1x)} @font-face{font-family:x;src:url(x.woff)} .b{width:expression(alert(1));behavior:url(x.htc)} .c{background:u\\72l(https://x/y.png)} /* url(x) */');
  expect(css).not.toMatch(/url\s*\(|@import|image-set|expression\(|behavior|@font-face|https:/i);
  expect(css).toContain('color:red');
});
