// Brain area of the app: the pages of the brain (Oggi, Adesso, Fatto e standup, Da fare, Idee, Spunti dell'IA, Costi,
// Qualità, Collaborazione, Confronto modelli, Esplora) and the full-screen 3D map, in the app's own style, fed by the
// brain's data API (invoke 'brain:api'). This file is the ONE mount point the workspace UI imports:
//   <BrainPage id="costi" arg="30" onNavigate={t => …} />  renders a page (it fills and scrolls its container);
//   <BrainMap onClose={…} onNavigate={…} />                 is the full-screen map overlay (Esc closes).
// onNavigate receives "<page>[/<arg>]" ("dafare", "esplora/now.md", "costi/30", "fatto/2026-10-09", "spunti/riflessioni",
// "qualita/lodi") or "mappa" / "mappa/tutto" for the map. Without onNavigate a page follows its own links and opens the
// map itself, so it also works alone (test route: brain/testRoute.tsx). Built in feat/brain-ui.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import './brain.css';
import { Toaster } from './components/ui';
import { Home } from './pages/Home';
import { Adesso } from './pages/Adesso';
import { Fatto } from './pages/Fatto';
import { DaFare } from './pages/DaFare';
import { Idee } from './pages/Idee';
import { Spunti } from './pages/Spunti';
import { Costi } from './pages/Costi';
import { Qualita } from './pages/Qualita';
import { Collabora } from './pages/Collabora';
import { Confronto } from './pages/Confronto';
import { Esplora } from './pages/Esplora';
import { BrainMapView } from './map/BrainMap';

export type BrainPageId = 'home' | 'adesso' | 'fatto' | 'dafare' | 'idee' | 'spunti' | 'costi' | 'qualita' | 'collabora' | 'confronto' | 'esplora';
export const BRAIN_PAGES: { id: BrainPageId; label: string; key: string }[] = [
  { id: 'home', label: 'Oggi', key: 'G H' },
  { id: 'adesso', label: 'Adesso', key: 'G A' },
  { id: 'fatto', label: 'Fatto e standup', key: 'G F' },
  { id: 'dafare', label: 'Da fare', key: 'G D' },
  { id: 'idee', label: 'Idee', key: 'G I' },
  { id: 'spunti', label: "Spunti dell'IA", key: 'G S' },
  { id: 'costi', label: 'Costi', key: 'G C' },
  { id: 'qualita', label: 'Qualità', key: 'G Q' },
  { id: 'collabora', label: 'Collaborazione', key: 'G L' },
  { id: 'confronto', label: 'Confronto modelli', key: 'G M' },
  { id: 'esplora', label: 'Esplora', key: 'G E' },
];
const IDS = new Set<string>(BRAIN_PAGES.map(p => p.id));
export const isBrainPage = (s: string): s is BrainPageId => IDS.has(s);

/** "esplora/ops/x.md" → { id: 'esplora', arg: 'ops/x.md' }; "mappa/tutto" → { map: true, full: true }. */
export function parseTarget(t: string): { map: true; full: boolean; focus?: string } | { map: false; id: BrainPageId; arg?: string } | null {
  const [head = '', ...rest] = String(t ?? '').replace(/^#/, '').split('/');
  const arg = rest.join('/') || undefined;
  if (head === 'mappa') return { map: true, full: arg === 'tutto', focus: arg && arg !== 'tutto' ? arg : undefined };
  return isBrainPage(head) ? { map: false, id: head, arg } : null;
}

export function BrainPage({ id, arg, onNavigate }: { id: BrainPageId; arg?: string; onNavigate?: (target: string) => void }) {
  const [local, setLocal] = useState<{ id: BrainPageId; arg?: string } | null>(null);
  const [map, setMap] = useState<{ full: boolean; focus?: string } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { setLocal(null); }, [id, arg]);
  const cur = local ?? { id, arg };
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }); }, [cur.id, cur.arg]);
  const nav = (target: string) => {
    const p = parseTarget(target);
    if (!p) return;
    if (onNavigate) { onNavigate(target); return; }
    if (p.map) setMap({ full: p.full, focus: p.focus });
    else setLocal({ id: p.id, arg: p.arg });
  };
  const label = BRAIN_PAGES.find(p => p.id === cur.id)?.label ?? cur.id;
  let page: ReactNode;
  switch (cur.id) {
    case 'home': page = <Home nav={nav} />; break;
    case 'adesso': page = <Adesso nav={nav} />; break;
    case 'fatto': page = <Fatto arg={cur.arg} nav={nav} />; break;
    case 'dafare': page = <DaFare nav={nav} />; break;
    case 'idee': page = <Idee nav={nav} />; break;
    case 'spunti': page = <Spunti arg={cur.arg} nav={nav} />; break;
    case 'costi': page = <Costi arg={cur.arg} nav={nav} />; break;
    case 'qualita': page = <Qualita arg={cur.arg} nav={nav} />; break;
    case 'collabora': page = <Collabora />; break;
    case 'confronto': page = <Confronto nav={nav} />; break;
    case 'esplora': page = <Esplora arg={cur.arg} nav={nav} />; break;
  }
  return (
    <div ref={scroller} className="bx bx-page bx-scroll" data-testid={`brain-page-${cur.id}`} role="region" aria-label={label}>
      <div className="bx-inner" key={`${cur.id}/${cur.id === 'esplora' ? '' : cur.arg ?? ''}`}>{page}</div>
      <Toaster />
      {map && <BrainMapView full={map.full} focus={map.focus} onClose={() => setMap(null)} onNavigate={t => { const p = parseTarget(t); if (p && !p.map) setLocal({ id: p.id, arg: p.arg }); }} />}
    </div>
  );
}

/** The full-screen 3D map (essential view by default; `full` = every file and arrow; `mode="flat"` = the 2D list). */
export function BrainMap({ onClose, onNavigate, full, focus, mode }: { onClose: () => void; onNavigate?: (target: string) => void; full?: boolean; focus?: string; mode?: '3d' | 'flat' }) {
  return (
    <>
      <BrainMapView onClose={onClose} onNavigate={onNavigate} full={full} focus={focus} mode={mode} />
      <div className="bx"><Toaster /></div>
    </>
  );
}
