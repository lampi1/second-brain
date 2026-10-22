// A Proposte card in plain words (ADR 0126): the question it asks, what each answer does, where it holds, and the text
// it is about, from the card's `ask` data (shared/proposals.ts) in the UI language. Role ids become role names, tiers
// their level names, a project path its folder name; raw keys and ids stay in the card's technical details. Pure.
// Used by components/brain-model/ProposalsDeck.tsx; pinned by test/unit/proposal-ask.test.ts.
import type { Proposal, ProposalKeep } from '@shared/proposals';
import { isRoleId, roleName } from '@shared/roles';
import { locale, t } from '../i18n';
import { proposalTitle } from './proposal-title';

export interface CardWords {
  /** the question, one sentence ending with «?» */
  question: string;
  /** what the approve side and the reject side do */
  yes: string; no: string;
  /** what the card is about, one paragraph (a fact, a change's summary, a rule's title), or '' */
  lead: string;
  /** a label for the card's Markdown content when it is the reason for it */
  bodyLabel?: string;
  /** whether the content is already said by `lead` (a fact's value) */
  hideBody?: boolean;
  /** where it holds (a fact's project, repository, environment) */
  scope?: string;
  /** the app's own advice, one sentence */
  advice?: string;
  /** who keeps a fact (its role's name, or the app) */
  who?: string;
}

const who = (id: string | undefined): string => (id === 'pulse' ? t('alive.pulse.title') : id && isRoleId(id) ? roleName(id) : id || t('proposals.app'));
const level = (tier: string | undefined): string => (tier && (['light', 'mid', 'top'] as const).includes(tier as never) ? t(`proposals.tier.${tier as 'light'}`) : tier ?? '');
const folder = (p: string): string => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
/** A list of names in words: «a, b e c». */
const list = (xs: string[]): string => new Intl.ListFormat(locale(), { type: 'conjunction' }).format(xs);
/** Predicates that say nothing by themselves («setup · note»): the fact is its value alone. */
const EMPTY_PREDICATE = /^(notes?|nota|fact|fatto|info|is|è|ist|value|valore)$/i;

/** A memory fact as one sentence: «Rimborsi parziali si calcolano su …», or its value alone when the predicate is empty. */
export function factSentence(subject: string, predicate: string, value: string): string {
  const v = value.trim();
  if (!predicate.trim() || EMPTY_PREDICATE.test(predicate.trim()) || !subject.trim()) return v;
  return `${subject.trim()} ${predicate.trim()} ${v}`;
}

/** `keep`: on a fact that contradicts what is already remembered, the user's pick (replace it or keep both). */
export function cardWords(c: Pick<Proposal, 'ask' | 'title' | 'content' | 'applied' | 'source' | 'facts'>, keep?: ProposalKeep | null): CardWords {
  const a = c.ask;
  switch (a.kind) {
    case 'remember': {
      const name = who(a.role);
      const where = [a.project ? t('proposals.scope.project', { name: folder(a.project) }) : '', a.repository ? t('proposals.scope.repository', { name: folder(a.repository) }) : '',
        a.environment ? t('proposals.scope.environment', { name: a.environment }) : ''].filter(Boolean);
      const n = a.conflicts?.length ?? 0;
      const yes = !n ? t('proposals.yes.remember', { who: name }) : keep === 'new' ? t('proposals.yes.rememberNew', { who: name, n }) : keep === 'both' ? t('proposals.yes.rememberBoth', { who: name, n }) : t('proposals.conflict.pick');
      return { question: t('proposals.ask.remember', { who: name }), yes, no: n ? t('proposals.no.rememberOld', { who: name, n }) : t('proposals.no.remember', { who: name }), who: name,
        lead: factSentence(a.subject, a.predicate, c.content), hideBody: true, scope: where.length ? t('proposals.scope.list', { list: list(where) }) : t('proposals.scope.all') };
    }
    case 'skill':
      return { question: t('proposals.ask.skill', { name: a.name }), yes: t('proposals.yes.skill'), no: t('proposals.no.skill'), lead: '' };
    case 'applied':
      return { question: t('proposals.ask.applied', { what: a.what, action: a.action, name: a.name, ...(a.role ? { role: who(a.role) } : {}) }),
        yes: t('proposals.yes.applied'), no: t('proposals.no.applied'), lead: c.title, bodyLabel: t('proposals.why') };
    case 'setting':
      return { question: t('proposals.ask.setting', { label: proposalTitle(c), before: a.before, after: a.after }), yes: t('proposals.yes.setting', { after: a.after }),
        no: t('proposals.no.setting', { before: a.before }), lead: '', bodyLabel: t('proposals.why') };
    case 'trial': {
      const name = who(a.role);
      return { question: t('proposals.ask.trial', { role: name }), yes: t('proposals.yes.trial', { role: name, v: a.version }), no: t('proposals.no.trial', { role: name, v: a.baseline }),
        lead: '', bodyLabel: t('proposals.why'), ...(a.advice === 'keep' || a.advice === 'revert' ? { advice: t(`proposals.advice.${a.advice}`) } : {}) };
    }
    case 'tier': {
      const roles = list(a.roles.map(who)), skills = list(a.skills.map(s => `«${s}»`)), tier = level(a.tier);
      const yes = [tier ? t('proposals.yes.tier', { roles, tier }) : '', a.skills.length ? t('proposals.yes.tierSkills', { roles, skills }) : ''].filter(Boolean).join(' ');
      return { question: tier ? t('proposals.ask.tier', { roles, tier }) : t('proposals.ask.tierSkills', { roles, skills }), yes, no: t('proposals.no.tier'), lead: '', bodyLabel: t('proposals.why') };
    }
    case 'rule': {
      const name = who(a.role);
      return { question: t('proposals.ask.rule', { role: name }), yes: t('proposals.yes.rule', { role: name }), no: t('proposals.no.rule'), lead: c.title };
    }
    case 'policy':
      return { question: a.domain === 'routing' || a.domain === 'notifications' ? t(`proposals.ask.policy.${a.domain}`) : t('proposals.ask.policy.other', { domain: a.domain }),
        yes: a.cases ? t('proposals.yes.policyCases', { name: a.name, n: a.cases }) : t('proposals.yes.policy', { name: a.name }), no: t('proposals.no.policy'), lead: '' };
  }
}
