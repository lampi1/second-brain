// "Come funziona →": the link from a "?" explanation (or a page lead) to the matching card of the Guida (ADR 0101; C-ux
// audit: the 62 "?" were islands, none led to the Guide). A click opens the Guida page with that card's reading panel
// open (go({ page: 'guida', arg: <concept id> }); GuidePage reads the arg). An unknown concept id renders nothing, so a
// renamed card never leaves a dead link (test/unit/guide-link.test.ts pins every id used in the renderer). Used by
// HelpTip (its `guide` prop) and by page leads (ClassifiersPage, Qualità, Costi…). `actions` is imported on click, not at
// load: HelpTip is in every page and in unit tests that render without the preload bridge (actions → sb → window.sb).
import { CONCEPT_IDS } from '@shared/concept-ids';
import { t } from '../i18n';
import { closeHelpTip } from './HelpTip';

export const isConcept = (id: string): boolean => CONCEPT_IDS.includes(id);

export function GuideLink({ concept, className = '' }: { concept: string; className?: string }) {
  if (!isConcept(concept)) return null;
  return <button type="button" className={`link-btn guide-link ${className}`} data-testid={`guide-link-${concept}`}
    onClick={e => { e.preventDefault(); e.stopPropagation(); closeHelpTip(); void import('../actions').then(a => a.go({ page: 'guida', arg: concept })); }}>
    {t('guide.link')} <span aria-hidden="true">→</span>
  </button>;
}
