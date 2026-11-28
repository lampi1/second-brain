// IPC handlers, «Attività pianificate» (ADR 0374): the seven 'activities:*' channels of src/shared/contract/activities.ts.
// With the engine's service (src/main/activities/service.ts) they call it; without one (the integrator has not wired it
// yet) they keep the contract commit's placeholder answers (an empty catalog, «not ready») so that main compiles and the
// page shows its empty state. Wiring: src/main/index.ts passes the service to activitiesHandlers(service).
import { activityTemplates, type ActivitiesState, type ActivityResult } from '../../shared/activities';
import type { ActivitiesApi } from '../activities/service';
import type { HandlersOf } from './context';

const empty = (): ActivitiesState => ({ activities: [], paused: false, gmailConnector: false, templates: activityTemplates() });
const notReady = (): ActivityResult => ({ ok: false, error: 'le attività pianificate non sono ancora pronte' });

export function activitiesHandlers(service?: ActivitiesApi): HandlersOf<'activities'> {
  if (!service) {
    return {
      'activities:state': () => empty(), 'activities:save': () => notReady(), 'activities:enable': () => notReady(), 'activities:remove': () => notReady(),
      'activities:pause': () => empty(), 'activities:run': () => notReady(), 'activities:history': () => [],
    };
  }
  return {
    'activities:state': () => service.state(),
    'activities:save': a => service.save(a),
    'activities:enable': a => service.enable(a),
    'activities:remove': a => service.remove(a),
    'activities:pause': a => service.pause(a),
    'activities:run': a => service.run(a),
    'activities:history': a => service.history(a.id),
  };
}
