// "Prima / Dopo" in the file viewer (the owner, 2026-10-22: «dopo un task di un agente voglio sempre che mi mandi gli
// screenshot prima e dopo, e voglio che passino dal viewer»): a before and an after screenshot an agent named (a
// message, a question, a report; lib/before-after pairing in brain/lib/report-images.ts beforeAfterPair) shown side by
// side, or one over the other with a slider to wipe between them (drag, click, or the arrow keys on the handle). The
// files are read by main as everywhere else (app:askImage: allowed folders, magic bytes, size; AskImages.tsx
// loadLocalImage); an image already in hand (a report's embedded data: URL) is shown as it is. The layout is
// remembered on this PC. Used by ViewerOverlay.tsx.
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { AskImageResult } from '@shared/contract';
import type { ViewerChrome } from '../../brain/pages/FileViewer';
import { Seg } from '../../brain/components/ui';
import { openFileViewer } from '../../actions';
import type { Shot, ViewerEntry } from '../../lib/viewer-stack';
import { loadLocalImage } from '../AskImages';
import { t } from '../../i18n';

type Layout = 'side' | 'slider';
const LAYOUT_KEY = 'sb.viewer.shotsLayout';
const readLayout = (): Layout => { try { return localStorage.getItem(LAYOUT_KEY) === 'slider' ? 'slider' : 'side'; } catch { return 'side'; } };

function useShot(shot: Shot): AskImageResult | null {
  const [res, setRes] = useState<AskImageResult | null>(shot.src ? { kind: 'image', path: shot.path ?? '', dataUrl: shot.src } : null);
  useEffect(() => {
    if (shot.src || !shot.path) return;
    let live = true;
    void loadLocalImage(shot.path).then(r => { if (live) setRes(r); });
    return () => { live = false; };
  }, [shot.src, shot.path]);
  return res;
}

const nameOf = (s: Shot) => s.path?.split(/[\\/]/).pop() || s.caption;
/** The agent's caption, unless it only says which side it is (the pill says that already). */
const captionOf = (s: Shot) => (/^\s*(before|after|prima|dopo|vorher|nachher)\s*$/i.test(s.caption) || s.caption === nameOf(s) ? '' : s.caption);

function Side({ side, shot, res }: { side: 'before' | 'after'; shot: Shot; res: AskImageResult | null }) {
  const caption = captionOf(shot);
  return <figure className={`vw-shot vw-shot-${side}`} data-testid={`viewer-shot-${side}`}>
    <figcaption>
      <span className={`vw-side-pill vw-side-${side}`}>{side === 'before' ? t('viewer.imageBefore') : t('viewer.imageAfter')}</span>
      {caption && <span className="vw-shot-caption" title={caption}>{caption}</span>}
      <span className="vw-shot-name" title={shot.path ?? shot.caption}>{nameOf(shot)}</span>
      {shot.path && <button type="button" className="vw-link-btn" onClick={() => openFileViewer(shot.path!)}>{t('vw.openFile')}</button>}
    </figcaption>
    <div className="vw-shot-box">
      {!res ? <span className="vw-shot-wait" role="status" aria-label={t('viewer.loading')} />
        : res.kind === 'image' ? <img src={res.dataUrl} alt={shot.caption} draggable={false} />
          : <p className="vw-shot-bad" role="note">{t('vw.shotMissing', { reason: res.reason })}</p>}
    </div>
  </figure>;
}

