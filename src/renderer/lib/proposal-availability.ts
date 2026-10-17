// Unknown capability is fail-closed; an explicit null block from main means the action has no prerequisite block.
import type {ProposalAvailability} from '@shared/improve-proposals';
export function proposalBlocks(availability:ProposalAvailability|null){
  return {createBlocked:availability?.available?null:availability?.reason||'Verifica della disponibilità in corso',publishBlocked:availability?availability.publishBlocked:'Verifica della pubblicazione non ancora disponibile'};
}
