// The images a question names (lib/askImages.ts), shown in the question itself (the user, 2026-10-14: "mi piacerebbe
// che le immagini si potessero vedere direttamente nella domanda"): thumbnails with their caption, a click opens them
// large inside the app (ImageZoom.tsx: ← → move between them, Esc or a click outside closes; the Esc never reaches the question).
// main reads each file once (app:askImage: allowed folders, magic bytes, size) and hands a data: URL; one that is
// missing or refused says why in one line instead. Used by AskContext.tsx (every size of the panel that has a context).
import { t as auditText } from '../i18n';
import { memo, useCallback, useEffect, useState } from 'react';
import type { AskImageResult } from '@shared/contract';
import type { AskImage } from '../lib/askImages';
import { sb } from '../sb';
import {safePreviewRaster} from '../lib/preview-raster';
import {currentImageResults,imageResultsKey,type ImageResults} from '../lib/image-results';
import { openFile } from './GenUi';
import { ImageZoom } from './ImageZoom';
import { t } from '../i18n';

/** Each image read once per session (a question re-rendered, or shown again in another size, asks nothing more); a
 *  file missing, refused or busy is asked again next time (it may be there by then). */
const cache = new Map<string, Promise<AskImageResult>>();
export const loadLocalImage = (p: string): Promise<AskImageResult> => {
  let hit = cache.get(p);
  if (!hit) {
    hit = sb.invoke('app:askImage', { path: p }).then(safePreviewRaster).catch((e: unknown): AskImageResult => ({ kind: 'refused', reason: String((e as Error)?.message ?? e) }));
    cache.set(p, hit);
    void hit.then(r => { if (r.kind !== 'image' && cache.get(p) === hit) cache.delete(p); });
    if (cache.size > 64) cache.delete(cache.keys().next().value as string);
  }
  return hit;
};

function useImages(list: readonly AskImage[]): (AskImageResult | null)[] {
  const key = imageResultsKey(list.map(i=>i.path));
  const [res, setRes] = useState<ImageResults>(() => ({key,values:list.map(() => null)}));
  useEffect(() => {
    let live = true;
    setRes({key,values:list.map(() => null)});
    list.forEach((im, i) => { void loadLocalImage(im.path).then(r => { if (live) setRes(prev => { if(prev.key!==key)return prev;const values = [...prev.values]; values[i] = r; return {key,values}; }); }); });
    return () => { live = false; };
  }, [key]); // the paths are the key
  return currentImageResults(list.map(i=>i.path),res);
}

export const AskImages = memo(function AskImages({ images, testBase, size = 'm' }: { images: readonly AskImage[]; testBase: string; size?: 'm' | 'l' }) {
  const loaded=useImages(images);
  const [decodeFailed,setDecodeFailed]=useState<Set<string>>(()=>new Set());
  const res=images.map((image,i):AskImageResult|null=>decodeFailed.has(image.path)?{kind:'refused',reason:auditText('cmp.askImages.notImage')}:loaded[i]??null);
  const [open, setOpen] = useState<number | null>(null);
  const shown = images.map((im, i) => ({ im, r: res[i] })).filter((x): x is { im: AskImage; r: Extract<AskImageResult, { kind: 'image' }> } => x.r?.kind === 'image');
  const bad = images.map((im, i) => ({ im, r: res[i] })).filter(x => x.r && x.r.kind !== 'image');
  const close = useCallback(() => setOpen(null), []);
  if (!images.length) return null;
  return (
    <div className={`ask-imgs ask-imgs-${size}`} data-testid={`${testBase}-imgs`}>
      <div className="ask-imgs-row">
        {images.map((im, i) => {
          const r = res[i];
          if (r && r.kind !== 'image') return null;
          const idx = shown.findIndex(x => x.im === im);
          return (
            <figure key={im.path} className="ask-img" data-testid={`${testBase}-img-${i}`}>
              <button type="button" className="ask-img-open" onClick={() => idx >= 0 && setOpen(idx)} disabled={!r} aria-label={t('chat.images.openButtonLabel', { caption: im.caption })} data-tip={t('chat.images.openTip')}>
                {r ? <img src={r.dataUrl} alt={im.caption} draggable={false} onError={()=>setDecodeFailed(previous=>new Set([...previous,im.path]))}/> : <span className="ask-img-wait" aria-hidden="true" />}
              </button>
              <figcaption title={im.caption}>{im.caption}</figcaption>
            </figure>
          );
        })}
      </div>
      {bad.map(x => (
        <div key={x.im.path} className="ask-img-bad" data-testid={`${testBase}-img-bad`}>
          <span>{t('chat.images.notShown', { caption: x.im.caption, reason: x.r!.kind === 'image' ? '' : x.r!.reason })}</span>
          {x.r!.kind === 'refused' && <button type="button" className="gu-link" onClick={() => void openFile(x.im.path)} data-testid={`${testBase}-img-bad-open`}>{t('chat.images.openFile')}</button>}
        </div>
      ))}
      {open !== null && shown.length > 0 && <ImageZoom images={shown.map(x => ({ src: x.r.dataUrl, caption: x.im.caption }))} index={Math.min(open, shown.length - 1)} onMove={setOpen} onClose={close} testBase={testBase} />}
    </div>
  );
});
