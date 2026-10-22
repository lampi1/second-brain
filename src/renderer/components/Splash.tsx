// The opening splash (owner, 2026-10-22: «un'animazione epica all'apertura, qualcosa di caratteristico che richiami il
// grinding … con una frase diversa ogni giorno»): an angle grinder cuts the word GRINDHOUSE out of the dark, left to
// right, spraying sparks; the word glows hot and cools, then the day's sentence rises under it and the whole thing
// fades into the app. At most SPLASH_MS (2.4 s); a click or any key skips it; prefers-reduced-motion shows the word
// and the sentence still, briefly. Drawn here, no image: SVG (disc, gears), CSS (the word) and one canvas (sparks).
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
const CUT_FROM = 0.12, CUT_TO = 1.12; // seconds: the disc crosses the word
const OUT_AT = 1.95; // seconds: the fade into the app starts
const LINE_WAIT_MS = 700; // the headline has this long to arrive; then the splash's own line

/** A gear's outline (teeth trapezoids around a circle), for the slow machinery in the background. */
function gearPath(teeth: number, r: number, depth: number): string {
  const pts: string[] = [];
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    for (const [da, rr] of [[0.05, r - depth], [0.22, r], [0.5, r], [0.67, r - depth]] as const) {
      const ang = a + da * step;
      pts.push(`${(Math.cos(ang) * rr).toFixed(1)},${(Math.sin(ang) * rr).toFixed(1)}`);
    }
  }
  return `M${pts.join('L')}Z`;
}
const GEAR_A = gearPath(18, 210, 26), GEAR_B = gearPath(11, 120, 20);

type Spark = { x: number; y: number; vx: number; vy: number; life: number; max: number; w: number; hue: number };

