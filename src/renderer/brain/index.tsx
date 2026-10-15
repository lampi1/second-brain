// Brain area of the app: the pages of the brain (DevOps, Fatto e standup, Idee, Costi, Qualità, Procedure,
// Confronto modelli, Miglioramento (ADR 0030), Esplora; DevOps took the place of Oggi and Adesso on 2026-10-12, their old links open it) and the full-screen 3D map, in the app's own style, fed by the
// brain's data API (invoke 'brain:api'). This file is the ONE mount point the workspace UI imports:
//   <BrainPage id="costi" arg="30" onNavigate={t => …} />  renders a page (it fills and scrolls its container);
//   <BrainMap onClose={…} onNavigate={…} />                 is the full-screen map overlay (Esc closes).
// onNavigate receives "<page>[/<arg>]" ("esplora/now.md", "costi/30", "fatto/2026-10-09", "idee/ia",
// "qualita") or "mappa" / "mappa/tutto" for the map. Without onNavigate a page follows its own links and opens the
// map itself, so it also works alone (test route: brain/testRoute.tsx). `bridge` (DiscussBridge) gives the pages the
// app's Regia and chats for "Discutine" / "Apri una chat" (Idee). Old "spunti[/x]" targets (the AI's ideas, now inside Idee) open "idee/ia". Built in feat/brain-ui.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import './brain.css';
import { Toaster } from './components/ui';
import { Fatto } from './pages/Fatto';
import { Idee } from './pages/Idee';
import { Costi } from './pages/Costi';
import { Qualita } from './pages/Qualita';
import { Procedure } from './pages/Procedure';
import { Confronto } from './pages/Confronto';
import { Esplora } from './pages/Esplora';
import { Devops } from './pages/Devops';
import { Miglioramento } from './pages/Miglioramento';
import { BrainMapView } from './map/BrainMap';
import type { LiveSource } from './lib/live';
import { preloadEngine } from './map/engine';
import { brainClient } from './api';
import { DiscussContext, type DiscussBridge } from './components/Discuss';
export type { DiscussBridge };
export type { LiveSnapshot, LiveSource, LiveTool } from './lib/live';
export { FADE_MS } from './lib/live';

export type BrainPageId = 'devops' | 'fatto' | 'idee' | 'costi' | 'qualita' | 'procedure' | 'confronto' | 'miglioramento' | 'esplora' | 'skill' | 'impostazioni' | 'migliora';
export const BRAIN_PAGES: { id: BrainPageId; label: string; key: string }[] = [
  { id: 'devops', label: 'DevOps', key: 'G O' },
  { id: 'fatto', label: 'Fatto e standup', key: 'G F' },
  { id: 'idee', label: 'Idee', key: 'G I' },
  { id: 'costi', label: 'Costi', key: 'G C' },
  { id: 'qualita', label: 'Qualità', key: 'G Q' },
  { id: 'procedure', label: 'Procedure', key: 'G L' },
  { id: 'confronto', label: 'Confronto modelli', key: 'G M' },
  { id: 'miglioramento', label: 'Regole imparate', key: 'G R' },
  { id: 'esplora', label: 'Esplora', key: 'G E' },
  // not a brain page: the skills and agents of the CLIs (components/SkillsPage.tsx, rendered by App.tsx; ADR 0018)
  { id: 'skill', label: 'Skill e agenti', key: 'G S' },
  // not a brain page: the app's Settings (components/SettingsPage.tsx, rendered by App.tsx); listed here for places, links and G P
  { id: 'impostazioni', label: 'Impostazioni', key: 'G P' },
  // not a brain page either: "Migliora l'app" (components/ImprovePage.tsx, ADR 0020), the app improving itself
  { id: 'migliora', label: "Migliora l'app", key: 'G U' },
];
const IDS = new Set<string>(BRAIN_PAGES.map(p => p.id));
export const isBrainPage = (s: string): s is BrainPageId => IDS.has(s);
/** Old page ids still found in links (feed, notes, the Regia's habits) → today's. Oggi (home) and Adesso became DevOps
 *  (the user, 2026-10-12: "li trovo ridondanti e poco utili, mentre sezione devops super utile"). */
export const PAGE_ALIAS: Record<string, BrainPageId> = { home: 'devops', oggi: 'devops', adesso: 'devops', dafare: 'devops' };
/** Their old go-to keys still work (G H, G A → DevOps). */
export const GO_ALIASES: { id: BrainPageId; key: string }[] = [{ id: 'devops', key: 'G H' }, { id: 'devops', key: 'G A' }];

