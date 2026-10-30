// Impara's visuals (ADR 0205): each piece of a lesson declares the picture that explains it best, and the board draws
// and animates it beat by beat. flow = the lesson's own flowchart (ADR 0188: camera, lit nodes, a light along the
// arrow); sequence, state, timeline and mindmap = a mermaid diagram of that type that grows one part per beat (the app
// cuts the source to the first parts, closing any block it cut open); code = real lines of the material walked through
// with the lines of each beat highlighted; formula = a TeX formula (KaTeX, MathML only) with a legend whose symbol each
// beat names; chart = a chart.js spec (lib/chart-spec.ts) whose label each beat points at. Everything here is written by
// the model and untrusted: this file checks and caps it (no mermaid directive, click or link; sizes capped; a beat may
// only name a known line, symbol or label). Pure; shared by shared/lesson.ts (parseStep), main/learn (quality gate)
// and the renderer (components/impara/LessonVisual.tsx); pinned by test/unit/lesson-visual.test.ts.

export type MermaidKind = 'sequence' | 'state' | 'timeline' | 'mindmap';
export type VisualKind = 'flow' | MermaidKind | 'code' | 'formula' | 'chart';
export const VISUAL_KINDS: readonly VisualKind[] = ['flow', 'sequence', 'state', 'timeline', 'mindmap', 'code', 'formula', 'chart'];
export const MERMAID_KINDS: readonly MermaidKind[] = ['sequence', 'state', 'timeline', 'mindmap'];

export type LessonVisual =
  | { kind: 'flow' }
  | { kind: MermaidKind; src: string }
  | { kind: 'code'; file: string; code: string }
  | { kind: 'formula'; tex: string; where: { sym: string; meaning: string }[] }
  /** chart: the spec as JSON text, read again by the renderer's parseChartSpec */
  | { kind: 'chart'; chart: string; labels: string[] };

/** A diagram the learner reads at a glance: at most this many parts (nodes, messages, branches, events). */
export const VISUAL_PARTS_MAX = 12;
const SRC_MAX = 3000;
const CODE_LINES_MAX = 30;
const TEX_MAX = 400;

const HEAD: Record<MermaidKind, RegExp> = {
  sequence: /^sequenceDiagram\b/, state: /^stateDiagram(?:-v2)?\b/, timeline: /^timeline\b/, mindmap: /^mindmap\b/,
};
/** Lines a diagram of the model may not hold: directives, styling, links and callbacks (mermaid strict also refuses
 *  them; here they never reach it). */
const FORBIDDEN = /%%\{|^\s*(?:click|href|link|links|callback|classDef|class|style|linkStyle|themeVariables)\b|<\s*script|javascript:/im;

const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\r/g, '').trim().slice(0, max) : '');

/** The lines of a mermaid source after its header, comments and blank lines left out. */
export function contentLines(src: string): string[] {
  return src.split('\n').slice(1).filter(l => l.trim() && !/^\s*%%/.test(l));
}

/** A sequence diagram's lines that set it up (who takes part), kept whatever the beat. */
const SETUP = /^\s*(?:participant|actor|autonumber|title|create\s+participant)\b/;
const isMessage = (l: string) => /-[-x)>]/.test(l) && !SETUP.test(l);

/** How many parts a visual shows (the checklist's «at most 12»): flow is counted by the caller (diagramNodes). */
export function visualParts(v: LessonVisual): number {
  if (v.kind === 'flow') return 0;
  if (v.kind === 'code') return 0;
  if (v.kind === 'formula') return v.where.length;
  if (v.kind === 'chart') return v.labels.length;
  const lines = contentLines(v.src);
  if (v.kind === 'sequence') return lines.filter(isMessage).length;
  if (v.kind === 'timeline') return lines.filter(l => !/^\s*title\b/.test(l)).length;
  if (v.kind === 'state') return lines.filter(l => /-->/.test(l)).length;
  return lines.length;
}

/** The steps a mermaid visual grows by: its content lines, without the setup lines a sequence keeps always and a
 *  timeline's title. */
function revealable(kind: MermaidKind, lines: readonly string[]): number[] {
  return lines.map((l, i) => ({ l, i })).filter(({ l }) => !(kind === 'sequence' && SETUP.test(l)) && !(kind === 'timeline' && /^\s*title\b/.test(l))
    && !(kind === 'sequence' && /^\s*(?:end|else|and)\b/.test(l))).map(x => x.i);
}

/** The source cut to the first `upto` parts (all of them when `upto` is past the end), blocks the cut left open closed
 *  again (a sequence's loop/alt/opt… with `end`, a state's composite with `}`), so the cut still draws. */
