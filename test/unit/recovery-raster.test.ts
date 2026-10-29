// src/renderer/lib/recovery-raster.ts: recovered images are checked (magic, dimensions, size) before any decoder.
import {expect,it} from 'vitest';
import {validateRecoveryRaster} from '../../src/renderer/lib/recovery-raster';
function png(width:number,height:number){const bytes=new Uint8Array(33),view=new DataView(bytes.buffer);bytes.set([137,80,78,71,13,10,26,10]);view.setUint32(8,13);bytes.set([73,72,68,82],12);view.setUint32(16,width);view.setUint32(20,height);return 'data:image/png;base64,'+btoa(String.fromCharCode(...bytes));}
it('checks dimensions and magic before an avatar, thumbnail or full recovered image reaches a decoder',()=>{
  expect(()=>validateRecoveryRaster(png(16,16),1024,16,256000)).not.toThrow();
  expect(()=>validateRecoveryRaster(png(20000,20000),1024,16,256000)).toThrow('Dimensioni');
  expect(()=>validateRecoveryRaster(png(1920,1080),1920,1,3750000)).not.toThrow();
  expect(()=>validateRecoveryRaster(png(1920,1080),240,1,90000)).toThrow('Dimensioni');
  expect(()=>validateRecoveryRaster('data:image/svg+xml;base64,AAAA',1024,16,256000)).toThrow();
});
