// The labels of the kinds of work (shared/work-concepts.ts TaskKind, the one taxonomy of ADR 0186), read at use time in
// the current language. Used by lib/classifier-view.ts, components/RunEstimate.tsx and brain-model/KindModelCard.tsx.
import type { TaskKind } from '@shared/contract';
import { t } from '../i18n';

export const getKindIt = (): Record<TaskKind, string> => ({
  'qa-run': t('tools.routing.kindQaRun'), review: t('tools.routing.kindReview'), 'bug-fix': t('tools.routing.kindBugFix'), 'ops-read': t('tools.routing.kindOpsRead'), writing: t('tools.routing.kindWriting'),
  triage: t('tools.routing.kindTriage'), 'research-web': t('tools.routing.kindResearchWeb'), investigation: t('tools.routing.kindInvestigation'), 'app-feature': t('tools.routing.kindAppFeature'), orchestrator: t('tools.routing.kindOrchestrator'), altro: t('tools.routing.kindOther'),
});
