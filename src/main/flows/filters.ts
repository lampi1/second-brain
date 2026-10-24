// The filters of a DevOps trigger (ADR 0153): include tags (all of them), exclude tags (none of them), a list of work
// item ids and an iteration path. Pure: used by the detector (devops-detector.ts) on every detected revision, and by the
// Routine page's preview of one work item (runtime.ts previewItem), so a manual start says why an item would or would
// not match before the user starts it.
import type { FlowTrigger } from '../../shared/flow-automation';

type DevOpsTrigger = Extract<FlowTrigger, { kind: 'devops' }>;
export interface ItemFacts { id: number; tags: string[]; iterationPath?: string; areaPath?: string; state?: string; type?: string }

const fold = (s: string): string => s.normalize('NFKC').trim().toLowerCase();
const path = (s: string): string => fold(s).replace(/\//g, '\\').replace(/\\+$/g, '');
/** DevOps keeps tags as one "a; b; c" field. */
export const splitTags = (field: unknown): string[] => typeof field === 'string' ? field.split(';').map(tag => tag.trim()).filter(Boolean) : [];

/** Why an item does not pass the trigger's filters, in plain words; empty = it passes. */
export function filterMisses(trigger: DevOpsTrigger, item: ItemFacts): string[] {
  const misses: string[] = [], tags = new Set(item.tags.map(fold));
  for (const tag of trigger.includeTags ?? []) if (!tags.has(fold(tag))) misses.push(`manca il tag «${tag}»`);
  for (const tag of trigger.excludeTags ?? []) if (tags.has(fold(tag))) misses.push(`ha il tag escluso «${tag}»`);
  if (trigger.workItemIds?.length && !trigger.workItemIds.includes(item.id)) misses.push('non è tra gli id scelti');
  if (trigger.iterationPath) {
    const want = path(trigger.iterationPath), got = item.iterationPath ? path(item.iterationPath) : '';
    if (got !== want && !got.startsWith(`${want}\\`)) misses.push(`non è nell'iterazione ${trigger.iterationPath}`);
  }
  return misses;
}
/** The trigger's scope checks the preview repeats (area, type, state), for an item the user pasted by hand. */
export function scopeMisses(trigger: DevOpsTrigger, item: ItemFacts): string[] {
  const misses: string[] = [];
  if (item.areaPath !== undefined) {
    const want = path(trigger.areaPath), got = path(item.areaPath);
    if (got !== want && !got.startsWith(`${want}\\`)) misses.push(`area ${item.areaPath} fuori da ${trigger.areaPath}`);
  }
  if (item.type !== undefined && fold(item.type) !== fold(trigger.workItemType)) misses.push(`è un ${item.type}, la routine prende ${trigger.workItemType}`);
  if (item.state !== undefined && !trigger.states.some(state => fold(state) === fold(item.state!))) misses.push(`stato ${item.state} non tra ${trigger.states.join(', ')}`);
  return misses;
}
