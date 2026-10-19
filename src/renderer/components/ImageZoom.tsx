// The app's one large-image viewer (issue #83: "the question panel look is the reference"): an image opened from a
// thumbnail (a question's, a chat message's) or from a report in the file viewer, with its caption, ← → between the
// images of the same place, Esc or a click outside closes it. It is the app's open dialog (ui.modal 'visual'): a new
// question never takes its keyboard, another dialog closes it, and the events stop here, so nothing pressed in the
// viewer answers a question behind it. Only data: URLs reach it (main read the file, or the report embedded it).
// Used by AskImages.tsx (questions, chat messages) and, loaded on demand, by brain/components/ReportImages.tsx.
import { useEffect, useLayoutEffect, useRef, type ReactNode, type SyntheticEvent } from 'react';
import { closeModal, openModal, ui } from '../store/ui';
import { IconArrowLeft, IconArrowRight, IconX } from './Icons';
import { Modal } from './ui';
import { t } from '../i18n';

export interface ZoomImage { src: string; caption: string }

export function ImageZoom({ images, index, onMove, onClose, testBase }: { images: readonly ZoomImage[]; index: number; onMove: (index: number) => void; onClose: () => void; testBase: string }) {
  const cur = images[index];
  const many = images.length > 1;
  const move = (d: number) => onMove((index + d + images.length) % images.length);
  useEffect(() => {
    if (!many || ui.get().modal !== 'visual') return;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); move(e.key === 'ArrowRight' ? 1 : -1); }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  });
  if (!cur) return null;
  return (
    <Viewer onClose={onClose}>
      <Modal onClose={onClose} label={t('chat.images.viewerLabel', { caption: cur.caption })} testid={`${testBase}-img-viewer`} className="img-viewer ask-img-viewer">
        <img src={cur.src} alt={cur.caption} />
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
