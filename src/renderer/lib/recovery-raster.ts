// No image element/decoder sees recovered bytes before magic and bounded dimensions have been checked.
import {avatarRasterSize} from './avatar-raster';
import {t} from '../i18n';
export function validateRecoveryRaster(dataUrl:string,max:number,min:number,maxBytes:number):void{
  const match=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl);
  if(!match||match[2]!.length>Math.ceil(maxBytes/3)*4)throw Error(t('appText.raster.draftImage'));
  let decoded:string;try{decoded=atob(match[2]!);}catch{throw Error(t('appText.raster.copyInvalid'));}
  if(decoded.length>maxBytes)throw Error(t('appText.raster.copyTooBig'));
  const bytes=Uint8Array.from(decoded,char=>char.charCodeAt(0));
  if(!avatarRasterSize(bytes,match[1]!,{min,max}))throw Error(t('appText.raster.copyFormat'));
}
