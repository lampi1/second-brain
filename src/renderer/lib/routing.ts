// Pure helpers of the «Instradamento modelli» editor (components/RoutingGroup.tsx): Italian labels of the task kinds,
// the models the table may pick (the registry's 'auto' rows), the efforts a model offers (max never: only on request),
// and the editor's text rows to and from the table's rows. Unit-tested in test/unit/routing-ui.test.ts.
import type { Effort, ModelRegistry, RegistryModel, RoutingRow, TaskKind } from '@shared/contract';

export const KIND_IT: Record<TaskKind | '*', string> = {
  '*': 'Qualsiasi', 'qa-run': 'QA e test', review: 'Review', 'bug-fix': 'Fix di bug', 'ops-read': 'Log e ops', writing: 'Scrittura',
  triage: 'Smistamento', 'research-web': 'Ricerca web', investigation: 'Indagine', 'app-feature': 'Funzione nuova', regia: 'Regia', altro: 'Altro',
};

/** What the table may pick: the 'auto' models of 'auto' harnesses; a model a row already names stays listed. */
export function pickable(reg: ModelRegistry | null, keep: string[] = []): RegistryModel[] {
  if (!reg) return [];
  return reg.models.filter(m => (m.routing === 'auto' && reg.harnesses[m.harness]?.routing === 'auto') || keep.includes(m.id));
}

/** A model's efforts the table may set: max only on request (never from the table). */
export const tableEfforts = (m: RegistryModel | undefined): Effort[] => (m?.efforts ?? []).filter(e => e !== 'max');

/** One editable row: area as text ("App, Pers · App"; empty = any area). */
export interface EditRow { kind: TaskKind | '*'; area: string; model: string; effort: Effort | ''; why: string; evidence: string; since: string }

export const toEdit = (r: RoutingRow): EditRow => ({
  kind: r.kind, area: Array.isArray(r.area) ? r.area.join(', ') : r.area ?? '', model: r.model, effort: r.effort ?? '',
  why: r.why, evidence: r.evidence, since: r.since,
});

/** Back to the table's shape; the harness is the model's own (a model runs on one harness only). */
export function fromEdit(e: EditRow, reg: ModelRegistry | null, today: string): RoutingRow {
  const areas = e.area.split(',').map(a => a.trim()).filter(Boolean);
  const m = reg?.models.find(x => x.id === e.model);
  return {
    kind: e.kind, ...(areas.length ? { area: areas.length === 1 ? areas[0]! : areas } : {}),
    harness: m?.harness ?? 'claude', model: e.model, effort: e.effort || null,
    why: e.why.trim(), since: e.since || today, evidence: e.evidence.trim(),
  };
}

/** The effort a model starts at in a new or changed row: its default, never max; '' = the CLI's default. */
export const startEffort = (m: RegistryModel | undefined): Effort | '' => (m?.defaultEffort && m.defaultEffort !== 'max' ? m.defaultEffort : '');

/** A new row: any kind and area, the first pickable model at its default effort. */
export function blankRow(reg: ModelRegistry | null, today: string): EditRow {
  const m = pickable(reg)[0];
  return { kind: '*', area: '', model: m?.id ?? '', effort: startEffort(m), why: '', evidence: '', since: today };
}
