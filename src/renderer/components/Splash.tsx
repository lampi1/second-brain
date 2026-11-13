// The opening splash: a quiet beat, a constellation gathering around the mark, the word and the day's sentence,
// then enough time to read before an 800 ms dissolve. One clock drives every opacity and transform; there are no
// competing CSS animations, canvas readbacks or full-screen blur passes. At most 32 sparks, no per-frame React
// render. Skip, reduced motion and teardown share the same cancellable timeline (lib/splash-timeline.ts).
// Mounted by main.tsx, with native browser views held underneath. Sound follows the existing sound/DND controls,
// stays off while voice is active, and never retries blocked autoplay. Hidden runs are additionally muted by main.
import { useEffect, useRef, useState } from 'react';
import { dayLine, type SplashMode } from '../lib/splash';
import { splashEase, SPLASH_TIMING, startSplashTimeline } from '../lib/splash-timeline';
import { playSplashSound, splashCanSound } from '../lib/splash-sound';
import { suspendViews } from '../lib/viewports';
import { isFrozen, now } from '../lib/clock';
import { app } from '../store/store';
import { voice } from '../lib/voice';
import { recorder } from '../lib/recorder';
import { locale, t, type Key } from '../i18n';
import '../styles/splash.css';

export { SPLASH_MS } from '../lib/splash-timeline';
export const SPLASH_WORD = 'second-brain';
const NODES = [[-56, -46, 17], [58, -50, 15], [-50, 52, 15], [54, 54, 17]] as const;
// Deterministic positions: a reload/resize never generates a new, distracting burst.
const SPARKS = Array.from({ length: 32 }, (_, i) => ({
  angle: i * 2.3999632297, radius: 0.42 + (i * 17 % 23) / 40,
  start: 700 + (i % 8) * 95, duration: 1400 + (i * 13 % 9) * 65,
}));