/** "esplora/ops/x.md" → { id: 'esplora', arg: 'ops/x.md' }; "mappa/tutto" → { map: true, full: true }. */
export function parseTarget(t: string): { map: true; full: boolean; focus?: string } | { map: false; id: BrainPageId; arg?: string } | null {
  const [first = '', ...rest] = String(t ?? '').replace(/^#/, '').split('/');
  const raw = PAGE_ALIAS[first] ?? first;
  const head = raw === 'spunti' ? 'idee' : raw;
  const arg = raw === 'spunti' ? 'ia' : rest.join('/') || undefined;
  if (head === 'mappa') return { map: true, full: arg === 'tutto', focus: arg && arg !== 'tutto' ? arg : undefined };
  return isBrainPage(head) ? { map: false, id: head, arg } : null;
}

export function BrainPage({ id, arg, onNavigate, bridge }: { id: BrainPageId; arg?: string; onNavigate?: (target: string) => void; bridge?: DiscussBridge }) {
  const [local, setLocal] = useState<{ id: BrainPageId; arg?: string } | null>(null);
  const [map, setMap] = useState<{ full: boolean; focus?: string } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { setLocal(null); }, [id, arg]);
  const cur = local ?? { id, arg };
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }); }, [cur.id, cur.arg]);
  const nav = (target: string) => {
    const p = parseTarget(target);
    // "workspace/chat-<id>" (open an app chat) only makes sense inside the app
    if (!p) { if (onNavigate && /^workspace\//.test(target)) onNavigate(target); return; }
    if (onNavigate) { onNavigate(target); return; }
    if (p.map) setMap({ full: p.full, focus: p.focus });
    else setLocal({ id: p.id, arg: p.arg });
  };
  const label = BRAIN_PAGES.find(p => p.id === cur.id)?.label ?? cur.id;
  let page: ReactNode;
  switch (cur.id) {
    case 'fatto': page = <Fatto arg={cur.arg} nav={nav} />; break;
    case 'idee': page = <Idee arg={cur.arg} nav={nav} />; break;
    case 'costi': page = <Costi arg={cur.arg} nav={nav} />; break;
    case 'qualita': page = <Qualita arg={cur.arg} nav={nav} />; break;
    case 'procedure': page = <Procedure arg={cur.arg} nav={nav} />; break;
    case 'confronto': page = <Confronto nav={nav} />; break;
    case 'miglioramento': page = <Miglioramento nav={nav} />; break;
    case 'esplora': page = <Esplora arg={cur.arg} nav={nav} />; break;
    case 'impostazioni': case 'skill': page = null; break; // rendered by the app (App.tsx PageFrame)
    case 'devops': page = <Devops nav={nav} />; break;
  }
  return (
    <div ref={scroller} className="bx bx-page bx-scroll" data-testid={`brain-page-${cur.id}`} role="region" aria-label={label}>
      <DiscussContext.Provider value={bridge ?? null}>
        <div className="bx-inner" key={`${cur.id}/${cur.id === 'esplora' || cur.id === 'procedure' ? '' : cur.arg ?? ''}`}>{page}</div>
      </DiscussContext.Provider>
      <Toaster />
      {map && <BrainMapView full={map.full} focus={map.focus} onClose={() => setMap(null)} onNavigate={t => { const p = parseTarget(t); if (p && !p.map) setLocal({ id: p.id, arg: p.arg }); }} />}
    </div>
  );
}

/** Get the 3D map ready before it is opened: its libraries and, with `data`, the map itself from the brain, so the open
 *  does not wait for either. Called when the pointer or the focus reaches the map button (Sidebar), never at idle time:
 *  parsing three.js while the user types delayed the focus of an input enough to lose a fast Ctrl+Invio (discuss e2e). */
export function preloadMap(data = false): void {
  preloadEngine();
  if (!data) return;
  const e = brainClient().peek('/api/map');
  if (!e?.loading && (!e?.data || Date.now() - e.fetchedAt > 5 * 60e3)) void brainClient().get('/api/map').catch(() => { /* the map shows the error itself */ });
}

/** The full-screen 3D map (essential view by default; `full` = every file and arrow; `mode="flat"` = the 2D list). */
export function BrainMap({ onClose, onNavigate, full, focus, mode, live, onOpenChat }: { onClose: () => void; onNavigate?: (target: string) => void; full?: boolean; focus?: string; mode?: '3d' | 'flat'; live?: LiveSource; onOpenChat?: (chatId: string) => void }) {
  return (
    <>
      <BrainMapView onClose={onClose} onNavigate={onNavigate} full={full} focus={focus} mode={mode} live={live} onOpenChat={onOpenChat} />
      <div className="bx"><Toaster /></div>
    </>
  );
}
