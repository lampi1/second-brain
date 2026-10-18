// Persistent coordinator column. The shell and native overlays share its exact width;
// pointer and keyboard resizing preserve a usable workspace without covering inputs.
import { t as auditText } from '../i18n';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useApp } from '../store/store';
import { openModal, setPrefs, ui } from '../store/ui';
import { registerOverlay, schedule } from '../lib/viewports';
import { scheduleLayer } from '../lib/layer';
import { columnSize, viewport, type Reserve } from '../lib/regia-dock';
import { RegiaTile } from './RegiaTile';
import { IconList } from './Icons';
import { IconButton } from './ui';
import { t } from '../i18n';
import { orchestratorIdOf } from '../lib/regia-route';

export function StatoButton() {
  return <IconButton label={auditText('audit.RegiaOverlay.statusChatsAndPrs')} shortcut="Ctrl+Shift+S" onClick={() => openModal('stato')} testid="stato-btn"><IconList size={16} /></IconButton>;
}

function useColumnSize() {
  const saved = ui.use(s => s.prefs.regiaSize);
  const home = ui.use(s => s.page === 'home' && !s.map);
  const [v, setV] = useState(viewport);
  useEffect(() => {
    const measure = () => setV(viewport());
    const observer = new ResizeObserver(measure);
    for (const selector of ['.shell', '.sidebar']) {
      const element = document.querySelector(selector);
      if (element) observer.observe(element);
    }
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  return { ...columnSize(saved, v, home), top: v.top, home };
}

export function useDockReserve(): Reserve {
  const size = useColumnSize();
  useEffect(() => { scheduleLayer(); }, [size.w, size.h]);
  return { right: size.w, bottom: 0, top: 0 };
}

export function RegiaOverlay() {
  const active = useApp(orchestratorIdOf);
  const size = useColumnSize();
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => ref.current ? registerOverlay(ref.current) : undefined, []);
  const resize = (width: number) => {
    const v = viewport();
    const next = columnSize({ w: width / (size.home ? 1 : .78), h: size.h }, v, size.home);
    setPrefs({ regiaSize: { w: next.w / (size.home ? 1 : .78), h: size.h } });
    schedule();
  };
  return <aside ref={ref} className="regia-dock regia-ov regia-column" data-placement="right" data-regia-overlay data-testid="regia-overlay"
    aria-label="Orchestrator" style={{ width: size.w, height: size.h, top: size.top, right: 0, bottom: 0 }}>
    <div className="regia-bar"><span className="regia-column-mark" aria-hidden="true">✦</span><strong>Orchestrator</strong><span className="sp" /><span className="regia-column-hint">{t('home.startHere')}</span></div>
    <div className="regia-body" id="regia-panel"><RegiaTile key={active ?? 'none'} chatId={active} /></div>
    <div className="regia-column-resize" role="separator" tabIndex={0} aria-label={t('home.regiaWidth')} aria-orientation="vertical"
      aria-valuemin={280} aria-valuemax={Math.max(280, viewport().W - viewport().left - 360)} aria-valuenow={size.w} data-testid="regia-resize"
      onPointerDown={event => { if (event.button !== 0) return; drag.current = { x: event.clientX, w: size.w }; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); }}
      onPointerMove={event => { if (drag.current) resize(drag.current.w + drag.current.x - event.clientX); }}
      onPointerUp={event => { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }}
      onLostPointerCapture={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
      onDoubleClick={() => setPrefs({ regiaSize: null })}
      onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); resize(size.w + (event.key === 'ArrowLeft' ? 24 : -24)); } else if (event.key === 'Home') { event.preventDefault(); setPrefs({ regiaSize: null }); } }} />
  </aside>;
}
