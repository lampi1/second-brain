// A piece's own visual on Impara's board (ADR 0205; owner's report I4: «il modello sceglie il tipo che spiega meglio,
// l'app lo disegna e lo anima»), beside the lesson's animated flowchart (LessonStage.tsx). Each one moves with the beat
// being said: a sequence, state, timeline or mind map (mermaid, drawn as an image by LessonDiagram.tsx) grows one part
// per beat (shared/lesson-visual.ts revealMermaid; the new layer fades in over the old one); a code walkthrough
// highlights the beat's lines with a band that glides from one range to the next and dims the rest (highlight.js, the
// file viewer's own languages and sanitizer settings); a formula (KaTeX, MathML only: no font or stylesheet, sanitized
// by DOMPurify's MathML profile) lights the legend row of the symbol the beat explains; a chart (Chart.js, the same
// drawing as the chat's charts) shows the tooltip of the label the beat points at. «Tutto lo schema» shows it whole. The
// model's text is untrusted throughout: plain text, a sanitized highlight, a sanitized MathML, a canvas. Motion is off
// for reduced-motion users (impara.css). Used by ImparaPlayer.tsx; styles impara.css (.lv-*).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { revealAt, revealMermaid, revealSteps, type LessonVisual as Visual } from '@shared/lesson-visual';
import type { LessonBeat } from '@shared/lesson';
import { parseChartSpec } from '../../lib/chart-spec';
import { highlightLines } from '../../brain/lib/file-format';
import { ui } from '../../store/ui';
import { t } from '../../i18n';
import { LessonDiagram } from './LessonDiagram';

let purify: ReturnType<typeof DOMPurify> | null = null;
const sanitize = (html: string, cfg: Parameters<ReturnType<typeof DOMPurify>['sanitize']>[1]): string => String((purify ??= DOMPurify(window)).sanitize(html, cfg));

export function LessonVisual({ visual, beats, beat, whole, caption }: { visual: Exclude<Visual, { kind: 'flow' }>; beats: readonly LessonBeat[]; beat: number; whole: boolean; caption: string }) {
  const cur = whole ? undefined : beats[Math.min(beat, beats.length - 1)];
  const note = cur?.note;
  return (
    <div className="lv" data-testid="impara-visual" data-kind={visual.kind}>
      {visual.kind === 'code' ? <CodeWalk file={visual.file} code={visual.code} lines={cur?.lines ?? null} />
        : visual.kind === 'formula' ? <Formula tex={visual.tex} where={visual.where} mark={cur?.mark ?? null} />
        : visual.kind === 'chart' ? <ChartView chart={visual.chart} mark={cur?.mark ?? null} caption={caption} />
        : <Grows kind={visual.kind} src={visual.src} beats={beats.length} beat={beat} whole={whole} caption={caption} note={note} />}
      {note && visual.kind !== 'sequence' && visual.kind !== 'state' && visual.kind !== 'timeline' && visual.kind !== 'mindmap' && (
        <div key={`${beat}/${note}`} className="ip-note" data-testid="impara-note"><b>{t('impara.here')}</b> {note}</div>
      )}
    </div>
  );
}

/** A mermaid diagram that grows one part per beat. */
function Grows({ kind, src, beats, beat, whole, caption, note }: { kind: 'sequence' | 'state' | 'timeline' | 'mindmap'; src: string; beats: number; beat: number; whole: boolean; caption: string; note?: string }) {
  const [zoom, setZoom] = useState(false);
  const parts = revealSteps(kind, src);
  const upto = whole || beats < 2 ? parts : revealAt(parts, beat, beats);
  const shown = revealMermaid(kind, src, upto);
  return (
    <div className="lv-grows" data-parts={parts} data-shown={upto}>
      <LessonDiagram base="" own={shown} focus={[]} done={[]} whole={whole} note={note} caption={caption} zoom={zoom} onZoom={setZoom} />
    </div>
  );
}

