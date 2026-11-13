// The page's side of the usage counter (ADR 0202): `trackPlace` counts a page (or tab) open, called by actions.ts go();
// `track(action)` counts a main action, called by the actions themselves (new request, Orchestrator, Discuti, focus
// mode…) and by any element with a `data-track="<action>"` attribute (one click listener on the document, installed by
// main.tsx). Counts are kept here and sent in one batch ('usecount:add') every FLUSH_MS, at MAX_PENDING uses or when the
// page hides; main stores them per day in app.db (main/use-counter.ts). Zero tokens, local only, never content: a key
// is a page id, a tab or an action name, never what the page shows. Tests: test/unit/use-counter-renderer.test.ts.
import { parseHubArg } from './memory-hub';
import { parseTrendArg } from './andamento';

export const FLUSH_MS = 20_000;
export const MAX_PENDING = 50;
/** what main accepts (KEY_RE in main/use-counter.ts): lowercase words, digits, '-', '_', '.' */
const WORD = /^[a-z0-9][a-z0-9_.-]{0,40}$/;

let pending = new Map<string, number>();
let count = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

/** The counter key of a place: the page, and for the pages made of tabs (Memoria, Andamento, Impostazioni) the tab. */
export function placeKey(page: string, arg: string | null): string | null {
  const p = page.toLowerCase();
  if (!WORD.test(p)) return null;
  if (p === 'memoria') return `page:memoria/${parseHubArg(arg).tab}`;
  if (p === 'andamento') return `page:andamento/${parseTrendArg(arg).tab}`;
  if (p === 'impostazioni') { const s = String(arg ?? '').split('/')[0]!.toLowerCase(); return WORD.test(s) ? `page:impostazioni/${s}` : 'page:impostazioni'; }
  return `page:${p}`;
}

function add(key: string | null): void {
  if (!key) return;
  pending.set(key, (pending.get(key) ?? 0) + 1);
  if (++count >= MAX_PENDING) { flushUseCounts(); return; }
  timer ??= setTimeout(flushUseCounts, FLUSH_MS);
}

/** One page (or tab) opened. */
export const trackPlace = (page: string, arg: string | null): void => add(placeKey(page, arg));
/** One main action used ("new-request", "discuss"…): a lowercase word, anything else is ignored. */
export const track = (action: string): void => add(WORD.test(action) ? `action:${action}` : null);

/** Sends what is pending now (the timer, a full batch, the page hiding); a failed send is dropped, never retried. */
export function flushUseCounts(): void {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!pending.size) return;
  const counts = Object.fromEntries(pending);
  pending = new Map(); count = 0;
  const bridge = typeof window === 'undefined' ? undefined : window.sb;
  void bridge?.invoke('usecount:add', { counts }).catch(() => { /* a counter: losing a batch is fine */ });
}

/** The click listener for `data-track` and the flush when the page hides (main.tsx, once). */
export function installUseCounter(doc: Document = document): () => void {
  const onClick = (e: MouseEvent) => {
    const el = (e.target as Element | null)?.closest?.('[data-track]');
    const name = el?.getAttribute('data-track');
    if (name) track(name);
  };
  const onHide = () => flushUseCounts();
  doc.addEventListener('click', onClick, true);
  doc.defaultView?.addEventListener('pagehide', onHide);
  return () => { doc.removeEventListener('click', onClick, true); doc.defaultView?.removeEventListener('pagehide', onHide); };
}

/** Tests: what is waiting to be sent. */
export const pendingUseCounts = (): Record<string, number> => Object.fromEntries(pending);
