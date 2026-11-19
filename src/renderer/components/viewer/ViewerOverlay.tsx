// The file viewer as an overlay above the page (the owner, 2026-10-22: «il viewer non in un'altra pagina ma in una
// modale o un overlay che si può espandere a tutto schermo, con una UI fighissima»): every file link, the palette's
// sb://file/… and sb://esplora/… links and a before/after pair of screenshots open here, and the page under it keeps its
// state (a chat's scroll, a draft, a table's filter). A floating panel by default, which leaves the Orchestrator column
// free (shell.css --orchestrator-r). "Schermo intero" (F11) is a real full screen (ADR 0328, the owner 2026-11-19: «deve
// prendere davvero tutto lo schermo»): the viewer covers the whole window, the Orchestrator column, the top bar and the
// navigation included, the window itself goes on the whole screen ('app:fullScreen', main/full-screen.ts) and the file
// uses all the width; Esc goes back to the panel. Esc again, Ctrl+W, the × or a click outside close it; ‹ › and Alt+←/→
// move between everything opened in it this session (lib/viewer-stack.ts). It registers as an overlay,
// so the browser tabs' native views (WebContentsViews, always above the page) hide under it (lib/viewports.ts). The
// keys inside it stay inside it: Tab cycles in the panel, nothing reaches the page. Mounted by App.tsx while the viewer
// is open; the file itself is brain/pages/FileViewer.tsx (CitedFile), the screenshots ShotsCompare.tsx.
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { readFileViewArg } from '@shared/file-view';
import { CitedFile, type ViewerChrome } from '../../brain/pages/FileViewer';
import { Toaster } from '../../brain/components/ui';
import { Empty } from '../../brain/components/States';
import '../../brain/brain.css';
import '../../styles/viewer.css';
import { closeViewer, toggleViewerFull, viewerStep } from '../../actions';
import { registerOverlay } from '../../lib/viewports';
import { canStep, currentEntry } from '../../lib/viewer-stack';
import { ui } from '../../store/ui';
import { IconArrowLeft, IconArrowRight, IconMaximize, IconMinimize, IconX } from '../Icons';
import { Keys } from '../ui';
import { ShotsCompare } from './ShotsCompare';
import { t } from '../../i18n';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ViewerOverlay() {
  const v = ui.use(s => s.viewer);
  const entry = currentEntry(v);
  const layer = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  // the native browser views hide before the overlay paints over them, and come back when it closes
  useLayoutEffect(() => (layer.current ? registerOverlay(layer.current) : undefined), []);
  // the keyboard moves into the viewer, and back to where it was when the viewer closes
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.focus({ preventScroll: true });
    return () => { if (prev?.isConnected) prev.focus({ preventScroll: true }); };
  }, []);
  // the full screen: the app window on the whole screen while it lasts (a closed viewer leaves it: this effect's end)
  const full = v.full && v.open;
  useEffect(() => {
    if (!full || !window.sb) return;
    void window.sb.invoke('app:fullScreen', { on: true }).catch(() => undefined);
    return () => { void window.sb.invoke('app:fullScreen', { on: false }).catch(() => undefined); };
  }, [full]);
  // another entry: the keyboard is on the panel (the old entry's focused control is gone)
  const id = entry ? (entry.kind === 'file' ? entry.arg : `${entry.before.path ?? ''}|${entry.after.path ?? ''}`) : '';
  useEffect(() => { if (!panel.current?.contains(document.activeElement)) panel.current?.focus({ preventScroll: true }); }, [id]);
  if (!entry) return null;
  const back = canStep(v, -1), forward = canStep(v, 1);
  const chrome: ViewerChrome = {
    start: <div className="vw-nav" role="group" aria-label={t('vw.history')}>
      <button type="button" className="vw-icon-btn" disabled={!back} onClick={() => viewerStep(-1)} aria-label={t('vw.back')} data-tip={`${t('vw.back')}|Alt+←`} data-testid="viewer-back"><IconArrowLeft size={15} /></button>
      <button type="button" className="vw-icon-btn" disabled={!forward} onClick={() => viewerStep(1)} aria-label={t('vw.forward')} data-tip={`${t('vw.forward')}|Alt+→`} data-testid="viewer-forward"><IconArrowRight size={15} /></button>
    </div>,
    end: <>
      <span className="vw-sep" aria-hidden="true" />
      <button type="button" className="vw-icon-btn" aria-pressed={v.full} onClick={toggleViewerFull} aria-label={v.full ? t('vw.restore') : t('vw.expand')} data-tip={`${v.full ? t('vw.restore') : t('vw.expand')}|F11`} data-testid="viewer-expand">
        {v.full ? <IconMinimize size={15} /> : <IconMaximize size={15} />}</button>
      <button type="button" className="vw-icon-btn vw-close" onClick={closeViewer} aria-label={t('vw.close')} data-tip={`${t('vw.close')}|Esc`} data-testid="viewer-close"><IconX size={16} /></button>
    </>,
  };
  const reference = entry.kind === 'file' ? readFileViewArg(entry.arg) : null;
  const label = entry.kind === 'file' ? t('vw.label', { name: reference?.path ?? '' }) : t('vw.shotsTitle');
  // Tab and Shift+Tab stay inside the panel, like a dialog's
  const trap = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Tab' || !panel.current) return;
    const all = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(x => x.offsetParent !== null);
    if (!all.length) return;
    const first = all[0]!, last = all[all.length - 1]!, at = document.activeElement;
    if (e.shiftKey && (at === first || at === panel.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
  };
  return (
    <div ref={layer} className={`vw-layer${v.full ? ' is-full' : ''}`} data-testid="viewer-overlay" data-full={v.full ? 'true' : undefined}
      onPointerDown={e => { if (e.target === e.currentTarget) closeViewer(); }}>
      <section ref={panel} className="vw-panel bx" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} onKeyDown={trap}>
        {entry.kind === 'file'
          ? reference ? <CitedFile key={entry.arg} reference={reference} chrome={chrome} /> : <Empty title={t('viewer.chooseFile')} />
          : <ShotsCompare key={id} entry={entry} chrome={chrome} />}
        <footer className="vw-foot" aria-hidden="true">
          <span><Keys combo="Esc" /> {v.full ? t('vw.restore') : t('vw.hintClose')}</span>
          {entry.kind === 'file' && <span><Keys combo="Ctrl+F" /> {t('vw.hintFind')}</span>}
          <span><Keys combo="Alt+← →" /> {t('vw.hintNav')}</span>
          {!v.full && <span><Keys combo="F11" /> {t('vw.expand')}</span>}
        </footer>
        <Toaster />
      </section>
    </div>
  );
}
