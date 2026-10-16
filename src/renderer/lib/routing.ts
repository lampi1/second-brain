// Pure helpers of the «Instradamento modelli» editor (components/RoutingGroup.tsx): Italian labels of the task kinds,
// the models the table may pick (the registry's 'auto' rows), the efforts a model offers (max never: only on request),
// the editor's text rows to and from the table's rows, and "Nuova chat"'s line on the model the table picks (routeLine,
// components/NewChatDialog.tsx). Unit-tested in test/unit/brain/routing.test.ts.
import type { Effort, Harness, ModelRegistry, RegistryModel, RoutePreview, RoutingRow, TaskKind } from '@shared/contract';
import { effortLabel, prettyModel } from './format';
import { t } from '../i18n';

/** does an engine take an effort? (lib/engines.ts engineCan(h, 'effort'); passed in so these helpers stay pure) */
export type TakesEffort = (h: Harness) => boolean;

export const getKindIt = (): Record<TaskKind | '*', string> => ({
  '*': t('tools.routing.kindAny'), 'qa-run': t('tools.routing.kindQaRun'), review: t('tools.routing.kindReview'), 'bug-fix': t('tools.routing.kindBugFix'), 'ops-read': t('tools.routing.kindOpsRead'), writing: t('tools.routing.kindWriting'),
  triage: t('tools.routing.kindTriage'), 'research-web': t('tools.routing.kindResearchWeb'), investigation: t('tools.routing.kindInvestigation'), 'app-feature': t('tools.routing.kindAppFeature'), regia: t('tools.routing.kindRegia'), altro: t('tools.routing.kindOther'),
});

/** What the table may pick: the 'auto' models of 'auto' harnesses, never Fable (main refuses it: too costly); a model a
 *  row already names stays listed. */
export function pickable(reg: ModelRegistry | null, keep: string[] = []): RegistryModel[] {
  if (!reg) return [];
  return reg.models.filter(m => (m.routing === 'auto' && reg.harnesses[m.harness]?.routing === 'auto' && !/fable/i.test(m.id)) || keep.includes(m.id));
}

/** A model's efforts the table may set: max only on request (never from the table); none off Claude (the app passes an
 *  effort only to Claude: a Cursor row runs at the model's own). */
export const tableEfforts = (m: RegistryModel | undefined, takes: TakesEffort): Effort[] => (m && takes(m.harness) ? m.efforts ?? [] : []).filter(e => e !== 'max');

/** One editable row: area as text ("App, Pers · App"; empty = any area); `ai` = «L'AI può cambiarla» (the row's `locked`
 *  off); `onApi` = «Sui crediti API» (writing rows only, ADR 0052). */
export interface EditRow { kind: TaskKind | '*'; area: string; model: string; effort: Effort | ''; why: string; evidence: string; since: string; ai: boolean; onApi: boolean }

/** May this row run on the user's API credits: a writing row on an Anthropic model (the API engine is text only). */
export const apiCapable = (e: Pick<EditRow, 'kind'>, m: RegistryModel | undefined): boolean => e.kind === 'writing' && m?.provider === 'anthropic';

export const toEdit = (r: RoutingRow): EditRow => ({
  kind: r.kind, area: Array.isArray(r.area) ? r.area.join(', ') : r.area ?? '', model: r.model, effort: r.effort ?? '',
  why: r.why, evidence: r.evidence, since: r.since, ai: r.locked !== true, onApi: r.onApi === true,
});

/** Back to the table's shape; the harness is the model's own (a model runs on one harness only). */
export function fromEdit(e: EditRow, reg: ModelRegistry | null, today: string): RoutingRow {
  const areas = e.area.split(',').map(a => a.trim()).filter(Boolean);
  const m = reg?.models.find(x => x.id === e.model);
  return {
    kind: e.kind, ...(areas.length ? { area: areas.length === 1 ? areas[0]! : areas } : {}),
    harness: m?.harness ?? 'claude', model: e.model, effort: e.effort || null,
    why: e.why.trim(), since: e.since || today, evidence: e.evidence.trim(),
    ...(e.onApi && apiCapable(e, m) ? { onApi: true } : {}), ...(e.ai ? {} : { locked: true }),
  };
}

/** The effort a model starts at in a new or changed row: its default, never max; '' = the CLI's default. */
export const startEffort = (m: RegistryModel | undefined, takes: TakesEffort): Effort | '' => (m?.defaultEffort && tableEfforts(m, takes).includes(m.defaultEffort) ? m.defaultEffort : '');

/** A new row: any kind and area, the first pickable model at its default effort. */
export function blankRow(reg: ModelRegistry | null, today: string, takes: TakesEffort): EditRow {
  const m = pickable(reg)[0];
  return { kind: '*', area: '', model: m?.id ?? '', effort: startEffort(m, takes), why: '', evidence: '', since: today, ai: true, onApi: false };
}

/** "Nuova chat"'s one line: which model starts and why (the table's row, the user's pick, the defaults), from
 *  routing:preview. `what` = engine, model and effort; `why` = where it comes from. */
export function routeLine(p: RoutePreview | null, engine: (h: Harness) => string): { what: string; why: string; error: boolean } | null {
  if (!p) return null;
  if ('error' in p) return { what: t('tools.routing.errorNoStart'), why: p.error, error: true };
  const KIND_IT = getKindIt();
  const what = `${engine(p.harness)} · ${prettyModel(p.model, p.harness)}${p.effort ? ` · ${t('tools.routing.reasoning')} ${effortLabel(p.effort)}` : ''}`;
  const r = p.route, on = `${KIND_IT[r.kind]}${r.area && r.area !== 'altro' ? ` · ${r.area}` : ''}`;
  const why = r.source === 'override' ? t('tools.routing.overrideSource')
    : r.source === 'table' ? `${t('tools.routing.tableSource')} (${on})${r.reason ? `: ${r.reason}` : ''}`
      : r.source === 'explore' ? `${t('tools.routing.exploreSource')} (${on})`
        : `${t('tools.routing.defaultSource')} ${on}: ${t('tools.routing.defaultSourceEnd')}`;
  return { what, why, error: false };
}
