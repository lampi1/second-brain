// A row of image previews (pasted screenshots): click one to see it big (Esc or a click outside closes it), ✕ to take
// it away when onRemove is given. Used by ChatInput (attachments of the message being written) and ChatItems (a sent
// message's images in the history).
import { t as auditText } from '../i18n';
import { useState } from 'react';
import { IconX } from './Icons';
import { Modal } from './ui';

export interface StripImage { thumb: string; full?: string }

export function ImageStrip({ images, onRemove, testid, size = 'm' }: { images: readonly StripImage[]; onRemove?: (index: number) => void; testid: string; size?: 's' | 'm' }) {
  const [open, setOpen] = useState<number | null>(null);
  const shown = open === null ? null : images[open];
  return (
    <div className={`img-strip img-strip-${size}`} data-testid={testid}>
      {images.map((im, i) => (
        <span className="img-thumb" key={i} data-testid={`${testid}-${i}`}>
          <button type="button" className="img-thumb-open" onClick={() => setOpen(i)} aria-label={auditText('auditExpression.ImageStrip.text60', { v0: i + 1 })} data-tip={auditText('audit.ImageStrip.clickToEnlarge')}>
            <img src={im.thumb} alt={auditText('auditExpression.ImageStrip.text61', { v0: i + 1 })} draggable={false} />
          </button>
          {onRemove && (
            <button type="button" className="img-thumb-x" onClick={() => onRemove(i)} aria-label={auditText('auditExpression.ImageStrip.text62', { v0: i + 1 })} data-testid={`${testid}-${i}-remove`}><IconX size={10} /></button>
          )}
        </span>
      ))}
      {shown && (
        <Modal onClose={() => setOpen(null)} label={auditText('auditExpression.ImageStrip.text63', { v0: (open ?? 0) + 1 })} testid={`${testid}-viewer`} className="img-viewer">
          <img src={shown.full ?? shown.thumb} alt={auditText('auditExpression.ImageStrip.text63', { v0: (open ?? 0) + 1 })} />
          <button type="button" className="img-viewer-x" onClick={() => setOpen(null)} aria-label={auditText('audit.ImageStrip.close')}><IconX size={14} /></button>
        </Modal>
      )}
    </div>
  );
}