const LINE_H = 24;
/** Real lines of the material, the beat's range under a gliding band, the rest dimmed. */
function CodeWalk({ file, code, lines }: { file: string; code: string; lines: [number, number] | null }) {
  const [html, setHtml] = useState<string[] | null>(null);
  const text = useMemo(() => code.split('\n'), [code]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    setHtml(null);
    void highlightLines(code, file || 'x.txt', h => sanitize(h, { ALLOWED_TAGS: ['span'], ALLOWED_ATTR: ['class'] })).then(x => { if (live) setHtml(x); }, () => {});
    return () => { live = false; };
  }, [code, file]);
  // the beat's lines brought into view, smoothly
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !lines) return;
    const top = (lines[0] - 1) * LINE_H, bottom = lines[1] * LINE_H;
    if (top < el.scrollTop + 8 || bottom > el.scrollTop + el.clientHeight - 8) el.scrollTo({ top: Math.max(0, top - el.clientHeight / 3), behavior: 'smooth' });
  }, [lines]);
  return (
    <div className="lv-code">
      <div className="lv-code-file">{file || t('impara.codeNoFile')}{lines && <span className="lv-code-at" data-testid="impara-visual-lines">{lines[0] === lines[1] ? t('impara.visual.line', { n: lines[0] }) : t('impara.visual.lines', { a: lines[0], b: lines[1] })}</span>}</div>
      <div className={`lv-code-body ${lines ? 'focused' : ''}`} ref={box}>
        {lines && <i className="lv-band" style={{ top: (lines[0] - 1) * LINE_H, height: (lines[1] - lines[0] + 1) * LINE_H }} aria-hidden="true" />}
        {text.map((line, i) => {
          const n = i + 1, on = !!lines && n >= lines[0] && n <= lines[1];
          return (
            <div key={i} className={`lv-line ${on ? 'on' : ''}`} style={{ height: LINE_H }}>
              <span className="lv-ln">{n}</span>
              {html?.[i] !== undefined ? <code className="hljs" dangerouslySetInnerHTML={{ __html: html[i] || ' ' }} /> : <code>{line || ' '}</code>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A TeX formula as MathML (KaTeX), its symbols explained, the beat's one lit. */
function Formula({ tex, where, mark }: { tex: string; where: readonly { sym: string; meaning: string }[]; mark: string | null }) {
  const [math, setMath] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void import('katex').then(k => {
      const raw = k.default.renderToString(tex, { output: 'mathml', displayMode: true, throwOnError: false, trust: false, strict: 'ignore', maxSize: 20, maxExpand: 200 });
      if (live) setMath(sanitize(raw, { USE_PROFILES: { mathMl: true } }));
    }, () => { if (live) setMath(''); });
    return () => { live = false; };
  }, [tex]);
  return (
    <div className="lv-formula">
      {math ? <div className="lv-math" dangerouslySetInnerHTML={{ __html: math }} /> : <code className="lv-tex">{tex}</code>}
      {where.length > 0 && (
        <dl className="lv-where">
          {where.map(w => <div key={w.sym} className={mark === w.sym ? 'on' : mark ? 'dim' : ''} data-sym={w.sym}><dt>{w.sym}</dt><dd>{w.meaning}</dd></div>)}
        </dl>
      )}
    </div>
  );
}

/** A chart of the facts' numbers; the beat's label shown with its values. */
function ChartView({ chart, mark, caption }: { chart: string; mark: string | null; caption: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const theme = ui.use(s => s.prefs.theme);
  const spec = useMemo(() => parseChartSpec(chart), [chart]);
  const [drawn, setDrawn] = useState(0);
  useEffect(() => {
    const c = canvas.current;
    if (!c || !spec) return;
    let stop: (() => void) | null = null, live = true;
    void import('../../lib/viz/chart').then(m => { if (!live) return; stop = m.drawChart(c, spec); setDrawn(n => n + 1); });
    return () => { live = false; stop?.(); };
  }, [spec, theme]);
  useEffect(() => {
    const c = canvas.current;
    if (!c || !drawn) return;
    void import('../../lib/viz/chart').then(m => m.markLabel(c, mark));
  }, [mark, drawn]);
  if (!spec) return <pre className="ip-diagram-code">{chart}</pre>;
  return <div className="lv-chart"><canvas ref={canvas} role="img" aria-label={spec.title ?? caption} /></div>;
}
