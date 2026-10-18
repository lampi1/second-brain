// Pure catalogue selection (filters and sort), shared by the overview (AgentCatalogPage) and its unit tests.
import type { AgentProfile } from '@shared/agents';

export type CatalogSort = 'name' | 'role' | 'engine';
export function selectCatalog(profiles: readonly AgentProfile[], role: string, engine: string, sort: CatalogSort): AgentProfile[] {
  return profiles.filter(p => (!role || p.role === role) && (!engine || p.engine === engine))
    .sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : (a[sort] ?? '').localeCompare(b[sort] ?? '')) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

