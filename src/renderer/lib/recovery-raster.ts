// No image element/decoder sees recovered bytes before magic and bounded dimensions have been checked.
import {avatarRasterSize} from './avatar-raster';
export function validateRecoveryRaster(dataUrl:string,max:number,min:number,maxBytes:number):void{
  const match=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl);
  if(!match||match[2]!.length>Math.ceil(maxBytes/3)*4)throw Error('Un’immagine della bozza non è verificabile per il ripristino. Invia o rimuovi l’allegato prima di aggiornare.');
  let decoded:string;try{decoded=atob(match[2]!);}catch{throw Error('Immagine della copia non valida.');}
  if(decoded.length>maxBytes)throw Error('Immagine della copia troppo grande.');
  const bytes=Uint8Array.from(decoded,char=>char.charCodeAt(0));
  if(!avatarRasterSize(bytes,match[1]!,{min,max}))throw Error('Dimensioni o formato dell’immagine non verificabili per il ripristino. Invia o rimuovi l’allegato prima di aggiornare.');
}
