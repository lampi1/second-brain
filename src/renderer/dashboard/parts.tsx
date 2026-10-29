// The small statistics parts the Dashboard used to hold, kept after it left (ADR 0122: its cards moved to Memoria, Costi,
// Qualità and Idee): a panel with its "Discuti" (a source-preserving draft for the Orchestrator, never sent by itself),
// an empty state, the source line with its refresh, a number tile with its "?" and a count-up that eases a number to
// its new value (the last frame is always the exact value; none under prefers-reduced-motion). Used by
// AppErrors.tsx (Qualità: the app's own errors), Themes.tsx (the themes on Memoria → Idee and Qualità), BrainNotesMap.tsx
// and components/brain-model/MemoryPage.tsx (the live counters). Styles: dashboard.css.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { brainBridge } from '../actions';
import type { Loaded } from '../brain/api';
import { HelpTip } from '../components/HelpTip';
import { locale, t } from '../i18n';
import './dashboard.css';

type Weight = 'primary' | 'ghost' | 'quiet';
const weightClass: Record<Weight, string> = { primary: 'btn-primary', ghost: 'btn-ghost', quiet: 'btn-subtle' };
export function Discuss({ title, facts, source, weight = 'quiet' }: { title: string; facts: string; source: string; weight?: Weight }) {
  const [missing, setMissing] = useState(false);
  return <><button type="button" className={`btn ${weightClass[weight]} btn-s dash-discuss dash-discuss-${weight}`} aria-label={`${t('brainText.dash.discuss')}: ${title}`} onClick={() => {
    setMissing(!brainBridge.draftToOrchestrator(`${title}\n${t('brainText.dash.source')}: ${source}\n${facts}\n\n${t('brainText.dash.question')}`, () => {}));
  }}><span aria-hidden="true">↗</span> {t('brainText.dash.discuss')}</button>{missing && <span role="status" className="dash-note">{t('brainText.dash.openOrchestrator')}</span>}</>;
}

export function Panel({ title, note, children, facts, source = 'second-brain' }: { title: string; note?: string; children: ReactNode; facts?: string; source?: string }) {
  return <section className="dash-panel"><header><div><h3>{title}</h3>{note && <p>{note}</p>}</div>{facts !== undefined && <Discuss title={title} facts={facts} source={source} weight="ghost" />}</header>{children}</section>;
}
export function Empty({ children }: { children: ReactNode }) { return <div className="dash-empty">{children}</div>; }
export function Source({ data, name }: { data: Loaded<unknown>; name?: string }) {
  return <div className="dash-source" role="status">{name && `${name} · `}{data.error ? `${t('brainText.dash.stale')}: ${data.error}` : data.loading || data.refreshing ? t('brainText.dash.refreshing') : data.at ? `${t('brainText.dash.updated')} ${new Date(data.at).toLocaleTimeString(locale())}` : t('brainText.dash.waiting')}
    <button type="button" className="btn btn-subtle btn-s dash-refresh" onClick={() => data.reload(true)} disabled={data.loading || data.refreshing}><span aria-hidden="true">↻</span>{t('brainText.dash.refresh')}</button></div>;
}

const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Eases a shown number toward its new value; the final frame is always the exact value. */
export function useCountUp(target: number | undefined): number | undefined {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (target === undefined || still()) { from.current = target; setShown(target); return; }
    const start = from.current ?? 0, began = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - began) / 700), eased = 1 - Math.pow(1 - k, 3);
      const value = k === 1 ? target : start + (target - start) * eased;
      from.current = value; setShown(value);
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return shown;
}

export function Stat({ label, value, note, n, format, help }: { label: string; value: string; note: string; n?: number; format?: (n: number) => string; help?: string }) {
  const shown = useCountUp(n);
  return <div className="dash-stat"><span className="dash-stat-label">{label}{help && <HelpTip title={label} label={label}>{help}</HelpTip>}</span><strong>{shown !== undefined && format ? format(shown) : value}</strong><small>{note}</small><Discuss title={label} facts={`${value} · ${note}`} source="second-brain" /></div>;
}

/** The parts as one object, for the views that take them as props (Themes.tsx: no import cycle). */
export const PARTS = { Panel, Empty, Source, Stat, Discuss };
