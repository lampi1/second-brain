// Validate authorized IPC raster bytes before any image decoder; path authorization remains entirely in main.
import type {AskImageResult} from '@shared/contract';
import {avatarRasterSize} from './avatar-raster';
export function safePreviewRaster(result:AskImageResult):AskImageResult{
  if(result.kind!=='image')return result;
  const refused:AskImageResult={kind:'refused',reason:'Anteprima non verificabile: PNG, JPEG o WebP statico, massimo 4 MB, 8192 pixel per lato e 16 milioni di pixel.'};
  const match=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(result.dataUrl);
  if(!match||match[2]!.length>5_333_336)return refused;
  let bytes:Uint8Array;try{const text=atob(match[2]!);if(text.length>4_000_000)return refused;bytes=Uint8Array.from(text,char=>char.charCodeAt(0));}catch{return refused;}
  const size=avatarRasterSize(bytes,match[1]!,{min:1,max:8192});
  return size&&size.width*size.height<=16_000_000?result:refused;
}