export function Splash({ mode, onDone }: { mode: SplashMode; onDone: () => void }) {
  const [reduce, setReduce] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const ownLine = () => t(`splash.line.${dayLine(now())}` as Key) as string;
  const [line] = useState(ownLine);
  const root = useRef<HTMLDivElement>(null);
  const skip = useRef<() => void>(() => {});
  const complete = useRef(onDone);
  useEffect(() => { complete.current = onDone; }, [onDone]);

  useEffect(() => suspendViews(), []);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => setReduce(media.matches);
    media.addEventListener('change', changed);
    changed(); // preference may have changed between the initial render and this subscription
    return () => media.removeEventListener('change', changed);
  }, []);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const part = (name: string) => el.querySelector<HTMLElement>(`.splash-${name}`)!;
    const mark = part('emblem'), word = part('word'), sub = part('sub'), rule = part('rule');
    const glow = part('aurora'), orbit = part('orbits'), hint = part('skip');
    const sparks = [...el.querySelectorAll<HTMLElement>('.splash-spark')];
    let width = innerWidth, height = innerHeight;
    const resize = () => { width = innerWidth; height = innerHeight; };
    const opacity = (node: HTMLElement, value: number) => { node.style.opacity = String(value); };
    const canSound = () => splashCanSound({
      mode, reduced: reduce, visible: !document.hidden, frozen: isFrozen(), voiceOff: voice.get().phase === 'off', recorderOff: recorder.get().phase === 'off',
      settings: app.get().settings, now: now(),
    });
    let soundTried = false, stopSound = () => {};
    const stopIfMuted = () => { if (!canSound()) stopSound(); };
    const unApp = app.subscribe(stopIfMuted), unVoice = voice.subscribe(stopIfMuted), unRecorder = recorder.subscribe(stopIfMuted);
    document.addEventListener('visibilitychange', stopIfMuted);
    window.addEventListener('resize', resize);
    const timeline = startSplashTimeline({
      mode, reduced: reduce,
      draw(frame) {
        const { elapsed, mark: m, word: w, line: l } = frame;
        el.dataset.phase = frame.phase;
        opacity(el, frame.opacity);
        opacity(mark, m); mark.style.transform = `translate3d(0, ${(1 - m) * 12}px, 0) scale(${0.92 + m * 0.08})`;
        opacity(word, w); word.style.transform = `translate3d(0, ${(1 - w) * 18}px, 0) scale(${0.975 + w * 0.025})`;
        opacity(sub, l); sub.style.transform = `translate3d(0, ${(1 - l) * 10}px, 0)`;
        opacity(rule, w * 0.8); rule.style.transform = `scaleX(${w})`;
        opacity(glow, 0.35 + m * 0.65);
        opacity(orbit, m * 0.65);
        opacity(hint, reduce ? 1 : splashEase(elapsed, 700, 1500));
        if (!reduce) sparks.forEach((spark, i) => {
          const p = SPARKS[i]!;
          const travel = splashEase(elapsed, p.start, p.start + p.duration);
          const fade = splashEase(elapsed, p.start, p.start + 320) * (1 - splashEase(elapsed, 2100, SPLASH_TIMING.lineEnd));
          const radius = p.radius * travel;
          const x = Math.cos(p.angle) * Math.min(width * 0.38, 510) * radius;
          const y = Math.sin(p.angle) * Math.min(height * 0.28, 230) * radius;
          opacity(spark, fade * (0.35 + (i % 3) * 0.2));
          spark.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${0.6 + travel * 0.4})`;
        });
        if (!soundTried && elapsed >= SPLASH_TIMING.opening) {
          soundTried = true;
          // A late first frame never starts a soundtrack out of time with the reveal.
          if (elapsed < SPLASH_TIMING.opening + 400 && frame.phase !== 'out' && canSound()) stopSound = playSplashSound();
        }
        if (frame.phase === 'out') stopSound();
      },
      done() { stopSound(); complete.current(); },
    });
    skip.current = () => { stopSound(); timeline.skip(); };
    const key = (event: KeyboardEvent) => {
      event.preventDefault(); event.stopImmediatePropagation(); skip.current();
    };
    window.addEventListener('keydown', key, true);
    return () => {
      skip.current = () => {};
      timeline.dispose(); stopSound(); unApp(); unVoice(); unRecorder();
      document.removeEventListener('visibilitychange', stopIfMuted);
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', key, true);
    };
  }, [mode, reduce]);

  const date = new Date(now()).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <div ref={root} className={`splash${reduce ? ' splash-still' : ''}`} data-testid="splash" data-phase={reduce ? 'hot' : 'opening'} data-line="ready" aria-hidden="true" onPointerDown={event => { event.preventDefault(); event.stopPropagation(); skip.current(); }}>
      <div className="splash-aurora" />
      <div className="splash-stars" />
      <div className="splash-orbits"><div /><div /><div /></div>
      <div className="splash-particles">{SPARKS.map((_, i) => <i className="splash-spark" key={i} />)}</div>
      <div className="splash-stage">
        <div className="splash-emblem">
          <span className="splash-emblem-orbit" />
          <svg className="splash-mark" viewBox="-86 -86 172 172" width="104" height="104">
            <defs><linearGradient id="splash-mark-light" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fbfaff" /><stop offset="1" stopColor="#b7a6fa" /></linearGradient></defs>
            <g stroke="url(#splash-mark-light)" strokeWidth="9" strokeLinecap="round">
              {NODES.map(([x, y], i) => <line key={i} x1="0" y1="0" x2={x} y2={y} />)}
              <line x1={NODES[0][0]} y1={NODES[0][1]} x2={NODES[1][0]} y2={NODES[1][1]} opacity="0.35" strokeWidth="5" />
            </g>
            {NODES.map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill="url(#splash-mark-light)" />)}
            <circle r="29" fill="#f7f2ff" /><circle r="12" fill="#8b75dc" />
          </svg>
        </div>
        <div className="splash-word">{SPLASH_WORD}</div>
        <div className="splash-rule" />
        <div className="splash-sub">
          <span className="splash-label">{t('splash.label')}<span className="splash-label-dot"> · </span><span>{date}</span></span>
          <p className="splash-line">{line}</p>
        </div>
      </div>
      <div className="splash-skip">{t('splash.skip')}<span aria-hidden="true"> ↵</span></div>
    </div>
  );
}
