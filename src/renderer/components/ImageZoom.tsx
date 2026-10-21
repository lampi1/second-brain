// The app's one large-image viewer (issue #83: "the question panel look is the reference"): an image opened from a
// thumbnail (a question's, a chat message's) or from a report in the file viewer, with its caption, ← → between the
// images of the same place, Esc or a click outside closes it. It is the app's open dialog (ui.modal 'visual'): a new
// question never takes its keyboard, another dialog closes it, and the events stop here, so nothing pressed in the
// viewer answers a question behind it. Only data: URLs reach it (main read the file, or the report embedded it).
// Report images additionally hand normalized regions to FileViewer's review form after an explicit user action.
// Used by AskImages.tsx (questions, chat messages) and, loaded on demand, by brain/components/ReportImages.tsx.
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode, type SyntheticEvent } from 'react';
import { flushSync } from 'react-dom';
import { dispatchReportReview } from '../brain/lib/report-review';
import '../styles/image-review.css';
import { closeModal, openModal, ui } from '../store/ui';
import { IconArrowLeft, IconArrowRight, IconX } from './Icons';
import { Modal } from './ui';
import { t } from '../i18n';

export interface ZoomImage { src: string; caption: string; imagePath?: string; reportFile?: string }
type Region = { x: number; y: number; width: number; height: number };

export function ImageZoom({ images, index, onMove, onClose, testBase }: { images: readonly ZoomImage[]; index: number; onMove: (index: number) => void; onClose: () => void; testBase: string }) {
  const cur = images[index];
  const many = images.length > 1;
  const image = useRef<HTMLImageElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; x: number; y: number } | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [region, setRegion] = useState<Region>();
  const [dimensions, setDimensions] = useState<{ naturalWidth: number; naturalHeight: number }>();
  useLayoutEffect(() => {
    const pointer = drag.current?.pointer;
    drag.current = null;
    if (pointer !== undefined && stage.current?.hasPointerCapture(pointer)) stage.current.releasePointerCapture(pointer);
    setSelecting(false);
    setRegion(undefined);
    const el = image.current;
    setDimensions(el?.complete && el.naturalWidth ? { naturalWidth: el.naturalWidth, naturalHeight: el.naturalHeight } : undefined);
  }, [index, cur?.src, cur?.imagePath, cur?.reportFile]);
  const point = (e: PointerEvent<HTMLDivElement>) => {
    const bounds = image.current?.getBoundingClientRect();
    if (!bounds?.width || !bounds.height) return null;
    return { x: Math.max(0, Math.min(1, (e.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (e.clientY - bounds.top) / bounds.height)) };
  };
  const updateRegion = (e: PointerEvent<HTMLDivElement>) => {
    const start = drag.current, end = point(e);
    if (!start || start.pointer !== e.pointerId || !end) return;
    setRegion({ x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(start.x - end.x), height: Math.abs(start.y - end.y) });
  };
  const cancelDrag = () => { if (drag.current) { drag.current = null; setRegion(undefined); } };
  const review = (selected?: Region) => {
    if (!cur?.reportFile || !dimensions || drag.current) return;
    const file = cur.reportFile;
    const target = { kind: 'image' as const, imagePath: cur.imagePath, caption: cur.caption, region: selected, ...dimensions };
    // Fully remove the visual modal (including its focus and ui.modal cleanup) before opening the review form.
    flushSync(onClose);
    dispatchReportReview(file, target);
  };
  const move = (d: number) => onMove((index + d + images.length) % images.length);
  useEffect(() => {
    if (!many || ui.get().modal !== 'visual') return;
    const k = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && (e.target.closest('input, textarea, select') || e.target.isContentEditable)) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); move(e.key === 'ArrowRight' ? 1 : -1); }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  });
  if (!cur) return null;
  return (
    <Viewer onClose={onClose}>
      <Modal onClose={onClose} label={t('chat.images.viewerLabel', { caption: cur.caption })} testid={`${testBase}-img-viewer`} className={`img-viewer ask-img-viewer${cur.reportFile ? ' report-image-viewer' : ''}`}>
        {cur.reportFile ? <>
          <div ref={stage} className={`report-image-stage${selecting ? ' selecting' : ''}`}
            onPointerDown={e => {
              if (drag.current || !selecting || !dimensions || !e.isPrimary || e.button !== 0) return;
              const start = point(e);
              if (!start) return;
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { pointer: e.pointerId, ...start };
              setRegion(undefined);
            }}
            onPointerMove={updateRegion}
            onPointerUp={e => {
              if (drag.current?.pointer !== e.pointerId) return;
              updateRegion(e);
              drag.current = null;
              if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}>
            <img key={cur.src} ref={image} src={cur.src} alt={cur.caption} draggable={false}
              onLoad={e => setDimensions({ naturalWidth: e.currentTarget.naturalWidth, naturalHeight: e.currentTarget.naturalHeight })}
              onError={() => { setDimensions(undefined); setRegion(undefined); }} />
            {region && <div className="report-image-region" aria-hidden="true" style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }} />}
          </div>
          <div className="report-image-tools">
            <button type="button" className="btn btn-s btn-ghost" aria-pressed={selecting} disabled={!dimensions} onClick={() => { setSelecting(!selecting); setRegion(undefined); }}>{t('report.image.select')}</button>
            <button type="button" className="btn btn-s btn-ghost" disabled={!region} onClick={() => { setRegion(undefined); setSelecting(false); }}>{t('report.image.clear')}</button>
            <button type="button" className="btn btn-s btn-ghost" disabled={!region || region.width <= 0 || region.height <= 0} onClick={() => review(region)}>{t('report.image.commentRegion')}</button>
            <button type="button" className="btn btn-s btn-ghost" disabled={!dimensions} onClick={() => review()}>{t('report.image.commentWhole')}</button>
            {selecting && <span className="report-image-hint" role="status">{t('report.image.hint')}</span>}
          </div>
        </> : <img src={cur.src} alt={cur.caption} />}
        <div className="ask-img-bar">
          {many && <button type="button" className="img-viewer-nav" onClick={() => move(-1)} aria-label={t('chat.images.previous')} data-testid={`${testBase}-img-prev`}><IconArrowLeft size={14} /></button>}
          <span className="ask-img-cap">{cur.caption}{many ? t('chat.images.count', { current: index + 1, total: images.length }) : ''}</span>
          {many && <button type="button" className="img-viewer-nav" onClick={() => move(1)} aria-label={t('chat.images.next')} data-testid={`${testBase}-img-next`}><IconArrowRight size={14} /></button>}
        </div>
        <button type="button" className="img-viewer-x" onClick={onClose} aria-label={t('chat.images.close')} data-autofocus><IconX size={14} /></button>
      </Modal>
    </Viewer>
  );
}

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
