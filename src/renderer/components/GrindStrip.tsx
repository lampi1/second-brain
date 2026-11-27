// The parts of a Grindhouse strip (ADR 0366, issue #491) that ChatTile.tsx puts on its closed row: a Strategist's plan
// as one small dot per step and «n/m» (PlanDots), the engine's own sub-agents as a small count (SubCount), and the ⓘ
// that holds what the row no longer shows (GrindInfo): the model and effort, the estimate from similar jobs, the skills
// it used (no more chips on the row), its project and each sub-agent with what it does. The ⓘ opens under the pointer
// or the keyboard focus (agent-strips.css .gs-info); Enter or Space pins it open, Esc closes it, a click on it never
// opens the chat. The lines are the pure infoLines, the open/shut states the pure infoNext; the views take plain props so test/unit/grind-strip.test.ts
// renders them without the store.
import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { ChatSummary } from '@shared/contract';
import { planCount, type StrategyPlan } from '@shared/strategy';
import { childRows } from '../lib/agent-children';
import { folderName, modelWithEffort } from '../lib/format';
import { estimateText, useRunEstimates } from '../lib/run-estimates';
import { t } from '../i18n';

type InfoChat = Pick<ChatSummary, 'id' | 'model' | 'harness' | 'effortStatus' | 'run' | 'loadedSkills' | 'cwd' | 'agentChildren'>;

/** The engine's own sub-agents still on the job (lib/agent-children.ts childRows), one line each: «↳ kind · type: task». */
export function subLines(children: ChatSummary['agentChildren']): string[] {
  return childRows(children).rows.map(r => {
    const who = r.kind !== 'shell' && r.agentType?.trim() ? ` · ${r.agentType.trim() === 'Explore' ? t('product.childExplore') : r.agentType.trim()}` : '';
    return `↳ ${t(`product.child.${r.kind}`)}${who}: ${r.task || t('product.noTask')}`;
  });
}

/** What the ⓘ says, one line each: the model with its effort (bold), the estimate when there is one, the skills (the
 *  ones it used, else the ones its role loaded on an engine that does not report them), the project, the sub-agents. */
export function infoLines(chat: InfoChat, estimate: { time: string | null; cost: string | null } | null): { model: string; lines: string[] } {
  const lines: string[] = [];
  const est = [estimate?.time, estimate?.cost].filter(Boolean).join(' · ');
  if (est) lines.push(t('grind.est', { est }));
  const used = chat.run?.tags?.skills ?? [];
  if (used.length) lines.push(t('grind.skills', { list: used.join(' · ') }));
  else if (chat.run && chat.harness !== 'claude' && chat.loadedSkills?.length) lines.push(t('grind.skillsLoaded', { list: chat.loadedSkills.join(' · ') }));
  const where = folderName(chat.cwd);
  if (where) lines.push(t('grind.where', { where }));
  lines.push(...subLines(chat.agentChildren));
  return { model: modelWithEffort(chat), lines };
}

/** The ⓘ's state: pinned open (a click, Enter or Space) and shut (Esc: closed while the pointer or focus stays on it). */
export interface InfoState { open: boolean; shut: boolean }
export type InfoEvent = 'click' | 'Enter' | ' ' | 'Escape' | 'blur' | 'leave';
/** The next state of the ⓘ, or null when the event is not the ⓘ's (it then goes on to the strip). */
export function infoNext(s: InfoState, ev: InfoEvent | string): InfoState | null {
  if (ev === 'click' || ev === 'Enter' || ev === ' ') return { open: !s.open, shut: false };
  if (ev === 'Escape') return s.shut && !s.open ? null : { open: false, shut: true };
  if (ev === 'blur') return { open: false, shut: false };
  if (ev === 'leave') return { open: s.open, shut: false };
  return null;
}

/** The ⓘ with its card; a tab stop, so the keyboard opens it too. */
export function GrindInfoView({ id, model, lines }: { id: string; model: string; lines: readonly string[] }) {
  const [st, setSt] = useState<InfoState>({ open: false, shut: false });
  const on = (ev: InfoEvent | string, e?: MouseEvent | KeyboardEvent) => {
    const next = infoNext(st, ev);
    if (!next) return;
    if (e) { e.stopPropagation(); if (ev !== 'click' && ev !== 'Escape') e.preventDefault(); }
    setSt(next);
  };
  return <span className={`gs-info${st.open ? ' is-open' : ''}${st.shut ? ' is-shut' : ''}`} tabIndex={0} role="button" aria-expanded={st.open} aria-label={[t('grind.info'), model, ...lines].join('. ')}
    data-testid={`strip-info-${id}`} onClick={e => on('click', e)} onKeyDown={e => on(e.key, e)} onBlur={() => on('blur')} onMouseLeave={() => on('leave')}>
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

/** The engine's own sub-agents on the job as a small «↳ n» (their details are in the ⓘ); nothing without one. */
export function SubCount({ id, agents }: { id: string; agents: ChatSummary['agentChildren'] }) {
  const n = childRows(agents).rows.length;
  if (!n) return null;
  return <span className="gs-subs" data-testid={`strip-subs-${id}`} aria-label={t('grind.subs', { n })} data-tip={t('grind.subs', { n })}>↳ {n}</span>;
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
