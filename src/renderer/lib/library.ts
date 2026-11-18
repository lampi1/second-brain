// Memoria → Artifact (ADR 0319): the artifact index as the page sees it, shared by the tab (components/library/*) and
// the viewer's artifact bar: loaded once on first use, reloaded on 'library:changed' (only the newest answer lands),
// with the OS the page runs on for comparing paths. A card's picture is asked once per artifact and version and kept.
import { useSyncExternalStore } from 'react';
import { extOf, type Artifact, type ArtifactList, type ArtifactThumb } from '@shared/library';
import { t } from '../i18n';

const EMPTY: ArtifactList = { artifacts: [], scanning: false, scannedAt: null, backfilled: false, dropped: 0, cleaned: 0 };
let state: { list: ArtifactList; loaded: boolean; error: string | null } = { list: EMPTY, loaded: false, error: null };
const subs = new Set<() => void>();
let rev = 0, started = false;
const set = (next: typeof state) => { state = next; for (const fn of subs) fn(); };
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

async function load(channel: 'library:list' | 'library:refresh' = 'library:list', scan = false): Promise<void> {
  const mine = ++rev;
  try { const list = await (channel === 'library:list' ? window.sb.invoke(channel, { scan }) : window.sb.invoke(channel, undefined)); if (mine === rev) set({ list, loaded: true, error: null }); }
  catch (e) { if (mine === rev) set({ ...state, loaded: true, error: errText(e) }); }
}

function start(): void {
  if (started || typeof window === 'undefined' || !window.sb) return;
  started = true;
  window.sb.on('library:changed', () => { void load(); });
  void load();
}

const subscribe = (fn: () => void) => { start(); subs.add(fn); return () => { subs.delete(fn); }; };
const snapshot = () => state;

export function useLibrary(): typeof state {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** The tab opened: the index, and a look through the folders when the last one is older than a minute. */
export const openedLibrary = (): Promise<void> => (typeof window === 'undefined' || !window.sb ? Promise.resolve() : load('library:list', true));

/** «Aggiorna»: the folders looked through now. */
export const refreshLibrary = (): Promise<void> => load('library:refresh');

/** The OS for comparing paths (Windows and macOS disks ignore case). */
export const pagePlatform = (): string => {
  const p = typeof navigator === 'undefined' ? '' : navigator.platform;
  return /^win/i.test(p) ? 'win32' : /mac/i.test(p) ? 'darwin' : 'linux';
};

const thumbs = new Map<string, Promise<ArtifactThumb | null>>();
/** A card's picture, asked once per artifact version (`stamp` = its newest version's time). */
export function thumbOf(id: string, stamp: number): Promise<ArtifactThumb | null> {
  const key = `${id}@${stamp}`;
  let p = thumbs.get(key);
  if (!p) {
    p = window.sb.invoke('library:thumb', { id }).catch(() => null);
    if (thumbs.size > 400) thumbs.delete(thumbs.keys().next().value!);
    thumbs.set(key, p);
  }
  return p;
}

const NAMED_BADGE: ReadonlySet<Artifact['kind']> = new Set(['html', 'markdown', 'pdf']);
/** A card's or a related button's badge: HTML, MD, PDF; every other file by its own extension (PNG, CSV, DOCX, MP4). */
export const badgeOf = (a: Pick<Artifact, 'kind' | 'path'>): string => (NAMED_BADGE.has(a.kind) ? t(`lib.badge.${a.kind as 'html' | 'markdown' | 'pdf'}`) : (extOf(a.path) || t('lib.badge.image')).slice(0, 5).toUpperCase());

/** Keeps an artifact (the cleanup never takes it) or lets it go again (ADR 0323). */
export async function pinArtifact(id: string, pinned: boolean): Promise<void> {
  const mine = ++rev;
  try { const list = await window.sb.invoke('library:pin', { id, pinned }); if (mine === rev) set({ list, loaded: true, error: null }); }
  catch (e) { if (mine === rev) set({ ...state, error: errText(e) }); }
}

/** Opens an artifact's file with the system's app (main checks it is one of the index's); '' when it opened. */
export async function openWithApp(path: string): Promise<string> {
  try { const r = await window.sb.invoke('library:open', { path }); return r.ok ? '' : r.error ?? 'error'; } catch (e) { return errText(e); }
}
