// The line that replaced the old decision buttons on other pages (ADR 0123): the decision on a proposal is taken only in
// Memoria → Proposte; here the count and a button that opens the deck. Used by MemoryReview, LearningReview,
// AgentCatalogPage, AgentPackDetails and the learned rules of the Regole page.
import { go } from '../../actions';
import { t } from '../../i18n';
import { useProposalCount } from '../../lib/proposals';
import '../../styles/proposals.css';

export function ProposalsPointer({ compact = false }: { compact?: boolean }) {
  const n = useProposalCount();
  return <p className={`pd-pointer${compact ? ' pd-pointer-compact' : ''}`} data-testid="proposals-pointer">
    <span>{n > 0 ? t('proposals.pointer', { n }) : t('proposals.pointerNone')}</span>
    <button type="button" className="btn btn-ghost btn-s" data-testid="proposals-pointer-open" onClick={() => go({ page: 'memoria', arg: 'proposte' })}>{t('proposals.pointerOpen')}</button>
  </p>;
}
