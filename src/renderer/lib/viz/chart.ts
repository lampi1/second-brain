// Draws a checked ```chart spec (lib/chart-spec.ts) with Chart.js on a canvas. Loaded only by a dynamic import from
// components/VisualBlock.tsx, so Chart.js is its own chunk and the first screen never parses it; only the controllers
// the spec types need are registered (tree-shaken). Canvas only: no HTML from the model, no eval (works under the
// app's CSP, script-src 'self'). Colors: the validated categorical palette (dataviz reference, one per theme, in fixed
// order, never cycled: at most MAX_SERIES series, at most 8 pie slices before they repeat), text and grid from the
// app's tokens read at draw time; the block redraws when the theme changes. Motion off under prefers-reduced-motion.
import {
  ArcElement, BarController, BarElement, CategoryScale, Chart, DoughnutController, Filler, Legend, LinearScale,
  LineController, LineElement, PieController, PointElement, Title, Tooltip,
} from 'chart.js';
import type { ChartSpec } from '../chart-spec';

Chart.register(BarController, BarElement, LineController, LineElement, PointElement, PieController, DoughnutController, ArcElement,
  CategoryScale, LinearScale, Filler, Legend, Title, Tooltip);

const LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

const css = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
/** dark when the page's background is dark (the theme may follow Windows or be picked: the tokens already say which) */
function isDark(): boolean {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(css('--bg'));
  if (!m) return true;
  const [r, g, b] = m.slice(1).map(h => parseInt(h, 16)) as [number, number, number];
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

/** Draws the chart; returns its cleanup. */
export function drawChart(canvas: HTMLCanvasElement, spec: ChartSpec): () => void {
  const pal = isDark() ? DARK : LIGHT;
  const surface = css('--surface') || '#191a1f';
  const text2 = css('--text-2') || '#b9bfcb', text3 = css('--text-3') || '#8d94a4', grid = css('--border') || '#20242d';
  const font = css('--font') || 'system-ui, sans-serif';
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const round = spec.type === 'pie' || spec.type === 'doughnut';
  const unit = spec.unit ? ` ${spec.unit}` : '';
  const fmt = (v: number) => `${v.toLocaleString(document.documentElement.lang || undefined)}${unit}`;
  const many = spec.series.length > 1;
  const datasets = spec.series.map((s, i) => {
    const c = pal[i % pal.length]!;
    if (round) return { label: s.name, data: s.data, backgroundColor: s.data.map((_, j) => pal[j % pal.length]!), borderColor: surface, borderWidth: 2, hoverOffset: 6 };
    if (spec.type === 'line') return { label: s.name, data: s.data, borderColor: c, backgroundColor: `${c}22`, fill: !many, borderWidth: 2, tension: 0.3, pointRadius: spec.labels.length > 30 ? 0 : 3, pointHoverRadius: 5, pointBackgroundColor: c, pointBorderColor: surface, pointBorderWidth: 2 };
    return { label: s.name, data: s.data, backgroundColor: c, borderColor: surface, borderWidth: spec.stacked ? { top: 2 } : 0, borderRadius: 4, borderSkipped: 'start' as const, maxBarThickness: 36, categoryPercentage: 0.7, barPercentage: 0.9 };
  });
  const axis = { ticks: { color: text3, font: { family: font, size: 11 } }, grid: { color: grid, drawTicks: false }, border: { display: false } };
  const chart = new Chart(canvas, {
    type: spec.type,
    data: { labels: spec.labels, datasets: datasets as never },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: reduce ? false : { duration: 700, easing: 'easeOutQuart' },
      indexAxis: spec.horizontal ? 'y' : 'x',
      interaction: round ? { mode: 'nearest', intersect: true } : { mode: 'index', intersect: false },
      layout: { padding: 4 },
      ...(round ? { cutout: spec.type === 'doughnut' ? '58%' : 0 } : {}),
      plugins: {
        title: { display: !!spec.title, text: spec.title ?? '', color: text2, align: 'start', font: { family: font, size: 13, weight: 600 }, padding: { bottom: 10 } },
        legend: { display: many || round, position: round ? 'right' : 'bottom', align: 'start', labels: { color: text2, boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 3, font: { family: font, size: 11 } } },
        tooltip: {
          backgroundColor: css('--tooltip-bg') || '#232731', titleColor: css('--text') || '#eceef3', bodyColor: text2, borderColor: css('--border-3') || '#3a404d', borderWidth: 1,
          padding: 8, cornerRadius: 6, boxPadding: 4, titleFont: { family: font }, bodyFont: { family: font },
          callbacks: { label: c => `${round ? c.label : c.dataset.label ?? ''}: ${fmt(Number(c.raw))}` },
        },
      },
      scales: round ? {} : {
        x: { ...axis, stacked: !!spec.stacked, ...(spec.horizontal ? { ticks: { ...axis.ticks, callback: (v: string | number) => fmt(Number(v)) } } : { grid: { display: false } }) },
        y: { ...axis, stacked: !!spec.stacked, beginAtZero: spec.type === 'bar', ...(spec.horizontal ? { grid: { display: false } } : { ticks: { ...axis.ticks, callback: (v: string | number) => fmt(Number(v)) } }) },
      },
    },
  });
  return () => chart.destroy();
}
