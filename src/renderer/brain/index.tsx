// Brain area of the app: the pages of the brain (Task, Idee (shown as a Memoria tab, ADR 0122), Esplora (Confronto modelli went, ADR 0201);
// Costi and Qualità are tabs of Andamento since ADR 0202, rendered by components/andamento/AndamentoPage.tsx; Task took the place of Oggi and Adesso on 2026-10-12, their old links open it; the old
// Miglioramento page lives inside Regole since ADR 0082, its links open Regole) and the full-screen 3D map, in the app's own style, fed by the
// brain's data API (invoke 'brain:api'). This file is the ONE mount point the workspace UI imports:
//   <BrainPage id="idee" arg="ia" onNavigate={t => …} />  renders a page (it fills and scrolls its container);
//   <BrainMap onClose={…} onNavigate={…} />                 is the full-screen map overlay (Esc closes).
// onNavigate receives "<page>[/<arg>]" ("esplora/now.md", "andamento/costi/30", "idee/ia",
// "costi" → "andamento/costi") or "mappa" / "mappa/tutto" for the map. Without onNavigate a page follows its own links and opens the
// map itself, so it also works alone (test route: brain/testRoute.tsx). `bridge` (DiscussBridge) gives the pages the
// app's Orchestrator and chats for "Discuti" (to the Orchestrator, never a work chat directly). Old "spunti[/x]" targets (the AI's ideas, now inside Idee) open "idee/ia". Built in feat/brain-ui.
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import './brain.css';
import { Toaster } from './components/ui';
import { Idee } from './pages/Idee';
import { FileViewer } from './pages/FileViewer';
import { Costi } from './pages/Costi';
import { Qualita } from './pages/Qualita';
import {normalizeFileArg} from '@shared/file-view';
import { TaskPage } from './pages/Task';
import { BrainMapView } from './map/BrainMap';
import type { LiveSource } from './lib/live';
import { preloadEngine } from './map/engine';
import { brainClient } from './api';
import { DiscussContext, type DiscussBridge } from './components/Discuss';
import { t } from '../i18n';
import { parseTrendArg, trendRedirect } from '../lib/andamento';
const Routines = lazy(() => import('./pages/Routines').then(module => ({ default: module.Routines })));
const Home = lazy(() => import('./pages/Home').then(module => ({ default: module.Home })));
export type { DiscussBridge };
export type { LiveSnapshot, LiveSource, LiveTool } from './lib/live';
export { FADE_MS } from './lib/live';

export type BrainPageId = 'home' | 'flussi' | 'task' | 'idee' | 'andamento' | 'script' | 'log' | 'file' | 'skill' | 'impostazioni' | 'agenti' | 'guida' | 'registrazioni' | 'impara' | 'regole' | 'memoria' | 'collegamenti';

/** label is a getter (ADR 0057): read at use time, so it follows the current language */
const page = (id: BrainPageId, key: string): { id: BrainPageId; readonly label: string; key: string } => ({ id, key, get label() { return id==='file'?t('viewer.title'):t(`brainPages.nav.${id}`); } });
export const BRAIN_PAGES: { id: BrainPageId; readonly label: string; key: string }[] = [
  page('home', 'G H'),
  page('agenti', 'G A'),
  page('task', 'G O'),
  page('flussi', 'G U'),
  // Idee, Skill, Regole and Script are tabs of Memoria (ADR 0122): their ids, keys and links stay and land on the tab
  // (actions.ts go() → lib/memory-hub.ts); the sidebar no longer lists them
  page('idee', 'G I'),
  // Andamento (ADR 0202): Costi, Qualità, Apprendimento, Classificatori and Uso as tabs (components/andamento/), rendered
  // by App.tsx PageFrame; the old ids and their keys (G Q, G J, G K below in GO_ALIASES) open the matching tab
  page('andamento', 'G C'),
  // the brain's scripts (ADR 0076): a Memoria tab; the app's Log, which also holds the brain's changelog since the
  // Changelog page left (ADR 0111), is rendered by App.tsx PageFrame
  page('script', 'G T'),
  page('log', 'G N'),
  // the skills (components/SkillsPage.tsx, ADR 0018): a Memoria tab
  page('skill', 'G S'),
  // not a brain page: the app's Settings (components/SettingsPage.tsx, rendered by App.tsx); listed here for places, links and G P
  page('impostazioni', 'G P'),
  // the Brain section's own pages (ADR 0077: agents, skills, rules, memory, the map of their links; the classifiers are a
  // tab of Andamento since ADR 0202), rendered by App.tsx PageFrame (components/brain-model/)
  page('regole', 'G L'),
  page('memoria', 'G Y'),
  page('collegamenti', 'G B'),
  // not a brain page either: the guide to the app's concepts (components/GuidePage.tsx, content in shared/concept-guide.ts)
  page('guida', 'G E'),
  // not a brain page either: the call recordings and their local transcripts (components/RecordingsPage.tsx, ADR 0154)
  page('registrazioni', 'G V'),
  // not a brain page either: the lessons the user asks for to master a PR or a topic (components/impara/, ADR 0185)
  page('impara', 'G X'),
];
const IDS = new Set<string>(['file',...BRAIN_PAGES.map(p => p.id)]);
export const isBrainPage = (s: string): s is BrainPageId => IDS.has(s);
/** Old page ids still found in links (feed, notes, the Orchestrator's habits) → today's. Oggi (home) and Adesso became DevOps
 *  (the user, 2026-10-12: "li trovo ridondanti e poco utili, mentre sezione devops super utile"), DevOps became Task
 *  (ADR 0079). Fatto e standup left (ADR 0181): its old links open the Log, the app's record of what was done;
 *  Confronto modelli went (ADR 0201): its links open Andamento's Qualità tab (lib/andamento.ts TREND_PAGES). */
