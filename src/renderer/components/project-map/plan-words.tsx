// A plan's steps in words, the same on a work map's boxes and on a project map (ADR 0326, 0343): when a step starts, how
// far it is, who does it («Artisan · Sonnet 5.5 · Base»), what a parallel group is doing, and a step's turn on a box of the
// drawing («2», «2∥»). Used by work-map/WorkDrawing.tsx and WorkSide.tsx, ProjectMapView.tsx and MapDetail.tsx; pinned by
// test/unit/plan-words.test.ts and plan-who-group.test.ts.
import type { PresetId } from '@shared/model-presets';
import type { WorkRoleId } from '@shared/roles';
import type { StepState } from '@shared/strategy';
import { t } from '../../i18n';
import { ago, prettyModel } from '../../lib/format';

/** What the words need of a step (a work map's WorkBox has it all). */
export interface StepWords { n: number; wave: number; state: StepState; role?: WorkRoleId; model?: string | null; preset?: PresetId; chatIds?: readonly string[]; startedAt?: number; endedAt?: number }

/** A step's turn in its plan: «2», or «2∥» when it goes together with another step. */
export function Turn({ wave, par }: { wave: number; par?: boolean | undefined }) {
  return <small className="pm-turn-n" data-par={par ? '' : undefined} title={par ? t('pm.turnPar', { n: wave }) : t('pm.turn', { n: wave })}>{wave}{par ? '∥' : ''}</small>;
}

const list = (steps: readonly StepWords[]) => steps.map(s => s.n).join(', ');
/** When a step starts, in words: first, after which steps, together with which. */
export function whenOf(f: StepWords, flow: readonly StepWords[]): string {
  const mates = flow.filter(x => x.wave === f.wave && x.n !== f.n), before = flow.filter(x => x.wave === f.wave - 1);
  const start = before.length ? t(before.length === 1 ? 'pm.step.after' : 'pm.step.afterMany', { steps: list(before) }) : t('pm.step.first');
  return mates.length ? `${start} ${t(mates.length === 1 ? 'pm.step.with' : 'pm.step.withMany', { steps: list(mates) })}` : start;
}
const minutes = (ms: number) => `${Math.max(1, Math.round(ms / 60_000))} min`;
/** How far a step is, in words. */
export function stateOf(f: StepWords, now: number): string {
  if (f.state === 'now') { const a = f.startedAt ? ago(f.startedAt, now) : ''; return a && a !== t('appText.format.now') ? t('pm.step.nowSince', { at: a }) : t('pm.step.now'); }
  if (f.state === 'done') return f.startedAt && f.endedAt && f.endedAt > f.startedAt ? t('pm.step.doneIn', { time: minutes(f.endedAt - f.startedAt) }) : t('pm.step.done');
  return t(f.state === 'blocked' ? 'pm.step.blocked' : 'pm.step.todo');
}

/** Who does a step, on one line: «Artisan · Sonnet 5.5 · Base»; a step not started adds «previsto» (the role card's own
 *  model for the planned preset). null for a step the Strategist does itself. */
export function whoOf(f: StepWords): { text: string; planned: boolean } | null {
  if (!f.role) return null;
  const parts = [f.role[0]!.toUpperCase() + f.role.slice(1), ...(f.model ? [prettyModel(f.model)] : []), ...(f.preset ? [t(`delegation.preset.${f.preset}`)] : [])];
  return { text: parts.join(' · '), planned: f.state === 'todo' && !f.chatIds?.length && !!(f.model || f.preset) };
}

/** A parallel group is the steps of one turn when there are two or more: either together or one after the other,
 *  never «possible» (owner, 2026-11-23). Its label counts them live: «5 in parallelo · 3 al lavoro, 2 fatti». */
export function groupLabel(flow: readonly StepWords[], wave: number): string | null {
  const g = flow.filter(f => f.wave === wave);
  if (g.length < 2) return null;
  const n = (s: StepState) => g.filter(f => f.state === s).length;
  const live = [[n('now'), 'pm.grp.working'], [n('done'), 'pm.grp.done'], [n('blocked'), 'pm.grp.blocked'], [n('todo'), 'pm.grp.idle']] as const;
  const parts = live.filter(([k]) => k > 0).map(([k, key]) => t(key, { n: k }));
  return `${t('pm.grp.head', { n: g.length })}${parts.length ? ` · ${parts.join(', ')}` : ''}`;
}