function Slider({ before, after, b, a }: { before: Shot; after: Shot; b: AskImageResult | null; a: AskImageResult | null }) {
  const [pos, setPos] = useState(50);
  const [ratio, setRatio] = useState(16 / 10);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);
  const at = (e: PointerEvent<HTMLDivElement>) => {
    const r = box.current?.getBoundingClientRect();
    if (r?.width) setPos(Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)));
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return; // Alt+←/→ move between the viewer's entries
    const step = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -2 : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 2 : e.key === 'PageDown' ? -10 : e.key === 'PageUp' ? 10 : 0;
    if (step) { e.preventDefault(); e.stopPropagation(); setPos(p => Math.max(0, Math.min(100, p + step))); }
    else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); e.stopPropagation(); setPos(e.key === 'Home' ? 0 : 100); }
  };
  const ok = a?.kind === 'image' && b?.kind === 'image';
  if (!ok) return <div className="vw-shots-side"><Side side="before" shot={before} res={b} /><Side side="after" shot={after} res={a} /></div>;
  return <div className="vw-slider-stage">
    <div ref={box} className="vw-slider" style={{ ['--pos' as string]: `${pos}%`, ['--ratio' as string]: String(ratio) }} data-testid="viewer-slider" data-pos={Math.round(pos)}
      onPointerDown={e => { if (!e.isPrimary || e.button !== 0) return; drag.current = e.pointerId; e.currentTarget.setPointerCapture(e.pointerId); at(e); }}
      onPointerMove={e => { if (drag.current === e.pointerId) at(e); }}
      onPointerUp={e => { if (drag.current === e.pointerId) drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}>
      <img className="vw-slider-after" src={a.dataUrl} alt={after.caption} draggable={false}
        onLoad={e => { const i = e.currentTarget; if (i.naturalWidth && i.naturalHeight) setRatio(i.naturalWidth / i.naturalHeight); }} />
      <img className="vw-slider-before" src={b.dataUrl} alt={before.caption} draggable={false} />
      <span className="vw-side-pill vw-side-before vw-slider-tag-l">{t('viewer.imageBefore')}</span>
      <span className="vw-side-pill vw-side-after vw-slider-tag-r">{t('viewer.imageAfter')}</span>
      <div className="vw-slider-handle" role="slider" tabIndex={0} aria-label={t('vw.sliderLabel')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pos)}
        aria-valuetext={t('vw.sliderValue', { n: Math.round(pos) })} onKeyDown={key} data-testid="viewer-slider-handle">
        <span className="vw-slider-knob" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 7-5 5 5 5M15 7l5 5-5 5" /></svg>
        </span>
      </div>
    </div>
  </div>;
}

export function ShotsCompare({ entry, chrome }: { entry: Extract<ViewerEntry, { kind: 'shots' }>; chrome: ViewerChrome }) {
  const [layout, setLayoutState] = useState<Layout>(readLayout);
  const setLayout = (l: Layout) => { setLayoutState(l); try { localStorage.setItem(LAYOUT_KEY, l); } catch { /* storage off: this session only */ } };
  const b = useShot(entry.before), a = useShot(entry.after);
  return <div className="bx-viewer vw-file vw-shots" data-testid="viewer-shots" data-layout={layout}>
    <header className="vw-head">
      {chrome.start}
      <span className="vw-badge vw-badge-shots" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M12 3v18" /></svg>
      </span>
      <div className="vw-title">
        <h2 className="vw-name" data-testid="viewer-name">{entry.title ?? t('vw.shotsTitle')}</h2>
        <div className="vw-meta">
          <span className="vw-path" title={entry.before.path ?? entry.before.caption}><bdi>{nameOf(entry.before)}</bdi></span>
          <span className="vw-arrow" aria-hidden="true">→</span>
          <span className="vw-path" title={entry.after.path ?? entry.after.caption}><bdi>{nameOf(entry.after)}</bdi></span>
        </div>
      </div>
      <div className="vw-actions">
        <Seg label={t('vw.shotsLayout')} value={layout} onChange={setLayout} items={[{ id: 'side', label: t('vw.shotsSide') }, { id: 'slider', label: t('vw.shotsSlider') }]} />
        {chrome.end}
      </div>
    </header>
    <div className="vw-stage">
      <div className="vw-body vw-shots-body bx-scroll" data-testid="viewer-body">
        {layout === 'side'
          ? <div className="vw-shots-side"><Side side="before" shot={entry.before} res={b} /><Side side="after" shot={entry.after} res={a} /></div>
          : <Slider before={entry.before} after={entry.after} b={b} a={a} />}
      </div>
    </div>
  </div>;
}
