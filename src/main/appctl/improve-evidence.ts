// Strict selection boundary for the read-only Improve tool. Never expands missing selections into all personal data.
import type { ImproveEvidenceSelection } from '../improve/evidence';
export function parseImproveSelection(input: unknown): ImproveEvidenceSelection {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid evidence selection');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !['factRefs', 'agentIds', 'insightRefs', 'budgetBytes'].includes(key))) throw Error('Unknown evidence selection field');
  const strings = (items: unknown, max: number) => {
    if (!Array.isArray(items) || items.length > max || items.some(item => typeof item !== 'string' || !item || item.length > 160 || /[\u0000-\u001f]/.test(item))) throw Error('Invalid evidence references');
    return [...new Set(items as string[])];
  };
  if (!Number.isSafeInteger(value.budgetBytes) || Number(value.budgetBytes) < 256 || Number(value.budgetBytes) > 32768) throw Error('Invalid evidence budget');
  return { factRefs: strings(value.factRefs, 64), agentIds: strings(value.agentIds, 20), ...(value.insightRefs === undefined ? {} : { insightRefs: strings(value.insightRefs, 50) }), budgetBytes: value.budgetBytes as number };
}