export const PAGE_ALIAS: Record<string, BrainPageId> = { fatto: 'log', diario: 'log', oggi: 'task', adesso: 'task', dafare: 'task', devops: 'task', esplora: 'file', procedure: 'skill', procedura: 'skill', miglioramento: 'regole', changelog: 'log', diagnostica: 'log', dashboard: 'memoria',
  // the four statistics pages merged into Andamento (ADR 0202); parseTarget and go() keep the tab they name
  costi: 'andamento', qualita: 'andamento', apprendimento: 'andamento', classificatori: 'andamento' };
/** Their old go-to keys still work: G R (the old Regole imparate) opens Regole, where those rules live now (ADR 0082);
 *  G D (the Dashboard, gone with ADR 0122: its parts live in Memoria, Andamento and Idee) opens Memoria; G Q, G J and G K
 *  (Qualità, Apprendimento, Classificatori) open their Andamento tab (ADR 0202: go() redirects the old id; G C = Andamento
 *  itself, which opens on Costi); G K opens Qualità, where the Classificatori section lives since ADR 0210. */
export const GO_ALIASES: { id: string; key: string }[] = [{ id: 'regole', key: 'G R' }, { id: 'memoria', key: 'G D' }, { id: 'qualita', key: 'G Q' }, { id: 'apprendimento', key: 'G J' }, { id: 'classificatori', key: 'G K' }];

/** "esplora/ops/x.md" → { id: 'esplora', arg: 'ops/x.md' }; "mappa/tutto" → { map: true, full: true }. */
export function parseTarget(t: string): { map: true; full: boolean; focus?: string } | { map: false; id: BrainPageId; arg?: string } | null {
  const [first = '', ...rest] = String(t ?? '').replace(/^#/, '').split('/');
  // an old statistics page keeps its tab: "costi/30" → Andamento's Costi on 30 days, "memoria/apprendimento" → its
  // Apprendimento tab (ADR 0202, the same redirect as go())
  const trend = trendRedirect(first, rest.join('/') || null);
  if (trend) return { map: false, id: 'andamento', arg: trend.arg };
  const raw = PAGE_ALIAS[first] ?? first;
  const head = raw === 'spunti' ? 'idee' : raw;
  const arg = raw === 'spunti' ? 'ia' : rest.join('/') || undefined;
  if(head==='file')return arg?{map:false,id:'file',arg:normalizeFileArg(arg)}:{map:false,id:'home'};
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
  const label = cur.id==='file'?t('viewer.title'):BRAIN_PAGES.find(p => p.id === cur.id)?.label ?? cur.id;
  let page: ReactNode;
  switch (cur.id) {
    case 'home': page = <Suspense fallback={null}><Home nav={nav} /></Suspense>; break;
    case 'flussi': page = <Suspense fallback={null}><Routines /></Suspense>; break;
    case 'idee': page = <Idee arg={cur.arg} nav={nav} />; break;
    case 'file': page = <FileViewer arg={cur.arg}/>; break;
    case 'impostazioni': case 'skill': case 'guida': case 'registrazioni': case 'impara': case 'regole': case 'memoria': case 'collegamenti': case 'script': case 'log': page = null; break; // rendered by the app (App.tsx PageFrame)
    case 'task': page = <TaskPage />; break;
    // in the app Andamento is App.tsx PageFrame's (components/andamento/); alone (the test route) its two brain tabs show
    // as the full pages they were
    case 'andamento': { const tr = parseTrendArg(cur.arg); page = tr.tab === 'costi' ? <Costi arg={tr.rest ?? undefined} nav={nav} /> : tr.tab === 'qualita' ? <Qualita nav={nav} /> : null; break; }
  }
  return (
    <div ref={scroller} className="bx bx-page bx-scroll" data-testid={`brain-page-${cur.id}`} role="region" aria-label={label}>
      <DiscussContext.Provider value={bridge ?? null}>
        <div className="bx-inner" key={`${cur.id}/${cur.id === 'file' ? '' : cur.arg ?? ''}`}>{page}</div>
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
