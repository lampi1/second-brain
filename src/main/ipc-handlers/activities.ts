// IPC handlers, «Attività pianificate» (ADR 0373): the seven 'activities:*' channels of src/shared/contract/activities.ts.
// PLACEHOLDER from the contract commit: they answer an empty catalog and «not ready» so that main compiles (Handlers in
// ipc.ts keeps the set complete). The engine part (docs/tasks/scheduled-activities.md) replaces the bodies with calls to
// its service (src/main/activities/) and wires the service in src/main/index.ts; nobody else edits this file.
import { activityTemplates, type ActivitiesState, type ActivityResult } from '../../shared/activities';
import type { HandlersOf } from './context';

const empty = (): ActivitiesState => ({ activities: [], paused: false, gmailConnector: false, templates: activityTemplates() });
const notReady = (): ActivityResult => ({ ok: false, error: 'le attività pianificate non sono ancora pronte' });

export function activitiesHandlers(): HandlersOf<'activities'> {
  return {
    'activities:state': () => empty(),
    'activities:save': () => notReady(),
    'activities:enable': () => notReady(),
    'activities:remove': () => notReady(),
    'activities:pause': () => empty(),
    'activities:run': () => notReady(),
    'activities:history': () => [],
  };
}
