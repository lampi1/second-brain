// The one-line head of a Memoria hub tab (ADR 0122): what the tab holds in a sentence and its own actions (Nuova skill,
// Aggiorna, Log…). The hub has the one page title and the one «Manutenzione» button, so no tab repeats them. Used by
// SkillsPage.tsx, RulesPage.tsx, LearningPage.tsx, ApprovedTab.tsx and brain/pages/Script.tsx. Styles: memory-hub.css.
import type { ReactNode } from 'react';

export function HubIntro({ lead, actions, testId }: { lead: ReactNode; actions?: ReactNode; testId?: string }) {
  return <div className="mh-intro" data-testid={testId}>
    <p>{lead}</p>
    {actions && <div className="mh-intro-actions">{actions}</div>}
  </div>;
}
