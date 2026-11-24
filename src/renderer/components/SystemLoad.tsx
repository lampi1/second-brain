// The PC's load on the top bar (ADR 0347): CPU % and free RAM, always visible, polled every few seconds over 'app:load'
// (main/system-load.ts) and paused while the window is hidden. Amber and red when the PC is short of either, so the user
// sees why chats wait in the load queue (chats/admission.ts). Used by TopBar.tsx; the pure parts tested in node.
import { useEffect, useState } from 'react';
import type { SystemLoad as Load } from '@shared/contract';
import { locale, t } from '../i18n';

export const LOAD_POLL_MS = 3000;
export type LoadTone = 'green' | 'amber' | 'red' | 'none';
export const cpuTone = (cpu: number | null): LoadTone => (cpu == null ? 'none' : cpu >= 90 ? 'red' : cpu >= 70 ? 'amber' : 'green');
export const ramTone = (freePct: number | null): LoadTone => (freePct == null ? 'none' : freePct <= 10 ? 'red' : freePct <= 20 ? 'amber' : 'green');
/** "12,3 GB" (one decimal under 100 GB), "512 MB" under 1 GB. */
export function gb(bytes: number, loc = locale()): string {
  const g = bytes / 1024 ** 3;
  if (g < 1) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${new Intl.NumberFormat(loc, { maximumFractionDigits: g < 100 ? 1 : 0, minimumFractionDigits: g < 100 ? 1 : 0 }).format(g)} GB`;
}

function useLoad(): Load | null {
  const [load, setLoad] = useState<Load | null>(null);
  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      if (document.hidden) { timer = setTimeout(tick, LOAD_POLL_MS); return; }
      void window.sb.invoke('app:load', undefined).then(l => { if (alive) setLoad(l); }, () => {}).finally(() => { if (alive) timer = setTimeout(tick, LOAD_POLL_MS); });
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, []);
  return load;
}

export function SystemLoad() {
  const load = useLoad();
  const cpu = load?.cpu ?? null;
  const free = load ? load.freeRamBytes : null;
  const tip = load ? t('appText.topBar.loadTip', { cpu: cpu == null ? '—' : `${cpu}%`, free: gb(load.freeRamBytes), total: gb(load.totalRamBytes), pct: load.freeRamPct }) : t('appText.topBar.loadWaiting');
  return (
    <span className="sysload" role="status" aria-label={tip} data-tip={tip} data-testid="sysload">
      <span className="sl-item" data-tone={cpuTone(cpu)} data-testid="sysload-cpu"><span className="sl-k">CPU</span><b className="sl-v">{cpu == null ? '—' : `${cpu}%`}</b></span>
      <span className="sl-item" data-tone={ramTone(load?.freeRamPct ?? null)} data-testid="sysload-ram"><span className="sl-k">RAM</span><b className="sl-v">{free == null ? '—' : gb(free)}</b><span className="sl-free">{t('appText.topBar.ramFree')}</span></span>
    </span>
  );
}
