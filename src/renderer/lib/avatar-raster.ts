// Bound raster headers before Chromium allocates decoded image memory. UI-only; main repeats authoritative checks.
// No remote URLs or SVG. File bytes are bounded before reading; a decoder still validates the complete raster.
import {t} from '../i18n';
export const AVATAR_BYTES=256_000;
interface Size {width:number;height:number}
export function avatarRasterSize(bytes:Uint8Array,mime:string,bounds={min:16,max:1024}):Size|null {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const ascii=(at:number,n:number)=>String.fromCharCode(...bytes.subarray(at,at+n));
  let size:Size|null=null;
  if(mime==='image/png' && bytes.length>=33 && [137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v) && view.getUint32(8)===13 && ascii(12,4)==='IHDR')size={width:view.getUint32(16),height:view.getUint32(20)};
  if(mime==='image/webp' && bytes.length>=30 && ascii(0,4)==='RIFF' && ascii(8,4)==='WEBP'){
    const kind=ascii(12,4);
    // Extended/animated WebP may contain differently sized image frames. Refuse before any decoder allocation.
    if(kind==='VP8X')return null;
    if(kind==='VP8 ' && bytes[23]===0x9d && bytes[24]===1 && bytes[25]===0x2a)size={width:view.getUint16(26,true)&0x3fff,height:view.getUint16(28,true)&0x3fff};
    if(kind==='VP8L' && bytes[20]===0x2f){const bits=view.getUint32(21,true);size={width:1+(bits&0x3fff),height:1+((bits>>>14)&0x3fff)};}
  }
  if(mime==='image/jpeg' && bytes[0]===0xff && bytes[1]===0xd8){
    let at=2;
    for(let n=0;n<1024 && at+3<bytes.length;n++){
      if(bytes[at++]!==0xff)return null;
      while(bytes[at]===0xff)at++;
      const marker=bytes[at++];
      if(marker===undefined || marker===0xda || marker===0xd9)return null;
      if(marker===1 || marker>=0xd0 && marker<=0xd7)continue;
      if(at+2>bytes.length)return null;
      const length=view.getUint16(at);
      if(length<2 || at+length>bytes.length)return null;
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){
        if(length<7)return null;
        size={height:view.getUint16(at+3),width:view.getUint16(at+5)};break;
      }
      at+=length;
    }
  }
  return size && size.width>=bounds.min && size.height>=bounds.min && size.width<=bounds.max && size.height<=bounds.max ? size:null;
}
export async function validateAvatarImage(file:File,decode:(blob:Blob)=>Promise<{width:number;height:number;close():void}>=createImageBitmap):Promise<void>{
  if(!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size===0 || file.size>AVATAR_BYTES)throw new Error(t('appText.raster.avatarFormat'));
  const bytes=new Uint8Array(await file.arrayBuffer());
  const header=avatarRasterSize(bytes,file.type);
  if(!header)throw new Error(t('appText.raster.avatarSize'));
  const decoded=await decode(file);
  // A decoder may apply EXIF orientation. Swapping bounded sides preserves the allocation bound.
  try{if(!(decoded.width===header.width && decoded.height===header.height || decoded.width===header.height && decoded.height===header.width))throw new Error(t('appText.raster.avatarInvalid'));}
  finally{decoded.close();}
}
