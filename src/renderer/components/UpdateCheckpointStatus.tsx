// Status only: the prepared-update card owns the single confirmation before this protected phase.
import {updateBarrier} from '../lib/update-barrier';
import {Modal} from './ui';
export function UpdateCheckpointStatus(){
  const pending=updateBarrier.use(value=>value.requestId);
  if(!pending)return null;
  return <Modal label="Salvataggio per l’aggiornamento" testid="update-checkpoint-status" onClose={()=>{}}><div className="modal-body"><h2>Salvataggio del tuo spazio di lavoro</h2><p role="status">Attendi l’esito dell’aggiornamento. Le modifiche e gli invii restano sospesi durante questa fase.</p></div></Modal>;
}
