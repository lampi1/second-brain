// Test-only route of the brain area, until the workspace UI mounts the brain pages itself: when the page hash starts
// with "#brain-test", the app root renders this instead of the workspace. "#brain-test/<page>[/<arg>]" shows a page in
// a minimal shell (a rail with every page and the map button); "#brain-test/mappa[/tutto][?flat]" opens the 3D map
// (flat = the 2D list, as without WebGL). Read-only like every brain page. Used by test/e2e/brain-ui.spec.ts.
// Mount (app root, e.g. main.tsx):  {isBrainTestRoute() ? <BrainTestRoute /> : <App />}
import { useEffect, useState } from 'react';
import { BRAIN_PAGES, BrainMap, BrainPage, parseTarget, type BrainPageId } from './index';
import { IconMap } from './components/ui';

export const BRAIN_TEST_PREFIX = '#brain-test';
export const isBrainTestRoute = (hash: string = location.hash): boolean => hash.startsWith(BRAIN_TEST_PREFIX);

export function BrainTestRoute() {
  const [hash, setHash] = useState(location.hash);
  const [last, setLast] = useState<{ id: BrainPageId; arg?: string }>({ id: 'task' });
  useEffect(() => { const f = () => setHash(location.hash); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  const raw = hash.slice(BRAIN_TEST_PREFIX.length).replace(/^\//, '');
  let decoded = raw;
  try { decoded = decodeURI(raw); } catch { /* a stray "%": keep it as typed */ }
  const [path = '', query = ''] = decoded.split('?');
  const t = parseTarget(path || 'task') ?? { map: false as const, id: 'task' as BrainPageId };
  const pageKey = t.map ? '' : `${t.id}/${t.arg ?? ''}`;
  useEffect(() => { if (!t.map) setLast({ id: t.id, arg: t.arg }); }, [pageKey]);
  const page = t.map ? last : { id: t.id, arg: t.arg };
  const nav = (target: string) => { location.hash = `${BRAIN_TEST_PREFIX}/${encodeURI(target)}`; };
  return (
    <div className="bx bx-shell" data-testid="brain-test">
      <nav className="bx-rail" aria-label="Pagine del cervello">
        <div className="brand"><i>◆</i> Cervello</div>
        {BRAIN_PAGES.map(p => (
          <button key={p.id} type="button" aria-current={p.id === page.id ? 'page' : undefined} onClick={() => nav(p.id)} data-testid={`brain-nav-${p.id}`} title={`${p.label} (${p.key})`}>{p.label}</button>
        ))}
        <span className="sp" />
        <button type="button" className="map" onClick={() => nav('mappa')} data-testid="brain-nav-map"><IconMap /> Mappa 3D</button>
      </nav>
      <main className="bx-shell-main"><BrainPage id={page.id} arg={page.arg} onNavigate={nav} /></main>
      {t.map && <BrainMap full={t.full} focus={t.focus} mode={/(^|&)flat\b/.test(query) ? 'flat' : undefined} onClose={() => nav(last.arg ? `${last.id}/${last.arg}` : last.id)} onNavigate={nav} />}
    </div>
  );
}
