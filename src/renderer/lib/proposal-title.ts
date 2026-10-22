// A Proposte card's title in the UI language (ADR 0123): a setting request names its setting from the dictionaries when
// they hold it (main's schema labels, brain/settings-schema.ts, are Italian); every other card keeps main's title. Pure.
// Used by lib/proposal-ask.ts (a setting card's question); pinned by test/unit/visible-language.test.ts.
import type { Proposal } from '@shared/proposals';
import { t, type Key } from '../i18n';
/** The settings an agent may ask for whose name the UI's dictionaries already hold: main's schema labels
 *  (brain/settings-schema.ts) are Italian, so a «setting» card of these keys shows the name in the UI language. */
const SETTING_LABEL: Readonly<Record<string, Key>> = { 'pulse.dailyUsd': 'alive.pulse.budget', suggestDailyUsd: 'suggest.budget' };

/** A card's title in the UI language: a setting request names its setting from the dictionary when it can. */
export function proposalTitle(c: Pick<Proposal, 'source' | 'title' | 'facts'>): string {
  const key = c.source === 'setting' ? c.facts.find(f => f.key === 'target')?.value : undefined;
  const label = key ? SETTING_LABEL[key] : undefined;
  return label ? t(label) : c.title;
}
