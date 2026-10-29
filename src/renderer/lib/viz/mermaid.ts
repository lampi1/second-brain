// Draws a ```mermaid block of an agent's reply as a diagram. Loaded only by a dynamic import from
// components/VisualBlock.tsx: mermaid (and the diagram types it splits out itself) are their own chunks, never parsed
// by the first screen. The model's text is untrusted, so: securityLevel 'strict' (labels sanitized by mermaid's
// DOMPurify, no click handlers or links run; an %%{init}%% directive cannot change it, it is one of mermaid's secure
// keys), size caps (maxTextSize, maxEdges), and the result is never put into the page's DOM: the SVG is serialized
// as well-formed XML and shown as an <img src="data:image/svg+xml,…"> (an image cannot run script, read the page or
// load anything; img-src already allows data:). No eval: mermaid's parsers are precompiled (CSP script-src 'self').
// The theme is mermaid's 'base' fed with the app's tokens read at draw time; VisualBlock redraws when the theme changes.
import mermaid from 'mermaid';

let seq = 0;
let queue: Promise<unknown> = Promise.resolve();
let themed = '';

const css = (name: string, fallback: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/** A bigger, tighter drawing (Impara's blackboard, ADR 0183): larger labels, less space between the nodes. */
export interface DrawOptions { fontSize?: number; nodeSpacing?: number; rankSpacing?: number }

function configure(o: DrawOptions = {}): void {
  const vars = {
    background: css('--surface', '#191a1f'),
    primaryColor: css('--surface-3', '#272930'),
    primaryTextColor: css('--text', '#eceef3'),
    primaryBorderColor: css('--blue', '#a59bff'),
    secondaryColor: css('--surface-2', '#1e2026'),
    secondaryTextColor: css('--text-2', '#b9bfcb'),
    secondaryBorderColor: css('--border-3', '#3a404d'),
    tertiaryColor: css('--surface-4', '#30333c'),
    tertiaryTextColor: css('--text-2', '#b9bfcb'),
    tertiaryBorderColor: css('--border-3', '#3a404d'),
    lineColor: css('--text-3', '#8d94a4'),
    textColor: css('--text-2', '#b9bfcb'),
    mainBkg: css('--surface-3', '#272930'),
    clusterBkg: css('--surface-2', '#1e2026'),
    clusterBorder: css('--border-3', '#3a404d'),
    noteBkgColor: css('--surface-4', '#30333c'),
    noteTextColor: css('--text', '#eceef3'),
    noteBorderColor: css('--amber', '#f2b64c'),
    actorBkg: css('--surface-3', '#272930'),
    actorBorder: css('--blue', '#a59bff'),
    actorTextColor: css('--text', '#eceef3'),
    signalColor: css('--text-2', '#b9bfcb'),
    signalTextColor: css('--text', '#eceef3'),
    edgeLabelBackground: css('--surface', '#191a1f'),
    fontFamily: css('--font', 'system-ui, sans-serif'),
    fontSize: `${o.fontSize ?? 13}px`,
  };
  const flowchart = { nodeSpacing: o.nodeSpacing ?? 50, rankSpacing: o.rankSpacing ?? 50 };
  const key = JSON.stringify([vars, flowchart]);
  if (key === themed) return;
  themed = key;
  mermaid.initialize({
    startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables: vars, fontFamily: vars.fontFamily,
    // SVG text labels: the diagram is shown as an image, where HTML labels inside foreignObject would add nothing
    htmlLabels: false, flowchart: { ...flowchart, htmlLabels: false }, suppressErrorRendering: true, maxTextSize: 20_000, maxEdges: 400, deterministicIds: true,
    deterministicIDSeed: 'sb',
    // edge labels on an opaque chip (mermaid's own is half transparent: a line showed through the text), rounder boxes
    themeCSS: `.edgeLabel rect, .labelBkg { opacity: 1 !important; fill: ${vars.background} !important; } .node rect { rx: 6px; ry: 6px; }`,
  });
}

/** Normalizes mermaid's SVG markup into a standalone image: well-formed XML with explicit pixel size. */
function toImage(svg: string): { src: string; width: number; height: number } {
  const doc = new DOMParser().parseFromString(svg, 'text/html');
  const el = doc.querySelector('svg');
  if (!el) throw new Error('no svg');
  const vb = (el.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  const width = Math.ceil(vb[2] || parseFloat(el.style.maxWidth) || 600), height = Math.ceil(vb[3] || 400);
  el.setAttribute('width', String(width)); el.setAttribute('height', String(height));
  el.removeAttribute('style');
  el.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const xml = new XMLSerializer().serializeToString(el);
  return { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`, width, height };
}

/** The diagram as an image data URL, or a rejection (bad syntax, too big): the caller then shows the code. One at a
 *  time (mermaid keeps global state while it draws). */
export function drawMermaid(code: string, opts?: DrawOptions): Promise<{ src: string; width: number; height: number }> {
  const run = queue.then(async () => {
    configure(opts);
    const id = `sb-mermaid-${++seq}`;
    try {
      const { svg } = await mermaid.render(id, code);
      return toImage(svg);
    } finally {
      // mermaid's scratch nodes, if a failure left them behind
      document.getElementById(id)?.remove(); document.getElementById(`d${id}`)?.remove();
    }
  });
  queue = run.catch(() => undefined);
  return run;
}
