// Typed local catalog/setup bridge. Agent drafts go to a provider only through an explicit builder action.
// Profile edits affect future conversations; authoritative owner/model snapshots of running agents stay in main.
import type { AgentCatalog, AgentDraft, AgentDraftRequest, SetupDraft, SetupState } from '@shared/agents';
import { useEffect } from 'react';
import { sb } from '../sb';
import { createStore } from './createStore';

export const agents = createStore<{ catalog: AgentCatalog | null; setup: SetupState | null; error: string | null }>({ catalog: null, setup: null, error: null });
let started = false, catalogRevision = 0, setupRevision = 0;
export async function refreshAgents(): Promise<void> {
  const revision = ++catalogRevision;
  try { const catalog = await sb.invoke('agents:list', undefined); if (revision === catalogRevision) agents.set(s => ({ ...s, catalog, error: null })); }
  catch { if(revision === catalogRevision) agents.set(s => ({ ...s, error: 'Catalogo non disponibile. Puoi riprovare senza perdere le conversazioni.' })); }
}
export async function refreshSetup(): Promise<void> {
  const revision = ++setupRevision;
  try { const setup = await sb.invoke('setup:get', undefined); if (revision === setupRevision) agents.set(s => ({ ...s, setup, error: null })); }
  catch { if(revision === setupRevision) agents.set(s => ({ ...s, error: 'Configurazione iniziale non disponibile: riprova.' })); }
}
function start(): void {
  if (started) return; started = true;
  sb.on('agents:changed', catalog => { catalogRevision++; agents.set(s => ({ ...s, catalog, error: null })); });
  void refreshAgents();
  void refreshSetup();
}
export function useAgents() { useEffect(start, []); return agents.use(s => s); }
export async function saveAgent(profile: AgentDraft, id?: string) {
  const saved = await sb.invoke('agents:save', { profile, ...(id ? { id } : {}) }); await refreshAgents(); return saved;
}
export async function duplicateAgent(id: string) { const saved = await sb.invoke('agents:duplicate', { id }); await refreshAgents(); return saved; }
export const draftAgent = (request: AgentDraftRequest) => sb.invoke('agents:draft', request);
let saving: Promise<unknown> = Promise.resolve();
export function saveSetup(preferences: SetupDraft, status: 'draft' | 'completed' | 'skipped'): Promise<SetupState> {
  const snapshot = structuredClone(preferences);
  const next = saving.catch(() => {}).then(() => sb.invoke('setup:save', { preferences: snapshot, status }));
  setupRevision++;
  saving = next; return next.then(setup => { setupRevision++; agents.set(s => ({ ...s, setup })); return setup; });
}
