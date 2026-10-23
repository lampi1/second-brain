// The opening splash (owner, 2026-10-22: «un'animazione epica all'apertura … con una frase diversa ogni giorno»;
// 2026-10-23: «con la scritta second-brain non grindhouse e la voglio più fica»): the app's mark wakes up in the dark
// (the hub lights, its links draw out, the nodes pop, signals run along the links), then a stream of sparks of
// thought leaves the hub and flies into place, assembling the word second-brain left to right; when the last one lands
// the real word lights up over them with a shockwave and a glint, the day's sentence rises under it and the whole
// thing fades into the app. At most SPLASH_MS (2.4 s); a click or any key skips it; prefers-reduced-motion shows the
// mark, the word and the sentence still, briefly. Drawn here, no image: SVG (the mark), CSS (the word) and one canvas
// (the particles: the word's own pixels, sampled from an offscreen canvas, are their landing spots).
// The app renders under it from the first frame (the splash only covers it; browser views are held back meanwhile,
// lib/viewports suspendViews, since native views would draw over it). Shown only when main asks it (lib/splash.ts:
// a person opening the app, once per window; never in hidden runs, tests or the frozen demo). The sentence is the
// day's headline main already has (headline:get, never a model call made for this), else a splash line of the day.
// Mounted by main.tsx next to App; pinned by test/unit/splash.test.ts and test/e2e/splash.spec.ts.
import { useEffect, useRef, useState } from 'react';
import { dayLine, headlineLine, type SplashMode } from '../lib/splash';
import { suspendViews } from '../lib/viewports';
import { now } from '../lib/clock';
import { locale, t, type Key } from '../i18n';
import '../styles/splash.css';

export const SPLASH_MS = 2400;
export const SPLASH_WORD = 'second-brain';
const FLY_FROM = 0.22, FLY_SPAN = 0.5; // seconds: the first spark leaves the hub; the last leaves this much later
const FLY_MIN = 0.36, FLY_MAX = 0.5; // seconds: one spark's flight
const LIT_AT = 1.12; // seconds: the real word lights up over the landed sparks
const OUT_AT = 1.95; // seconds: the fade into the app starts
const LINE_WAIT_MS = 700; // the headline has this long to arrive; then the splash's own line
const MAX_SPARKS = 2400;

// the mark (build/icon.svg's network): four nodes linked to one hub, in a 256 box centred on the hub
const NODES = [[-56, -46, 17], [58, -50, 15], [-50, 52, 15], [54, 54, 17]] as const;

type Spark = { sx: number; sy: number; cx: number; cy: number; tx: number; ty: number; at: number; dur: number; hue: number; size: number; drift: number; px: number; py: number };

const easeOut = (p: number) => 1 - (1 - p) ** 3;