export function revealMermaid(kind: MermaidKind, src: string, upto: number): string {
  const head = src.split('\n')[0] ?? '';
  const lines = contentLines(src);
  const steps = revealable(kind, lines);
  if (upto >= steps.length) return src;
  const last = upto <= 0 ? -1 : steps[upto - 1]!;
  const always = (l: string) => (kind === 'sequence' && /^\s*(?:participant|actor|autonumber|title|create\s+participant)\b/.test(l)) || (kind === 'timeline' && /^\s*title\b/.test(l));
  const keep = lines.filter((l, i) => i <= last || always(l));
  let closing = '';
  if (kind === 'sequence') {
    let open = 0;
    for (const l of keep) { if (/^\s*(?:loop|alt|opt|par|critical|break|rect)\b/.test(l)) open++; else if (/^\s*end\b/.test(l)) open = Math.max(0, open - 1); }
    closing = '\n  end'.repeat(open);
  } else if (kind === 'state') {
    let open = 0;
    for (const l of keep) open += (l.match(/\{/g)?.length ?? 0) - (l.match(/\}/g)?.length ?? 0);
    closing = '\n  }'.repeat(Math.max(0, open));
  }
  // a mindmap needs its root, a timeline one event: never less than the first step
  if (!keep.length && (kind === 'mindmap' || kind === 'timeline')) return [head, lines[0] ?? ''].join('\n');
  return [head, ...keep].join('\n') + closing;
}

/** The parts shown at beat `i` of `n`: the visual grows evenly over the beats, all of it at the last one. */
export const revealAt = (parts: number, i: number, n: number): number => (n <= 1 ? parts : Math.max(1, Math.ceil((parts * (i + 1)) / n)));
export const revealSteps = (kind: MermaidKind, src: string): number => revealable(kind, contentLines(src)).length;

/** A visual the model declared, checked; null when it does not hold (the piece then shows the lesson's flowchart). */
export function parseVisual(v: unknown): LessonVisual | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const kind = typeof o.type === 'string' ? o.type : typeof o.kind === 'string' ? o.kind : '';
  if (kind === 'flow') return { kind: 'flow' };
  if ((MERMAID_KINDS as readonly string[]).includes(kind)) {
    const k = kind as MermaidKind;
    const src = clean(o.mermaid ?? o.src, SRC_MAX + 1);
    if (!src || src.length > SRC_MAX || !HEAD[k].test(src) || FORBIDDEN.test(src)) return null;
    const out: LessonVisual = { kind: k, src };
    const parts = visualParts(out);
    return parts >= 2 && parts <= VISUAL_PARTS_MAX + 4 ? out : null;
  }
  if (kind === 'code') {
    const code = typeof o.code === 'string' ? o.code.replace(/\r/g, '').replace(/\s+$/, '') : '';
    const lines = code.split('\n');
    if (!code.trim() || lines.length > CODE_LINES_MAX) return null;
    return { kind: 'code', file: clean(o.file, 200), code: lines.map(l => l.slice(0, 160)).join('\n') };
  }
  if (kind === 'formula') {
    const tex = clean(o.tex, TEX_MAX + 1);
    if (!tex || tex.length > TEX_MAX || /\\(?:href|url|includegraphics|htmlClass|htmlId|htmlStyle|htmlData)\b/.test(tex)) return null;
    const where = (Array.isArray(o.where) ? o.where : []).map(w => (w && typeof w === 'object' ? w as Record<string, unknown> : {}))
      .map(w => ({ sym: clean(w.sym, 40), meaning: clean(w.meaning, 160) })).filter(w => w.sym && w.meaning).slice(0, 6);
    return { kind: 'formula', tex, where };
  }
  if (kind === 'chart') {
    const c = o.chart;
    if (!c || typeof c !== 'object') return null;
    const spec = c as Record<string, unknown>;
    const labels = (Array.isArray(spec.labels) ? spec.labels : []).map(l => clean(typeof l === 'number' ? String(l) : l, 60)).filter(Boolean);
    const series = Array.isArray(spec.series) ? spec.series : [];
    if (labels.length < 2 || labels.length > VISUAL_PARTS_MAX || !series.length || series.length > 4) return null;
    if (!series.every(s => s && typeof s === 'object' && Array.isArray((s as Record<string, unknown>).data) && ((s as Record<string, unknown>).data as unknown[]).every(n => typeof n === 'number' && Number.isFinite(n)))) return null;
    const chart = JSON.stringify({ type: spec.type, title: spec.title, labels, series, unit: spec.unit, horizontal: spec.horizontal, stacked: spec.stacked });
    return chart.length <= 4000 ? { kind: 'chart', chart, labels } : null;
  }
  return null;
}

/** What a beat may point at on this visual: the code's line numbers (from 1), the formula's symbols, the chart's labels. */
export function beatMark(v: LessonVisual | undefined, raw: Record<string, unknown>): { lines?: [number, number]; mark?: string } {
  if (!v) return {};
  if (v.kind === 'code') {
    const n = v.code.split('\n').length;
    const l = Array.isArray(raw.lines) ? raw.lines : typeof raw.lines === 'number' ? [raw.lines, raw.lines] : null;
    const a = Number(l?.[0]), b = Number(l?.[1] ?? l?.[0]);
    return Number.isInteger(a) && Number.isInteger(b) && a >= 1 && b >= a && a <= n ? { lines: [a, Math.min(b, n)] } : {};
  }
  const mark = typeof raw.mark === 'string' ? raw.mark.trim() : '';
  if (v.kind === 'formula' && v.where.some(w => w.sym === mark)) return { mark };
  if (v.kind === 'chart' && v.labels.includes(mark)) return { mark };
  return {};
}
