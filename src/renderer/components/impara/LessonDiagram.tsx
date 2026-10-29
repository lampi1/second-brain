// The lesson's blackboard (ADR 0181): the lesson's flowchart drawn by the app's diagram viewer (lib/viz/mermaid.ts:
// strict, an image, never DOM) with the piece's nodes lit, the ones seen before calm and the rest dimmed (shared/lesson.ts
// withFocus: the app adds the classes, the model only names node ids), or the piece's own diagram. A new piece fades in
// over the old one, so the picture grows instead of jumping. «Tutto lo schema» shows it without focus, «Ingrandisci»
// opens it in the app's image viewer (ImageZoom). A diagram that cannot be drawn shows its code. Used by ImparaPlayer.tsx.
import { useEffect, useRef, useState } from 'react';
import { withFocus } from '@shared/lesson';
import { focusColors } from '../../lib/impara';
import { ui } from '../../store/ui';
import { t } from '../../i18n';
import { ImageZoom } from '../ImageZoom';

interface Drawn { key: number; src: string; width: number; height: number }
/** big labels, tight spacing: the board is small and the words must read from a step back */
const BOARD = { fontSize: 18, nodeSpacing: 34, rankSpacing: 42 };

export function LessonDiagram({ base, own, focus, done, whole, note, caption, zoom, onZoom }: {
  base: string; own?: string; focus: readonly string[]; done: readonly string[]; whole: boolean; note?: string; caption: string;
  /** «Ingrandisci» (the board's tool) or a double click: the drawing in the image viewer */
  zoom: boolean; onZoom: (on: boolean) => void;
}) {
  const theme = ui.use(s => `${s.prefs.theme}/${JSON.stringify(s.prefs.appearance)}`);
  const code = own ?? (whole || !base ? base : withFocus(base, focus, done, focusColors()));
  const [layers, setLayers] = useState<Drawn[]>([]);
  const [broken, setBroken] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    if (!code.trim()) return;
    let alive = true;
    const key = ++seq.current;
    import('../../lib/viz/mermaid').then(m => m.drawMermaid(code, BOARD)).then(d => {
      if (!alive) return;
      setBroken(false);
      setLayers(prev => [...prev.slice(-1), { key, ...d }]);
    }, () => { if (alive) setBroken(true); });
    return () => { alive = false; };
  }, [code, theme]);
  // the old layer leaves once the new one has faded in
  useEffect(() => {
    if (layers.length < 2) return;
    const id = setTimeout(() => setLayers(l => l.slice(-1)), 520);
    return () => clearTimeout(id);
  }, [layers]);
  const top = layers.at(-1);
  return (
    <div className="ip-diagram" data-testid="impara-diagram" data-focus={own ? 'own' : focus.join(',')}>
      {broken && !top && <pre className="ip-diagram-code" data-testid="impara-diagram-code">{code}</pre>}
      {layers.map((d, i) => (
        <img key={d.key} className={`ip-diagram-img ${i === layers.length - 1 ? 'in' : 'out'}`} src={d.src} alt={caption} draggable={false}
          style={{ maxWidth: `min(100%, ${Math.round(d.width * 1.6)}px)`, maxHeight: `min(100%, ${Math.round(d.height * 1.6)}px)` }} onDoubleClick={() => onZoom(true)} />
      ))}
      {note && !whole && <div className="ip-note" data-testid="impara-note" key={note}><b>{t('impara.here')}</b> {note}</div>}
      {zoom && top && <ImageZoom images={[{ src: top.src, caption }]} index={0} onMove={() => {}} onClose={() => onZoom(false)} testBase="impara-zoom" />}
    </div>
  );
}
