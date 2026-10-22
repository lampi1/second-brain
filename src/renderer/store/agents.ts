// Typed local catalog/setup bridge: the role catalog, the user's edits and "Ripristina predefinito", and the first-run
// setup state. Role edits affect future chats; the owner/model snapshots of running chats stay in main.
import type { AgentCatalog, AgentDraft, SetupDraft, SetupState } from '@shared/agents';
import { useEffect } from 'react';
import { sb } from '../sb';
import { createStore } from './createStore';
import { t } from '../i18n';

export const agents = createStore<{ catalog: AgentCatalog | null; setup: SetupState | null; error: string | null }>({ catalog: null, setup: null, error: null });
let started = false, catalogRevision = 0, setupRevision = 0;
export async function refreshAgents(): Promise<void> {
  const revision = ++catalogRevision;
  try { const catalog = await sb.invoke('agents:list', undefined); if (revision === catalogRevision) agents.set(s => ({ ...s, catalog, error: null })); }
  catch { if(revision === catalogRevision) agents.set(s => ({ ...s, error: t('appText.agents.catalogUnavailable') })); }
}
export async function refreshSetup(): Promise<void> {
  const revision = ++setupRevision;
  try { const setup = await sb.invoke('setup:get', undefined); if (revision === setupRevision) agents.set(s => ({ ...s, setup, error: null })); }
  catch { if(revision === setupRevision) agents.set(s => ({ ...s, error: t('appText.agents.setupUnavailable') })); }
}
function start(): void {
  if (started) return; started = true;
  sb.on('agents:changed', catalog => { catalogRevision++; agents.set(s => ({ ...s, catalog, error: null })); });
  void refreshAgents();
  void refreshSetup();
}
export function useAgents() { useEffect(start, []); return agents.use(s => s); }
export async function saveAgent(profile: AgentDraft, id: string) {
  const saved = await sb.invoke('agents:save', { profile, id }); await refreshAgents(); return saved;
}
export async function resetAgent(id: string) { const saved = await sb.invoke('agents:reset', { id }); await refreshAgents(); return saved; }
export const agentHistory = (id: string) => sb.invoke('agents:history', { id });
export async function restoreAgentVersion(id: string, version: number) { const saved = await sb.invoke('agents:restoreVersion', { id, version }); await refreshAgents(); return saved; }
let saving: Promise<unknown> = Promise.resolve();
export function saveSetup(preferences: SetupDraft, status: 'draft' | 'completed' | 'skipped'): Promise<SetupState> {
  const snapshot = structuredClone(preferences);
  const next = saving.catch(() => {}).then(() => sb.invoke('setup:save', { preferences: snapshot, status }));
  setupRevision++;
  saving = next; return next.then(setup => { setupRevision++; agents.set(s => ({ ...s, setup })); return setup; });
}
