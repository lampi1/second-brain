// Persistent coordinator column with the Orchestrator. The shell and native overlays share its exact width;
// pointer and keyboard resizing preserve a usable workspace without covering inputs.
import { ErrorBoundary } from './ErrorBoundary';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useApp } from '../store/store';
import { setPrefs, ui } from '../store/ui';
import { registerOverlay, schedule } from '../lib/viewports';
import { scheduleLayer } from '../lib/layer';
import { columnSize, viewport, type Reserve } from '../lib/orchestrator-dock';
import { OrchestratorTile } from './OrchestratorTile';
import { t } from '../i18n';
import { orchestratorIdOf } from '../lib/orchestrator-route';

function useColumnSize() {
  const saved = ui.use(s => s.prefs.orchestratorSize);
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

export function OrchestratorOverlay() {
  const active = useApp(orchestratorIdOf);
  const size = useColumnSize();
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => ref.current ? registerOverlay(ref.current) : undefined, []);
  const resize = (width: number) => {
    const v = viewport();
    const next = columnSize({ w: width / (size.home ? 1 : .78), h: size.h }, v, size.home);
    setPrefs({ orchestratorSize: { w: next.w / (size.home ? 1 : .78), h: size.h } });
    schedule();
  };
  return <aside ref={ref} className="orchestrator-dock orchestrator-ov orchestrator-column" data-placement="right" data-orchestrator-overlay data-testid="orchestrator-overlay"
    aria-label="Orchestrator" style={{ width: size.w, height: size.h, top: size.top, right: 0, bottom: 0 }}>
    <div className="orchestrator-bar">
      <span className="orchestrator-column-title" data-testid="orchestrator-column-title"><span className="orchestrator-column-mark" aria-hidden="true">✦</span>Orchestrator</span>
    </div>
    <div className="orchestrator-body" id="orchestrator-panel"><ErrorBoundary where="orchestrator" compact key={active ?? 'none'}><OrchestratorTile key={active ?? 'none'} chatId={active} /></ErrorBoundary></div>
    <div className="orchestrator-column-resize" role="separator" tabIndex={0} aria-label={t('home.orchestratorWidth')} aria-orientation="vertical"
      aria-valuemin={280} aria-valuemax={Math.max(280, viewport().W - viewport().left - 360)} aria-valuenow={size.w} data-testid="orchestrator-resize"
      onPointerDown={event => { if (event.button !== 0) return; drag.current = { x: event.clientX, w: size.w }; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); }}
      onPointerMove={event => { if (drag.current) resize(drag.current.w + drag.current.x - event.clientX); }}
      onPointerUp={event => { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }}
      onLostPointerCapture={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
      onDoubleClick={() => setPrefs({ orchestratorSize: null })}
      onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); resize(size.w + (event.key === 'ArrowLeft' ? 24 : -24)); } else if (event.key === 'Home') { event.preventDefault(); setPrefs({ orchestratorSize: null }); } }} />
  </aside>;
}
