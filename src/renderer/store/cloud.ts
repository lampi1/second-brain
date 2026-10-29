// Cloud agents on the page (ADR 0080): main's CloudState kept live from 'cloud:changed' after one 'cloud:list'
// (refresh: the vendors are asked now, main limits it to every 30 s), which strip is expanded (its messages stream,
// Cursor) and the user's actions (start, follow-up, stop, "Porta in locale", "Apri", dismiss) with their errors as
// toasts. Starts itself on first use, like handoffs.ts. Used by CloudStrips.tsx and AgentStrips.tsx.
import type { CloudAgent, CloudState } from '@shared/contract';
import { createStore } from './createStore';
import { toast } from './ui';
import { t } from '../i18n';

interface CloudUi { state: CloudState | null; expanded: string | null }
export const cloudStore = createStore<CloudUi>({ state: null, expanded: null });
let started = false;

function start(): void {
  if (started) return;
  started = true;
  window.sb.on('cloud:changed', state => cloudStore.set(s => ({ ...s, state })));
  void window.sb.invoke('cloud:list', { refresh: true }).then(state => cloudStore.set(s => ({ ...s, state })), () => {});
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** The cloud agents' ids, newest first. */
export function useCloudIds(): string[] {
  start();
  return cloudStore.use(s => s.state?.agents.map(a => a.id) ?? [], sameIds);
}
export function useCloudAgent(id: string): CloudAgent | undefined {
  start();
  return cloudStore.use(s => s.state?.agents.find(a => a.id === id));
}
export function useCloudState(): CloudState | null { start(); return cloudStore.use(s => s.state); }
export const useCloudExpanded = (id: string): boolean => cloudStore.use(s => s.expanded === id);

export function setCloudExpanded(id: string, on: boolean): void {
  const next = on ? id : cloudStore.get().expanded === id ? null : cloudStore.get().expanded;
  cloudStore.set(s => ({ ...s, expanded: next }));
  void window.sb.invoke('cloud:watch', { id: next }).catch(() => {});
}

const why = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));

export async function cloudFollowUp(id: string, text: string): Promise<boolean> {
  try { await window.sb.invoke('cloud:followUp', { id, text }); return true; } catch (e) { toast(t('cloud.failed', { why: why(e) }), 'err'); return false; }
}
export async function cloudStop(id: string): Promise<void> {
  try { await window.sb.invoke('cloud:stop', { id }); } catch (e) { toast(t('cloud.failed', { why: why(e) }), 'err'); }
}
export async function cloudApply(id: string): Promise<void> {
  try { const r = await window.sb.invoke('cloud:apply', { id }); toast(t('cloud.applied', { path: r.worktree }), 'ok'); } catch (e) { toast(t('cloud.failed', { why: why(e) }), 'err'); }
}
export async function cloudDismiss(id: string): Promise<void> {
  try { const state = await window.sb.invoke('cloud:dismiss', { id }); cloudStore.set(s => ({ ...s, state })); } catch (e) { toast(t('cloud.failed', { why: why(e) }), 'err'); }
}
/** "Apri": the vendor's page in an internal browser tab (the fallback for whatever the app cannot do itself). */
export async function openCloudPage(a: Pick<CloudAgent, 'url'>): Promise<void> {
  if (!a.url) return;
  try { await window.sb.invoke('browser:open', { url: a.url }); } catch (e) { toast(t('cloud.failed', { why: why(e) }), 'err'); }
}
