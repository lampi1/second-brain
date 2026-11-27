// The parts of a Grindhouse strip (ADR 0366, issue #491) that ChatTile.tsx puts on its closed row: a Strategist's plan
// as one small dot per step and «n/m» (PlanDots), and the ⓘ that holds what the row no longer shows (GrindInfo): the
// model and effort, the estimate from similar jobs, the skills it used (no more chips on the row) and its project.
// The ⓘ opens under the pointer or the keyboard focus, as plain CSS (agent-strips.css .gs-info). The lines are the pure
// infoLines; the views take plain props so test/unit/grind-strip.test.ts renders them without the store.
import type { ChatSummary } from '@shared/contract';
import { planCount, type StrategyPlan } from '@shared/strategy';
import { folderName, modelWithEffort } from '../lib/format';
import { estimateText, useRunEstimates } from '../lib/run-estimates';
import { t } from '../i18n';

type InfoChat = Pick<ChatSummary, 'id' | 'model' | 'harness' | 'effortStatus' | 'run' | 'loadedSkills' | 'cwd'>;

/** What the ⓘ says, one line each: the model with its effort (bold), the estimate when there is one, the skills (the
 *  ones it used, else the ones its role loaded on an engine that does not report them), the project. */
export function infoLines(chat: InfoChat, estimate: { time: string | null; cost: string | null } | null): { model: string; lines: string[] } {
  const lines: string[] = [];
  const est = [estimate?.time, estimate?.cost].filter(Boolean).join(' · ');
  if (est) lines.push(t('grind.est', { est }));
  const used = chat.run?.tags?.skills ?? [];
  if (used.length) lines.push(t('grind.skills', { list: used.join(' · ') }));
  else if (chat.run && chat.harness !== 'claude' && chat.loadedSkills?.length) lines.push(t('grind.skillsLoaded', { list: chat.loadedSkills.join(' · ') }));
  const where = folderName(chat.cwd);
  if (where) lines.push(t('grind.where', { where }));
  return { model: modelWithEffort(chat), lines };
}

/** The ⓘ with its card; a tab stop, so the keyboard opens it too. */
export function GrindInfoView({ id, model, lines }: { id: string; model: string; lines: readonly string[] }) {
  return <span className="gs-info" tabIndex={0} role="button" aria-label={[t('grind.info'), model, ...lines].join('. ')} data-testid={`strip-info-${id}`}>
    <span aria-hidden="true">ⓘ</span>
    <span className="gs-tip" role="tooltip"><b data-testid={`strip-model-${id}`}>{model}</b>{lines.map(l => <span key={l}>{l}</span>)}</span>
  </span>;
}

export function GrindInfo({ chat }: { chat: ChatSummary }) {
  const estimates = useRunEstimates();
  const e = chat.run ? estimates?.runs[chat.run.runId]?.estimate ?? null : null;
  const { model, lines } = infoLines(chat, e ? estimateText(e) : null);
  return <GrindInfoView id={chat.id} model={model} lines={lines} />;
}

/** A plan with steps: one dot per step (done green, the one under way accent, a blocked one amber, the rest empty) and
 *  «done/total». Nothing while it still asks or has no step. */
export function PlanDots({ id, plan }: { id: string; plan: StrategyPlan | undefined }) {
  if (!plan || !plan.steps.length || plan.phase === 'asking' || plan.phase === 'revising') return null;
  const { done, total } = planCount(plan);
  return <span className="gs-plan" data-testid={`plan-${id}`} data-phase={plan.phase} role="img" aria-label={t('tree.plan.progress', { done, total })}>
    <span className="gs-steps" aria-hidden="true">{plan.steps.map((s, i) => <i key={i} className={`is-${s.state}`} />)}</span>
    <small data-testid={`plan-percent-${id}`}>{done}/{total}</small>
  </span>;
}
