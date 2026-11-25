// The plans in the renderer (ADR 0342): the rows of the list, read once and again at each plans:changed, shared by
// every place that shows one (the Mappa page, the Grindhouse strips). One subscription for the whole app, started by the
// first reader. Used by components/plans/*, StrategyPanel.tsx and actions.ts; pinned by
// test/unit/plans/renderer-store.test.ts.
import { useEffect, useSyncExternalStore } from 'react';
import type { PlanInfo } from '@shared/plan';
import { mapOfChat } from '../lib/plans';

let rows: PlanInfo[] | null = null, failed: string | null = null, started = false, reading = false, again = false;
const listeners = new Set<() => void>();
const tell = (): void => { for (const l of listeners) l(); };

async function fetchAll(): Promise<PlanInfo[]> {
  const [open, put, trash] = await Promise.all([window.sb.invoke('plans:list', {}), window.sb.invoke('plans:list', { archived: true }), window.sb.invoke('plans:list', { trash: true })]);
  return [...open, ...put, ...trash];
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
export function watchPlans(): void {
  if (started || typeof window === 'undefined' || !window.sb) return;
  started = true;
  window.sb.on('plans:changed', () => void read());
  void read();
}
/** Every map, the archived ones too; null = not read yet. */
export const plans = (): PlanInfo[] | null => rows;
/** Why the list could not be read, when it could not. */
const plansError = (): string | null => failed;
/** The map of a chat's job, read now (the rows on screen may be older than the plan that just came). */
export async function planOfChat(chatId: string): Promise<PlanInfo | null> {
  return mapOfChat(await fetchAll(), chatId);
}
const subscribe = (l: () => void): (() => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export function usePlans(): { rows: PlanInfo[] | null; error: string | null; retry: () => void } {
  useEffect(watchPlans, []);
  return {
    rows: useSyncExternalStore(subscribe, plans, plans),
    error: useSyncExternalStore(subscribe, plansError, plansError),
    retry: () => void read(),
  };
}
