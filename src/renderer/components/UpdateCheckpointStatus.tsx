// Status only: the prepared-update card owns the single confirmation before this protected phase.
import { t as auditText } from '../i18n';
import {updateBarrier} from '../lib/update-barrier';
import {Modal} from './ui';
export function UpdateCheckpointStatus(){
  const pending=updateBarrier.use(value=>value.requestId);
  if(!pending)return null;
  return <Modal label={auditText('audit.UpdateCheckpointStatus.savingForTheUpdate')} testid="update-checkpoint-status" onClose={()=>{}}><div className="modal-body"><h2>{auditText('audit.UpdateCheckpointStatus.savingYourWorkspace')}</h2><p role="status">{auditText('audit.UpdateCheckpointStatus.waitForTheUpdateResultEditing')}</p></div></Modal>;
}
