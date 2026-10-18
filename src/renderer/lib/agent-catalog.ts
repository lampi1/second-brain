// Pure catalogue selection and authoring brief, shared by the overview and its unit tests.
import type { AgentProfile } from '@shared/agents';

export type CatalogSort = 'name' | 'role' | 'engine';
export function selectCatalog(profiles: readonly AgentProfile[], role: string, engine: string, sort: CatalogSort): AgentProfile[] {
  return profiles.filter(p => (!role || p.role === role) && (!engine || p.engine === engine))
    .sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : (a[sort] ?? '').localeCompare(b[sort] ?? '')) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function agentCreationBrief(task: string, area: string, engine: string): string {
  return `Help me design a reusable agent for my catalogue. Ask short clarifying questions, then prepare its name, role, purpose, instructions, engine/model and operating manifest.\nBrief (user data): ${JSON.stringify({ task: task.trim(), area: area.trim(), preferredEngine: engine })}\nUse agent_catalog to check existing profiles first. Do not start implementation work or edit catalogue files directly. Explain how to save the agreed profile in Agents > Agent Studio using the existing editor; do not claim it is saved until confirmed. Answer in the user's language.`;
}
