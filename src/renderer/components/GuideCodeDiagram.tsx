// A Guida card's diagram drawn from the code (ADR 0196): the mermaid flowchart shared/guide-diagrams.ts builds from the
// app's own constants (roles and their launches, delegation limits, contract channel groups), drawn by lib/viz/mermaid.ts
// (loaded on demand: strict, shown as an image, never DOM) in the app's theme tokens and drawn again when the theme
// changes. A drawing that fails shows the mermaid code. «Ingrandisci» opens it in the app's image viewer. Used by
// GuidePage.tsx in a card's reading panel.
import { useEffect, useState } from 'react';
import { codeDiagram } from '@shared/guide-diagrams';
import type { GuideLang } from '@shared/concept-guide';
import { ui } from '../store/ui';
import { t } from '../i18n';
import { ImageZoom } from './ImageZoom';

export function GuideCodeDiagram({ cardId, title, l }: { cardId: string; title: string; l: GuideLang }) {
  const code = codeDiagram(cardId, l);
  const theme = ui.use(s => `${s.prefs.theme}/${JSON.stringify(s.prefs.appearance)}`);
  const [img, setImg] = useState<{ src: string; width: number; height: number } | null>(null);
  const [broken, setBroken] = useState(false);
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    if (!code) return;
    let alive = true;
    import('../lib/viz/mermaid').then(m => m.drawMermaid(code, { fontSize: 13, nodeSpacing: 30, rankSpacing: 38 })).then(
      d => { if (alive) { setImg(d); setBroken(false); } },
      () => { if (alive) setBroken(true); });
    return () => { alive = false; };
  }, [code, theme]);
  if (!code) return null;
  const caption = t('guide.codeDiagram', { title });
  return (
    <section className="guide-sec guide-code-diagram" data-testid={`guide-code-diagram-${cardId}`}>
      <h4>{t('guide.fromCode')}</h4>
      <figure>
        {img ? <button type="button" className="guide-code-img" onClick={() => setZoom(true)} aria-label={t('guide.zoom')} data-tip={t('guide.zoom')}>
          <img src={img.src} alt={caption} draggable={false} style={{ maxWidth: `min(100%, ${img.width}px)` }} />
        </button>
          : broken ? <pre className="guide-code-src">{code}</pre>
          : <span className="guide-code-wait" role="status">{t('guide.drawing')}</span>}
        <figcaption>{t('guide.fromCodeNote')}</figcaption>
      </figure>
      {zoom && img && <ImageZoom images={[{ src: img.src, caption }]} index={0} onMove={() => {}} onClose={() => setZoom(false)} testBase="guide-zoom" />}
    </section>
  );
}