/** The word's pixels at its place on screen, a few px apart: where the sparks land. */
function wordTargets(el: HTMLElement): { x: number; y: number }[] {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const fontPx = parseFloat(cs.fontSize) || 120;
  let gap = Math.max(3, Math.round(fontPx / 30));
  const off = document.createElement('canvas');
  off.width = Math.ceil(r.width); off.height = Math.ceil(r.height);
  const c = off.getContext('2d', { willReadFrequently: true });
  if (!c || !off.width || !off.height) return [];
  c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  try { (c as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing; } catch { /* older canvas */ }
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = '#fff';
  c.fillText(el.textContent ?? '', off.width / 2, off.height / 2 + fontPx * 0.04);
  const data = c.getImageData(0, 0, off.width, off.height).data;
  let pts: { x: number; y: number }[] = [];
  for (;;) {
    pts = [];
    for (let y = 0; y < off.height; y += gap) for (let x = 0; x < off.width; x += gap) {
      if (data[(y * off.width + x) * 4 + 3]! > 140) pts.push({ x: r.left + x, y: r.top + y });
    }
    if (pts.length <= MAX_SPARKS) return pts;
    gap++;
  }
}

export function Splash({ mode, onDone }: { mode: SplashMode; onDone: () => void }) {
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [line, setLine] = useState<string | null>(null);
  const [phase, setPhase] = useState<'run' | 'hot' | 'out'>(reduce ? 'hot' : 'run');
  const word = useRef<HTMLDivElement>(null);
  const mark = useRef<SVGSVGElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const done = useRef(false);

  // the sentence: the day's headline if main has a recent one, else the splash's own line of the day
  useEffect(() => {
    let alive = true;
    const own = () => t(`splash.line.${dayLine(now())}` as Key) as string;
    const timer = setTimeout(() => { if (alive) setLine(l => l ?? own()); }, LINE_WAIT_MS);
    try {
      window.sb.invoke('headline:get', undefined).then(h => { if (alive) setLine(l => l ?? headlineLine(h, now()) ?? own()); }, () => {});
    } catch { /* no bridge */ }
    return () => { alive = false; clearTimeout(timer); };
  }, []);

  // browser views are native and would draw over the splash: held back while it shows
  useEffect(() => suspendViews(), []);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    setPhase('out');
    setTimeout(onDone, reduce ? 120 : 420);
  };

  // skip: a click anywhere or any key
  useEffect(() => {
    const skip = () => finish();
    window.addEventListener('keydown', skip, true);
    return () => window.removeEventListener('keydown', skip, true);
  });

  // the timeline: one animation frame loop flies the sparks; the mark and the word animate in CSS
  useEffect(() => {
    if (reduce) {
      if (mode === 'hold') return;
      const id = setTimeout(finish, 1500);
      return () => clearTimeout(id);
    }
    const cv = canvas.current, w = word.current, m = mark.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx || !w || !m) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = () => { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    size();
    window.addEventListener('resize', size);
    let sparks: Spark[] = [];
    let raf = 0, t0 = 0, lit = false, hubX = 0, hubY = 0, left = 0, width = 1;
    const build = () => {
      const mr = m.getBoundingClientRect();
      hubX = mr.left + mr.width / 2; hubY = mr.top + mr.height / 2;
      const wr = w.getBoundingClientRect();
      left = wr.left; width = Math.max(1, wr.width);
      sparks = wordTargets(w).map(p => {
        const u = (p.x - left) / width; // 0 at the word's left edge: the word assembles left to right
        const sx = hubX + (Math.random() - 0.5) * 14, sy = hubY + (Math.random() - 0.5) * 14;
        // a curved flight: the control point swings out sideways and up, more for the far letters
        const mx = (sx + p.x) / 2, my = (sy + p.y) / 2;
        const swing = (Math.random() - 0.5) * 220 + (u - 0.5) * 160;
        return {
          sx, sy, cx: mx + swing, cy: my - 60 - Math.random() * 160, tx: p.x, ty: p.y,
          at: FLY_FROM + u * FLY_SPAN + Math.random() * 0.1, dur: FLY_MIN + Math.random() * (FLY_MAX - FLY_MIN),
          hue: 262 - u * 74 + (Math.random() - 0.5) * 16, size: 1.3 + Math.random() * 1.1, drift: 0.4 + Math.random(), px: sx, py: sy,
        };
      });
    };
    const frame = (ts: number) => {
      if (!t0) { t0 = ts; build(); }
      const s = (ts - t0) / 1000;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      ctx.globalCompositeOperation = 'lighter';
      // after the word lights up the sparks fade out under it and a few drift off as dust
      const fade = s < LIT_AT ? 1 : Math.max(0, 1 - (s - LIT_AT) / 0.45);
      for (const q of sparks) {
        if (s < q.at) continue;
        const p = Math.min(1, (s - q.at) / q.dur);
        const e = easeOut(p), ie = 1 - e;
        let x = ie * ie * q.sx + 2 * ie * e * q.cx + e * e * q.tx;
        let y = ie * ie * q.sy + 2 * ie * e * q.cy + e * e * q.ty;
        if (s > LIT_AT) { const d = (s - LIT_AT) * 26; x += (q.tx - hubX) * 0.0025 * d; y -= d * q.drift; }
        const land = p >= 1 ? Math.max(0, 1 - (s - q.at - q.dur) / 0.18) : 0; // a flash on landing
        const light = 62 + land * 30 + (1 - p) * 10;
        ctx.globalAlpha = fade;
        if (p < 1) {
          // the trail: from where it was last frame
          ctx.strokeStyle = `hsl(${q.hue}, 100%, ${light}%)`;
          ctx.lineWidth = q.size;
          ctx.beginPath(); ctx.moveTo(q.px, q.py); ctx.lineTo(x, y); ctx.stroke();
        }
        ctx.fillStyle = `hsl(${q.hue}, 100%, ${light}%)`;
        const sz = q.size * (1 + land * 1.4);
        ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
        q.px = x; q.py = y;
      }
      ctx.globalAlpha = 1;
      if (s >= LIT_AT && !lit) { lit = true; setPhase(ph => (ph === 'run' ? 'hot' : ph)); }
      if (mode !== 'hold' && s >= OUT_AT) { finish(); }
      if (s < LIT_AT + 0.6) raf = requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, innerWidth, innerHeight);
    };
    raf = requestAnimationFrame(frame);
    // a hard stop, whatever the frame loop does (a busy or hidden window gets few frames)
    const stop = mode === 'hold' ? 0 : window.setTimeout(finish, SPLASH_MS);
    // and the word lights up on time even when frames are scarce
    const light = window.setTimeout(() => setPhase(ph => (ph === 'run' ? 'hot' : ph)), LIT_AT * 1000 + 250);
    return () => { cancelAnimationFrame(raf); clearTimeout(stop); clearTimeout(light); window.removeEventListener('resize', size); };
  }, []); // the timeline runs once

  const date = new Date(now()).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <div className={`splash splash-${phase}${reduce ? ' splash-still' : ''}`} data-testid="splash" data-phase={phase} data-line={line ? 'ready' : 'wait'} aria-hidden="true" onPointerDown={finish}>
      <div className="splash-aurora" />
      <div className="splash-grid" />
      <div className="splash-stage">
        <svg className="splash-mark" ref={mark} viewBox="-86 -86 172 172" width="120" height="120">
          <defs>
            <radialGradient id="splash-hub-g"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#c9bcff" /></radialGradient>
          </defs>
          <circle className="splash-halo" r="96" />
          <g className="splash-links">
            {NODES.map(([x, y], i) => <line key={i} className="splash-link" x1="0" y1="0" x2={x} y2={y} style={{ animationDelay: `${0.06 + i * 0.05}s` }} />)}
            <line className="splash-link splash-link-faint" x1={NODES[0][0]} y1={NODES[0][1]} x2={NODES[1][0]} y2={NODES[1][1]} />
          </g>
          {NODES.map(([x, y], i) => <path key={i} className="splash-pulse" d={`M0 0L${x} ${y}`} style={{ animationDelay: `${0.42 + i * 0.13}s` }} />)}
          {NODES.map(([x, y, r], i) => <circle key={i} className="splash-node" cx={x} cy={y} r={r} style={{ animationDelay: `${0.2 + i * 0.05}s` }} />)}
          <circle className="splash-ring" r="30" />
          <circle className="splash-hub" r="30" fill="url(#splash-hub-g)" />
          <circle className="splash-core" r="14" />
        </svg>
        <div className="splash-word" ref={word} data-text={SPLASH_WORD}>{SPLASH_WORD}</div>
        <div className="splash-rule" />
        <div className="splash-sub">
          <span className="splash-label">{t('splash.label')} · {date}</span>
          <p className="splash-line">{line ?? ' '}</p>
        </div>
      </div>
      <canvas className="splash-sparks" ref={canvas} />
      <div className="splash-skip">{t('splash.skip')}</div>
    </div>
  );
}
