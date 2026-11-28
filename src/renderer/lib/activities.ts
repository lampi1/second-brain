// The pure side of the «Attività pianificate» page (ADR 0373): the editor's draft (strings from the form) turned into the
// ActivityInput that validateActivityInput checks, the run's line «letti · tenuti · proposte · costo», the tone of a run's
// status and the list parsing of the filter fields. No React, no clock, no bridge: unit-tested (test/unit/activities-page.test.ts).
// Used by brain/pages/Activities.tsx.
import { defaultActivity, validateActivityInput, type ActivityInput, type ActivityRun, type ActivityRunStatus, type ActivitySource } from '@shared/activities';
import { formatCost } from './format';
import { t } from '../i18n';

/** What the form holds: numbers and lists as the user typed them. */
export interface ActivityDraft {
  name: string;
  source: ActivitySource;
  everyMin: string;
  days: number[];
  useWindow: boolean;
  from: string;
  to: string;
  senders: string;
  subjectWords: string;
  mentionsOnly: boolean;
  unreadOnly: boolean;
  excludeNoReply: boolean;
  propose: string;
  dailyCap: string;
  enabled: boolean;
}

/** «a, b\nc» → ['a', 'b', 'c'] (empty pieces dropped; the validator trims, cuts and removes duplicates). */
export const parseList = (text: string): string[] => text.split(/[,\n;]/).map(s => s.trim()).filter(Boolean);

export function draftFromInput(a: ActivityInput): ActivityDraft {
  return {
    name: a.name, source: a.source, everyMin: String(a.schedule.everyMin), days: [...a.schedule.days],
    useWindow: a.schedule.window !== null, from: a.schedule.window?.from ?? '08:00', to: a.schedule.window?.to ?? '19:00',
    senders: a.filter.senders.join(', '), subjectWords: a.filter.subjectWords.join(', '),
    mentionsOnly: a.filter.mentionsOnly, unreadOnly: a.filter.unreadOnly, excludeNoReply: a.filter.excludeNoReply,
    propose: a.propose, dailyCap: String(a.dailyCap), enabled: a.enabled,
  };
}

export const blankDraft = (source: ActivitySource = 'devops'): ActivityDraft => draftFromInput(defaultActivity(source));

/** The draft as the validator reads it, checked: the same rules as the Orchestrator's tool (a wrong field is an error). */
export function validateDraft(d: ActivityDraft): { ok: true; input: ActivityInput } | { ok: false; errors: string[] } {
  const everyMin = d.everyMin.trim() === '' ? Number.NaN : Number(d.everyMin);
  const dailyCap = d.dailyCap.trim() === '' ? Number.NaN : Number(d.dailyCap);
  const v = validateActivityInput({
    name: d.name, source: d.source, propose: d.propose, dailyCap, enabled: d.enabled,
    schedule: { everyMin, days: d.days, window: d.useWindow ? { from: d.from, to: d.to } : null },
    filter: { senders: parseList(d.senders), subjectWords: parseList(d.subjectWords), mentionsOnly: d.mentionsOnly, unreadOnly: d.unreadOnly, excludeNoReply: d.excludeNoReply },
  });
  return v.ok ? { ok: true, input: v.value } : { ok: false, errors: v.errors };
}

/** «letti 12 · tenuti 3 · proposte 1 · 0,02 $» */
export function runLine(r: Pick<ActivityRun, 'read' | 'kept' | 'proposals' | 'costUsd'>): string {
  return t('activities.runLine', { read: r.read, kept: r.kept, proposals: r.proposals, cost: r.costUsd === null || r.costUsd === 0 ? t('activities.costNone') : formatCost(r.costUsd) });
}

export type RunTone = 'good' | 'warn' | 'bad' | 'neutral' | 'blue';
export const STATUS_TONE: Record<ActivityRunStatus, RunTone> = { idle: 'neutral', quiet: 'neutral', proposed: 'good', capped: 'warn', error: 'bad' };