export function Splash({ mode, onDone }: { mode: SplashMode; onDone: () => void }) {
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [line, setLine] = useState<string | null>(null);
  const [phase, setPhase] = useState<'run' | 'hot' | 'out'>(reduce ? 'hot' : 'run');
  const word = useRef<HTMLDivElement>(null);
  const disc = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
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
    setTimeout(onDone, reduce ? 120 : 380);
  };

  // skip: a click anywhere or any key
  useEffect(() => {
    const skip = () => finish();
    window.addEventListener('keydown', skip, true);
    return () => window.removeEventListener('keydown', skip, true);
  });

  // the timeline: one animation frame loop drives the disc, the reveal and the sparks
  useEffect(() => {
    if (reduce) {
      if (mode === 'hold') return;
      const id = setTimeout(finish, 1500);
      return () => clearTimeout(id);
    }
    const cv = canvas.current, w = word.current, d = disc.current, st = stage.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx || !w || !d || !st) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = () => { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    size();
    window.addEventListener('resize', size);
    const sparks: Spark[] = [];
    let raf = 0, t0 = 0, last = 0, burst = false, hot = false;
    const spawn = (x: number, y: number, n: number, dir: number, spread: number, speed: [number, number]) => {
      for (let i = 0; i < n; i++) {
        const a = dir + (Math.random() - 0.5) * spread;
        const v = speed[0] + Math.random() * (speed[1] - speed[0]);
        const max = 24 + Math.random() * 40;
        sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: max, max, w: 1 + Math.random() * 1.6, hue: 28 + Math.random() * 26 });
      }
    };
    const frame = (ts: number) => {
      if (!t0) { t0 = ts; last = ts; }
      const s = (ts - t0) / 1000;
      const k = Math.min(3, (ts - last) / 16.67); // frames elapsed at 60 fps: the same motion at any refresh rate
      last = ts;
      const r = w.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (s - CUT_FROM) / (CUT_TO - CUT_FROM)));
      const ease = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
      const edge = r.left + (r.width + 24) * ease - 12;
      const cy = r.top + r.height * 0.62;
      // the word is cut out up to the disc; the disc rides the cut, then lifts off
      w.style.clipPath = p >= 1 ? 'none' : `inset(-40% ${Math.max(0, r.right - edge)}px -40% -12%)`;
      const lift = Math.max(0, s - CUT_TO);
      d.style.transform = `translate(${edge + 66}px, ${cy - lift * 260}px) translate(-50%, -50%) scale(${1 - Math.min(0.6, lift * 1.5)})`;
      d.style.opacity = String(s < CUT_FROM - 0.06 ? 0 : Math.max(0, 1 - lift * 3.2));
      // grinding shakes the stage a hair
      st.style.transform = p > 0 && p < 1 ? `translate(${(Math.random() - 0.5) * 1.6}px, ${(Math.random() - 0.5) * 1.6}px)` : '';
      if (p > 0 && p < 1) {
        // sparks fly back and down off the bottom of the disc, a fan, plus a few up the cut
        spawn(edge + 2, cy + 22, Math.round(14 * k), Math.PI * 0.84, 0.8, [8, 21]);
        spawn(edge + 2, cy - 18, Math.round(3 * k), -Math.PI * 0.66, 0.9, [4, 10]);
      }
      if (p >= 1 && !burst) {
        burst = true;
        spawn(r.right - 4, cy, 140, Math.PI, Math.PI * 2, [3, 14]);
      }
      if (p >= 1 && !hot) { hot = true; setPhase(ph => (ph === 'run' ? 'hot' : ph)); }
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      if (p > 0 && p < 1) {
        // the white-hot kerf along the cut
        const g = ctx.createLinearGradient(0, r.top, 0, r.bottom);
        g.addColorStop(0, 'rgba(255,170,60,0)'); g.addColorStop(0.5, 'rgba(255,236,190,0.95)'); g.addColorStop(1, 'rgba(255,120,30,0)');
        ctx.strokeStyle = g;
        for (const [lw, a] of [[16, 0.18], [3, 1]] as const) { ctx.globalAlpha = a; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(edge, r.top + 6); ctx.lineTo(edge, r.bottom - 6); ctx.stroke(); }
        ctx.globalAlpha = 1;
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const q = sparks[i]!;
        q.vx *= 0.985 ** k; q.vy = q.vy * 0.985 ** k + 0.38 * k; q.x += q.vx * k; q.y += q.vy * k; q.life -= k;
        if (q.life <= 0 || q.y > innerHeight + 20) { sparks.splice(i, 1); continue; }
        const f = q.life / q.max;
        ctx.strokeStyle = `hsla(${q.hue}, 100%, ${55 + f * 40}%, ${Math.min(1, f * 1.4)})`;
        ctx.lineWidth = q.w * (0.5 + f * 0.7);
        ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - q.vx * 2.2, q.y - q.vy * 2.2); ctx.stroke();
      }
      if (mode !== 'hold' && s >= OUT_AT) { finish(); }
      if (s < SPLASH_MS / 1000 + 0.5 || sparks.length) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    // a hard stop, whatever the frame loop does (a busy or hidden window gets few frames)
    const stop = mode === 'hold' ? 0 : window.setTimeout(finish, SPLASH_MS);
    return () => { cancelAnimationFrame(raf); clearTimeout(stop); window.removeEventListener('resize', size); };
  }, []); // the timeline runs once

  const date = new Date(now()).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <div className={`splash splash-${phase}${reduce ? ' splash-still' : ''}`} data-testid="splash" data-phase={phase} data-line={line ? 'ready' : 'wait'} aria-hidden="true" onPointerDown={finish}>
      <svg className="splash-gears" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
        <g transform="translate(1390 170)"><path className="splash-gear g1" d={GEAR_A} /><circle r="58" className="splash-hub" /></g>
        <g transform="translate(1135 300)"><path className="splash-gear g2" d={GEAR_B} /><circle r="34" className="splash-hub" /></g>
        <g transform="translate(170 880)"><path className="splash-gear g2" d={GEAR_A} /><circle r="58" className="splash-hub" /></g>
      </svg>
      <div className="splash-stage" ref={stage}>
        <div className="splash-word" ref={word} data-text="GRINDHOUSE">GRINDHOUSE</div>
        <div className="splash-rule" />
        <div className="splash-sub">
          <span className="splash-label">{t('splash.label')} · {date}</span>
          <p className="splash-line">{line ?? ' '}</p>
        </div>
      </div>
      <canvas className="splash-sparks" ref={canvas} />
      {!reduce && (
        <div className="splash-disc" ref={disc}>
          <svg viewBox="-60 -60 120 120" width="150" height="150">
            <defs>
              <radialGradient id="splash-disc-g" cx="0" cy="0" r="58" gradientUnits="userSpaceOnUse">
                <stop offset="0.28" stopColor="#5b6070" /><stop offset="0.3" stopColor="#2b2f38" /><stop offset="0.92" stopColor="#3b3f4a" /><stop offset="1" stopColor="#ffb347" />
              </radialGradient>
            </defs>
            <g className="splash-spin">
              <circle r="56" fill="url(#splash-disc-g)" />
              {Array.from({ length: 24 }, (_, i) => <line key={i} x1="0" y1="-22" x2="0" y2="-54" transform={`rotate(${i * 15})`} className="splash-grit" />)}
              <circle r="18" className="splash-nut" /><circle r="6" fill="#0b0d12" />
            </g>
            <circle r="57" className="splash-rim" />
          </svg>
        </div>
      )}
      <div className="splash-skip">{t('splash.skip')}</div>
    </div>
  );
}
