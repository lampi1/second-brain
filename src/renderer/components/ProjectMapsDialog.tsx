// The project maps in a window (ADR 0275), in «Stato»'s place: the Orchestrator's head button, the top bar, Ctrl+Shift+S
// and app_project_map open (ui:command 'maps'). The same drawing as Mappa → Progetti (project-map/ProjectMapView.tsx):
// a system opens on click, the breadcrumbs go back up, the agents column and the history come with it. The place inside
// (<project>/<system>) lives in ui.mapsArg, so the window reopens where the user left it. Used by App.tsx (modal 'maps').
import { go } from '../actions';
import { t } from '../i18n';
import { closeModal, setMapsArg, ui } from '../store/ui';
import { ProjectMapView } from './project-map/ProjectMapView';
import { IconExternal, IconMap } from './Icons';
import { Modal } from './ui';
import '../styles/stato.css';
import '../styles/maps.css';

export function ProjectMapsDialog() {
  const arg = ui.use(s => s.mapsArg);
  const fullPage = () => { closeModal(); go({ page: 'collegamenti', arg: arg ? `progetti/${arg}` : 'progetti' }); };
  return <Modal onClose={closeModal} label={t('pm.mapsTitle')} testid="maps" className="modal-stato modal-maps" bodyClassName="maps-body" closeButton
    icon={<IconMap size={18} />} title={t('pm.mapsTitle')} subtitle={t('pm.mapsSub')}
    footer={<button type="button" className="btn btn-ghost btn-s" onClick={fullPage} data-testid="maps-full"><IconExternal size={13} />{t('pm.fullPage')}</button>}>
    <ProjectMapView arg={arg} onArg={setMapsArg} fitAll />
  </Modal>;
}
