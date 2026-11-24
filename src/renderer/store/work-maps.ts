// The work maps in the renderer (ADR 0342): the rows of the list, read once and again at each workmap:changed, shared by
// every place that shows one (the Mappa page, the Grindhouse strips). One subscription for the whole app, started by the
// first reader. Used by components/work-map/*, StrategyPanel.tsx and actions.ts; pinned by
// test/unit/work-maps-renderer-store.test.ts.
import { useEffect, useSyncExternalStore } from 'react';
import type { WorkMapInfo } from '@shared/work-map';
import { mapOfChat } from '../lib/work-maps';

let rows: WorkMapInfo[] | null = null, failed: string | null = null, started = false, reading = false, again = false;
const listeners = new Set<() => void>();
const tell = (): void => { for (const l of listeners) l(); };

async function fetchAll(): Promise<WorkMapInfo[]> {
  const [open, put] = await Promise.all([window.sb.invoke('workmap:list', {}), window.sb.invoke('workmap:list', { archived: true })]);
  return [...open, ...put];
}
/** Reads the list; a change that comes while it reads makes it read again. A failure keeps the rows it had. */
async function read(): Promise<void> {
  if (reading) { again = true; return; }
  reading = true;
  try {
    do { again = false; rows = await fetchAll(); failed = null; tell(); } while (again);
  } catch (e) { failed = e instanceof Error ? e.message : String(e); tell(); } finally { reading = false; }
}
/** Reads the list the first time, then at every change. */
export function watchWorkMaps(): void {
  if (started || typeof window === 'undefined' || !window.sb) return;
  started = true;
  window.sb.on('workmap:changed', () => void read());
  void read();
}
/** Every map, the archived ones too; null = not read yet. */
export const workMaps = (): WorkMapInfo[] | null => rows;
/** Why the list could not be read, when it could not. */
const workMapsError = (): string | null => failed;
/** The map of a chat's job, read now (the rows on screen may be older than the plan that just came). */
export async function workMapOfChat(chatId: string): Promise<WorkMapInfo | null> {
  return mapOfChat(await fetchAll(), chatId);
}
const subscribe = (l: () => void): (() => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export function useWorkMaps(): { rows: WorkMapInfo[] | null; error: string | null; retry: () => void } {
  useEffect(watchWorkMaps, []);
  return {
    rows: useSyncExternalStore(subscribe, workMaps, workMaps),
    error: useSyncExternalStore(subscribe, workMapsError, workMapsError),
    retry: () => void read(),
  };
}
