// The plans button (ADR 0359; Ctrl+Shift+S): it sits on the top bar and on the Orchestrator's head and opens the plans' page.
// Used by TopBar.tsx and OrchestratorTile.tsx.
import { openPlans } from '../actions';
import { IconTicket } from './Icons';
import { IconButton } from './ui';
import { t } from '../i18n';

export function PlansButton({ testid = 'plans-btn', size = 16 }: { testid?: string; size?: number }) {
  return <IconButton label={t('plans.title')} shortcut="Ctrl+Shift+S" onClick={() => openPlans()} testid={testid}><IconTicket size={size} /></IconButton>;
}
