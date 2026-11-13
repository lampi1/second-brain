// A ```mermaid or ```chart block of an agent's reply, drawn (owner, 2026-10-22: «grafici e diagrammi con qualche
// libreria figa, per esempio quando chiedo una spiegazione»; the agents are told in their role frame,
// main/agents/orchestrator-role.ts VISUALS_RULE). The drawing libraries load on first use (dynamic import of
// lib/viz/mermaid.ts and lib/viz/chart.ts: their own chunks, never on the first screen). A diagram is an image built
// from mermaid's SVG (strict security, never inserted as DOM; a click opens it large in ImageZoom); a chart is a
// Chart.js canvas from the checked spec of lib/chart-spec.ts. Both follow the app's tokens and redraw when the theme
// changes. While the message streams, or when the block cannot be drawn (bad syntax, invalid spec, a library that
// failed to load), it is the plain code block it was (CodeBlock.tsx). The header has "Codice" (the source) and "Copia".
// Used by ChatItems.tsx (Message); pinned by test/unit/chart-spec.test.ts and test/e2e/visuals.spec.ts.
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { CodeBlock } from './CodeBlock';
import { IconChart, IconCheck, IconCopy, IconTerminal } from './Icons';
import { copyText } from '../brain/components/ui';
import { parseChartSpec, chartRows, type ChartSpec } from '../lib/chart-spec';
import { t } from '../i18n';
import '../styles/visuals.css';

const ImageZoom = lazy(() => import('./ImageZoom').then(m => ({ default: m.ImageZoom })));

/** The fence languages drawn instead of shown as code. */
export const isVisualLang = (lang: string): boolean => /^(?:mermaid|chart)$/i.test(lang);

/** Changes when the theme does (picked in Settings, or following Windows): the drawings read the tokens again. */
function useThemeKey(): string {
  const read = () => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  const [key, setKey] = useState(read);
  useEffect(() => {
    const update = () => setKey(read());
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
    mq?.addEventListener('change', update);
    return () => { mo.disconnect(); mq?.removeEventListener('change', update); };
  }, []);
  return key;
}

type Drawn = { src: string; width: number; height: number };

function MermaidView({ code, theme, onFail }: { code: string; theme: string; onFail: () => void }) {
  const [img, setImg] = useState<Drawn | null>(null);
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    let alive = true;
    import('../lib/viz/mermaid').then(m => m.drawMermaid(code)).then(d => { if (alive) setImg(d); }, () => { if (alive) onFail(); });
    return () => { alive = false; };
  }, [code, theme, onFail]);
  if (!img) return <div className="viz-wait" role="status">{t('visuals.drawing')}</div>;
  return <>
    <button type="button" className="viz-diagram" onClick={() => setZoom(true)} title={t('visuals.zoom')} data-testid="viz-diagram">
      <img src={img.src} width={img.width} height={img.height} alt={t('visuals.diagramAlt')} draggable={false} />
    </button>
    {zoom && <Suspense fallback={null}><ImageZoom images={[{ src: img.src, caption: t('visuals.diagram') }]} index={0} onMove={() => {}} onClose={() => setZoom(false)} testBase="viz-zoom" /></Suspense>}
  </>;
}

function ChartView({ spec, theme, onFail }: { spec: ChartSpec; theme: string; onFail: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true, destroy = () => {};
    import('../lib/viz/chart').then(m => { if (alive && canvas.current) { destroy = m.drawChart(canvas.current, spec); setReady(true); } }, () => { if (alive) onFail(); });
    return () => { alive = false; destroy(); };
  }, [spec, theme, onFail]);
  const rows = chartRows(spec);
  const round = spec.type === 'pie' || spec.type === 'doughnut';
  const height = round ? 220 : spec.horizontal ? Math.min(420, Math.max(180, spec.labels.length * 28 + 70)) : 260;
  return <div className="viz-chart" style={{ height }} data-testid="viz-chart" data-ready={ready ? '1' : '0'}>
    <canvas ref={canvas} role="img" aria-label={t('visuals.chartAlt', { title: spec.title ?? spec.series.map(s => s.name).join(', ') })} />
    {/* the numbers for a screen reader: the canvas has none */}
    <table className="sr-only"><tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table>
  </div>;
}

export function VisualBlock({ chatId, itemId, lang, code, streaming }: { chatId: string | null; itemId: string; lang: string; code: string; streaming?: boolean }) {
  const theme = useThemeKey();
  const chart = /^chart$/i.test(lang);
  const spec = useMemo(() => (chart ? parseChartSpec(code) : null), [chart, code]);
  const [failed, setFailed] = useState(false);
  const [source, setSource] = useState(false);
  const [copied, setCopied] = useState(false);
  const fail = useMemo(() => () => setFailed(true), []);
  useEffect(() => setFailed(false), [code]);
  useEffect(() => { if (!copied) return; const id = setTimeout(() => setCopied(false), 1600); return () => clearTimeout(id); }, [copied]);
  // half a block while it streams, or one that cannot be drawn: the code, as before
  if (streaming || failed || (chart && !spec) || !code.trim()) return <CodeBlock chatId={chatId} itemId={itemId} lang={lang} code={code} streaming={streaming} />;
  return (
    <div className="codeblock viz" data-testid="viz" data-kind={chart ? 'chart' : 'mermaid'}>
      <div className="cb-head">
        <span className="cb-lang viz-lang"><IconChart size={12} /> {chart ? t('visuals.chart') : t('visuals.diagram')}</span>
        <span className="sp" />
        <button type="button" className="cb-btn" aria-pressed={source} onClick={() => setSource(s => !s)} data-testid="viz-source">
          {source ? <><IconChart size={12} /> {t('visuals.showVisual')}</> : <><IconTerminal size={12} /> {t('visuals.showCode')}</>}
        </button>
        <button type="button" className="cb-btn" onClick={() => { void copyText(code).then(setCopied); }} data-testid="viz-copy">
          {copied ? <><IconCheck size={12} /> {t('visuals.copied')}</> : <><IconCopy size={12} /> {t('visuals.copy')}</>}
        </button>
      </div>
      {source ? <pre className="cb-code"><code>{code}</code></pre>
        : <div className="viz-body">{spec ? <ChartView spec={spec} theme={theme} onFail={fail} /> : <MermaidView code={code} theme={theme} onFail={fail} />}</div>}
    </div>
  );
}
