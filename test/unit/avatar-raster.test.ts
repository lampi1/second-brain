// Header/decode ordering uses synthetic bytes and a fake decoder, never allocates a real raster.
import {expect,it,vi} from 'vitest';
import {avatarRasterSize,validateAvatarImage} from '../../src/renderer/lib/avatar-raster';
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
it('refuses extended WebP before decoding even if its canvas is small',async()=>{
  const bytes=new Uint8Array(64);bytes.set([82,73,70,70],0);bytes.set([87,69,66,80],8);bytes.set([86,80,56,88],12);bytes[24]=31;bytes[27]=31;
  const decode=vi.fn();
  await expect(validateAvatarImage(new File([bytes],'extended.webp',{type:'image/webp'}),decode)).rejects.toThrow('Dimensioni');
  expect(decode).not.toHaveBeenCalled();
});
it('bounds JPEG SOF and simple WebP frame dimensions',()=>{
  const jpeg=new Uint8Array([255,216,255,192,0,7,8,0,32,0,64]);
  expect(avatarRasterSize(jpeg,'image/jpeg')).toEqual({width:64,height:32});
  jpeg[7]=0x7f;expect(avatarRasterSize(jpeg,'image/jpeg')).toBeNull();
  const webp=new Uint8Array(30);webp.set([82,73,70,70],0);webp.set([87,69,66,80,86,80,56,32],8);webp.set([157,1,42],23);webp[26]=64;webp[28]=32;
  expect(avatarRasterSize(webp,'image/webp')).toEqual({width:64,height:32});
});
it('allows EXIF-style swapped bounded dimensions while still closing the bitmap',async()=>{
  const close=vi.fn();
  await validateAvatarImage(new File([png(64,32)],'rotated.png',{type:'image/png'}),async()=>({width:32,height:64,close}));
  expect(close).toHaveBeenCalledOnce();
});
