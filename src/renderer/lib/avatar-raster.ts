// Bound raster headers before Chromium allocates decoded image memory. UI-only; main repeats authoritative checks.
// No remote URLs or SVG. File bytes are bounded before reading; a decoder still validates the complete raster.
import {t} from '../i18n';
export const AVATAR_BYTES=256_000;
interface Size {width:number;height:number}
interface Chunk {kind:string;at:number;size:number}
// RIFF chunks between from and to (fourcc, LE size, payload padded to even); null when one overruns the bytes.
function webpChunks(bytes:Uint8Array,view:DataView,from:number,to:number):Chunk[]|null{
  const out:Chunk[]=[];
  for(let at=from;at<to;){
    if(at+8>to || out.length>=1024)return null;
    const size=view.getUint32(at+4,true);
    if(at+8+size>to)return null;
    out.push({kind:String.fromCharCode(...bytes.subarray(at,at+4)),at:at+8,size});
    at+=8+size+(size&1);
  }
  return out;
}
// The frame size a VP8 or VP8L bitstream declares; null for any other chunk or a truncated header.
function bitstreamSize(c:Chunk,bytes:Uint8Array,view:DataView):Size|null{
  if(c.kind==='VP8 ' && c.size>=10 && bytes[c.at+3]===0x9d && bytes[c.at+4]===1 && bytes[c.at+5]===0x2a)return {width:view.getUint16(c.at+6,true)&0x3fff,height:view.getUint16(c.at+8,true)&0x3fff};
  if(c.kind==='VP8L' && c.size>=5 && bytes[c.at]===0x2f){const bits=view.getUint32(c.at+1,true);return {width:1+(bits&0x3fff),height:1+((bits>>>14)&0x3fff)};}
  return null;
}
const u24=(bytes:Uint8Array,at:number)=>bytes[at]!|bytes[at+1]!<<8|bytes[at+2]!<<16;
// Simple WebP: one VP8/VP8L chunk. Extended (VP8X): its canvas, but only when the still image equals it or every
// animation frame lies inside it, so the canvas bounds what any decoder allocates for any frame.
function webpSize(bytes:Uint8Array,view:DataView):Size|null{
  if(bytes.length<20)return null;
  // A simple file needs only its bitstream header here; the decoder validates the rest, as before.
  if(String.fromCharCode(...bytes.subarray(12,16))!=='VP8X')return bitstreamSize({kind:String.fromCharCode(...bytes.subarray(12,16)),at:20,size:bytes.length-20},bytes,view);
  const chunks=webpChunks(bytes,view,12,Math.min(bytes.length,8+view.getUint32(4,true)));
  const first=chunks?.[0];
  if(!first || first.size<10)return null;
  const canvas={width:1+u24(bytes,first.at+4),height:1+u24(bytes,first.at+7)};
  let images=0;
  for(const c of chunks!.slice(1)){
    let frame=bitstreamSize(c,bytes,view),x=0,y=0;
    if(c.kind==='ANMF'){
      if(c.size<16)return null;
      x=2*u24(bytes,c.at);y=2*u24(bytes,c.at+3);
      const declared={width:1+u24(bytes,c.at+6),height:1+u24(bytes,c.at+9)};
      const inner=webpChunks(bytes,view,c.at+16,c.at+c.size)?.map(f=>bitstreamSize(f,bytes,view)).filter(s=>s!==null);
      if(inner?.length!==1 || inner[0]!.width!==declared.width || inner[0]!.height!==declared.height)return null;
      frame=declared;
    }else if(frame && (frame.width!==canvas.width || frame.height!==canvas.height))return null;
    if(!frame)continue;
    if(x+frame.width>canvas.width || y+frame.height>canvas.height)return null;
    images++;
  }
  return images?canvas:null;
}
export function avatarRasterSize(bytes:Uint8Array,mime:string,bounds={min:16,max:1024}):Size|null {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const ascii=(at:number,n:number)=>String.fromCharCode(...bytes.subarray(at,at+n));
  let size:Size|null=null;
  if(mime==='image/png' && bytes.length>=33 && [137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v) && view.getUint32(8)===13 && ascii(12,4)==='IHDR')size={width:view.getUint32(16),height:view.getUint32(20)};
  if(mime==='image/webp' && ascii(0,4)==='RIFF' && ascii(8,4)==='WEBP')size=webpSize(bytes,view);
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
