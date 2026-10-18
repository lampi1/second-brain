// The images a question names (lib/askImages.ts), shown in the question itself (the user, 2026-10-14: "mi piacerebbe
// che le immagini si potessero vedere direttamente nella domanda"): thumbnails with their caption, a click opens them
// large inside the app (← → move between them, Esc or a click outside closes; the Esc never reaches the question).
// main reads each file once (app:askImage: allowed folders, magic bytes, size) and hands a data: URL; one that is
// missing or refused says why in one line instead. Used by AskContext.tsx (every size of the panel that has a context).
import { t as auditText } from '../i18n';
import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import type { AskImageResult } from '@shared/contract';
import type { AskImage } from '../lib/askImages';
import { sb } from '../sb';
import {safePreviewRaster} from '../lib/preview-raster';
import {currentImageResults,imageResultsKey,type ImageResults} from '../lib/image-results';
import { closeModal, openModal, ui } from '../store/ui';
import { openFile } from './GenUi';
import { IconArrowLeft, IconArrowRight, IconX } from './Icons';
import { Modal } from './ui';
import { t } from '../i18n';

/** Each image read once per session (a question re-rendered, or shown again in another size, asks nothing more); a
 *  file missing, refused or busy is asked again next time (it may be there by then). */
const cache = new Map<string, Promise<AskImageResult>>();
const load = (p: string): Promise<AskImageResult> => {
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
    list.forEach((im, i) => { void load(im.path).then(r => { if (live) setRes(prev => { if(prev.key!==key)return prev;const values = [...prev.values]; values[i] = r; return {key,values}; }); }); });
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
  const cur = open === null ? null : shown[open] ?? null;
  const move = (d: number) => setOpen(o => (o === null || !shown.length ? o : (o + d + shown.length) % shown.length));
  useEffect(() => {
    if (open === null || ui.get().modal !== 'visual') return;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); move(e.key === 'ArrowRight' ? 1 : -1); }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  });
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
      {cur && (
        <Viewer onClose={() => setOpen(null)}>
        <Modal onClose={() => setOpen(null)} label={t('chat.images.viewerLabel', { caption: cur.im.caption })} testid={`${testBase}-img-viewer`} className="img-viewer ask-img-viewer">
          <img src={cur.r.dataUrl} alt={cur.im.caption} />
          <div className="ask-img-bar">
            {shown.length > 1 && <button type="button" className="img-viewer-nav" onClick={() => move(-1)} aria-label={t('chat.images.previous')} data-testid={`${testBase}-img-prev`}><IconArrowLeft size={14} /></button>}
            <span className="ask-img-cap">{cur.im.caption}{shown.length > 1 ? t('chat.images.count', { current: (open ?? 0) + 1, total: shown.length }) : ''}</span>
            {shown.length > 1 && <button type="button" className="img-viewer-nav" onClick={() => move(1)} aria-label={t('chat.images.next')} data-testid={`${testBase}-img-next`}><IconArrowRight size={14} /></button>}
          </div>
          <button type="button" className="img-viewer-x" onClick={() => setOpen(null)} aria-label={t('chat.images.close')} data-autofocus><IconX size={14} /></button>
        </Modal>
        </Viewer>
      )}
    </div>
  );
});

/** The viewer as the app's open dialog (like GenUi.tsx FullView): a new question never takes its keyboard, another
 *  dialog closes it; React events bubble through the portal to the card around the thumbnails (a question's digits and
 *  Enter, the questions window's clicks): they stop here, so nothing pressed in the viewer answers anything. */
function Viewer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const modal = ui.use(s => s.modal);
  const seen = useRef(false);
  useLayoutEffect(() => {
    openModal('visual');
    return () => { if (ui.get().modal === 'visual') closeModal(); };
  }, []);
  useLayoutEffect(() => { if (modal === 'visual') seen.current = true; else if (seen.current) onClose(); }, [modal, onClose]);
  const stop = (e: SyntheticEvent) => e.stopPropagation();
  return <span className="gu-full-events" onKeyDown={stop} onMouseDown={stop} onPointerDown={stop} onClick={stop}>{children}</span>;
}
