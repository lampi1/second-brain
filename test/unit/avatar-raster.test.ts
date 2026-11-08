// Header/decode ordering uses synthetic bytes and a fake decoder, never allocates a real raster.
import {expect,it,vi} from 'vitest';
import {avatarRasterSize,validateAvatarImage} from '../../src/renderer/lib/avatar-raster';
import {CHROMIUM_WEBP} from '../fixtures/webp-chromium';
function png(width:number,height:number){const bytes=new Uint8Array(33);bytes.set([137,80,78,71,13,10,26,10]);const v=new DataView(bytes.buffer);v.setUint32(8,13);bytes.set([73,72,68,82],12);v.setUint32(16,width);v.setUint32(20,height);return bytes;}
it('refuses a small compressed file declaring a huge raster before any decode',async()=>{
  const decode=vi.fn();
  await expect(validateAvatarImage(new File([png(20000,20000)],'large.png',{type:'image/png'}),decode)).rejects.toThrow('Dimensioni');
  expect(decode).not.toHaveBeenCalled();
});
it('accepts header bounds only and closes the decoder even for a mismatch',async()=>{
  expect(avatarRasterSize(png(16,1024),'image/png')).toEqual({width:16,height:1024});
  expect(avatarRasterSize(png(15,1024),'image/png')).toBeNull();
  const close=vi.fn();
  await expect(validateAvatarImage(new File([png(32,32)],'small.png',{type:'image/png'}),async()=>({width:64,height:32,close}))).rejects.toThrow('Raster');
  expect(close).toHaveBeenCalledOnce();
});
it('rejects spoofed formats and oversized bytes before decode',async()=>{
  const decode=vi.fn();
  await expect(validateAvatarImage(new File([png(32,32)],'bad.webp',{type:'image/webp'}),decode)).rejects.toThrow();
  await expect(validateAvatarImage(new File([new Uint8Array(256001)],'large.png',{type:'image/png'}),decode)).rejects.toThrow();
  expect(decode).not.toHaveBeenCalled();
});
// WebP builders: a RIFF container of chunks (fourcc, LE size, payload, even padding), as libwebp writes them.
const u24=(n:number)=>[n&255,(n>>8)&255,(n>>16)&255];
function chunk(fourcc:string,payload:number[]){const size=payload.length;return [...fourcc].map(c=>c.charCodeAt(0)).concat([size&255,(size>>8)&255,(size>>16)&255,size>>>24],payload,size%2?[0]:[]);}
function riff(chunks:number[][]){const body=[87,69,66,80,...chunks.flat()],size=body.length;return new Uint8Array([82,73,70,70,size&255,(size>>8)&255,(size>>16)&255,size>>>24,...body]);}
const vp8=(w:number,h:number)=>chunk('VP8 ',[0,0,0,0x9d,1,0x2a,w&255,w>>8,h&255,h>>8]);
const vp8l=(w:number,h:number)=>{const bits=(w-1)|((h-1)<<14);return chunk('VP8L',[0x2f,bits&255,(bits>>8)&255,(bits>>16)&255,bits>>>24]);};
const vp8x=(w:number,h:number,flags=0)=>chunk('VP8X',[flags,0,0,0,...u24(w-1),...u24(h-1)]);
const anmf=(x:number,y:number,w:number,h:number,frame:number[])=>chunk('ANMF',[...u24(x/2),...u24(y/2),...u24(w-1),...u24(h-1),...u24(100),0,...frame]);
it('reads the canvas of an extended WebP with a lossy, lossless or alpha image',async()=>{
  expect(avatarRasterSize(riff([vp8x(64,48),vp8(64,48)]),'image/webp')).toEqual({width:64,height:48});
  expect(avatarRasterSize(riff([vp8x(300,200,0x10),chunk('ALPH',[0,1,2]),vp8(300,200)]),'image/webp')).toEqual({width:300,height:200});
  expect(avatarRasterSize(riff([vp8x(40,40,0x30),chunk('ICCP',[1,2,3,4]),vp8l(40,40),chunk('EXIF',[9])]),'image/webp')).toEqual({width:40,height:40});
  const close=vi.fn();
  await validateAvatarImage(new File([riff([vp8x(64,48),vp8(64,48)])],'extended.webp',{type:'image/webp'}),async()=>({width:64,height:48,close}));
  expect(close).toHaveBeenCalledOnce();
});
it('reads the canvas of the extended WebP files Chromium itself writes',()=>{
  for(const b64 of Object.values(CHROMIUM_WEBP))expect(avatarRasterSize(Uint8Array.from(atob(b64),c=>c.charCodeAt(0)),'image/webp')).toEqual({width:120,height:90});
});
it('reads the canvas of an animated WebP whose frames all fit inside it',()=>{
  const animated=riff([vp8x(100,80,0x12),chunk('ANIM',[0,0,0,0,0,0]),anmf(0,0,100,80,vp8(100,80)),anmf(20,10,50,40,[...chunk('ALPH',[0]),...vp8l(50,40)])]);
  expect(avatarRasterSize(animated,'image/webp')).toEqual({width:100,height:80});
});
it('refuses an extended WebP whose image or frame does not match its small canvas, before decoding',async()=>{
  const decode=vi.fn();
  for(const bytes of [
    riff([vp8x(32,32),vp8(20000,20000)]),
    riff([vp8x(32,32),vp8l(64,32)]),
    riff([vp8x(32,32,0x02),chunk('ANIM',[0,0,0,0,0,0]),anmf(0,0,32,32,vp8(32,32)),anmf(0,0,16000,16000,vp8(16000,16000))]),
    riff([vp8x(32,32,0x02),anmf(20,0,32,32,vp8(32,32))]),
    riff([vp8x(32,32,0x02),anmf(0,0,16,16,vp8(32,32))]),
    riff([vp8x(32,32),chunk('EXIF',[1,2])]),
    riff([vp8x(20000,20000),vp8(20000,20000)]),
    riff([vp8x(32,32),vp8(32,32)]).subarray(0,40),
  ]){
    expect(avatarRasterSize(bytes,'image/webp')).toBeNull();
    await expect(validateAvatarImage(new File([bytes],'extended.webp',{type:'image/webp'}),decode)).rejects.toThrow('Dimensioni');
  }
  expect(decode).not.toHaveBeenCalled();
});
it('bounds JPEG SOF and simple WebP frame dimensions',()=>{
  const jpeg=new Uint8Array([255,216,255,192,0,7,8,0,32,0,64]);
  expect(avatarRasterSize(jpeg,'image/jpeg')).toEqual({width:64,height:32});
  jpeg[7]=0x7f;expect(avatarRasterSize(jpeg,'image/jpeg')).toBeNull();
  const webp=new Uint8Array(30);webp.set([82,73,70,70],0);webp.set([87,69,66,80,86,80,56,32],8);webp.set([157,1,42],23);webp[26]=64;webp[28]=32;
  expect(avatarRasterSize(webp,'image/webp')).toEqual({width:64,height:32});
  expect(avatarRasterSize(riff([vp8(64,32)]),'image/webp')).toEqual({width:64,height:32});
  expect(avatarRasterSize(riff([vp8l(64,32)]),'image/webp')).toEqual({width:64,height:32});
});
it('allows EXIF-style swapped bounded dimensions while still closing the bitmap',async()=>{
  const close=vi.fn();
  await validateAvatarImage(new File([png(64,32)],'rotated.png',{type:'image/png'}),async()=>({width:32,height:64,close}));
  expect(close).toHaveBeenCalledOnce();
});
