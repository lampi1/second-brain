// The Italian labels of the routing table's task kinds (brain/routing.ts TaskKind), read at use time in the current
// language. Used by lib/classifier-view.ts.
import type { TaskKind } from '@shared/contract';
import { t } from '../i18n';

export const getKindIt = (): Record<TaskKind | '*', string> => ({
  '*': t('tools.routing.kindAny'), 'qa-run': t('tools.routing.kindQaRun'), review: t('tools.routing.kindReview'), 'bug-fix': t('tools.routing.kindBugFix'), 'ops-read': t('tools.routing.kindOpsRead'), writing: t('tools.routing.kindWriting'),
  triage: t('tools.routing.kindTriage'), 'research-web': t('tools.routing.kindResearchWeb'), investigation: t('tools.routing.kindInvestigation'), 'app-feature': t('tools.routing.kindAppFeature'), orchestrator: t('tools.routing.kindOrchestrator'), altro: t('tools.routing.kindOther'),
});
