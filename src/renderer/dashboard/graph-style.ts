// Semantic node styles and bounded label priority for the brain graph (Graph.tsx, BrainNotesMap.tsx) and tests.
import { t } from '../i18n';

export function nodeStyle(kind = 'note', layer?: string) {
  if (layer === 'regole') kind = 'rule';
  switch (kind) {
    case 'area': case 'group': case 'gruppo': case 'cartella': return { color: '#d49a36', radius: 10, label: t('brainText.graphStyle.area') };
    case 'agent': case 'agente': case 'orchestrator': case 'chat': return { color: '#aa83ed', radius: 8, label: t('brainText.graphStyle.agent') };
    case 'skill': case 'tool': return { color: '#36aaa5', radius: 7, label: t('brainText.graphStyle.skill') };
    case 'rule': case 'regola': return { color: '#e17891', radius: 6, label: t('brainText.graphStyle.rule') };
    default: return { color: '#659ad5', radius: 5, label: t('brainText.graphStyle.note') };
  }
}

/** Show a few hubs at rest; selected and adjacent nodes take priority during exploration. */
export function labelCandidates<T extends { id: string; central?: boolean }>(nodes: T[], edges: { from: string; to: string }[], selected: string | null): T[] {
  if (nodes.length <= 14) return nodes;
  const degree = new Map<string, number>(), near = new Set<string>();
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
    if (e.from === selected) near.add(e.to);
    if (e.to === selected) near.add(e.from);
  }
  const score = (n: T) => (n.id === selected ? 1e6 : near.has(n.id) ? 1e5 : n.central ? 1e4 : 0) + (degree.get(n.id) ?? 0);
  return [...nodes].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id)).slice(0, 8);
}
