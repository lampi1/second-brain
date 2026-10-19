// "Chat di oggi, dalla più cara": every chat of the day with its cost, re-sorted live as the chats stream (zero tokens:
// lib/live-costs.ts). Why: the user wants to see at once which task is spending, not only the top four open chats.
// A row of an open app chat brings it on screen; a closed one or a session outside the app (Claude Code, desktop) is
// only shown (opening a closed chat would put it back on the grid). Used by the usage
// popup (UsageBar.tsx, the first few + "Tutte") and by the brain's Costi page ("Adesso", all of them). No store here:
// the brain's pages never import the app's store, each caller gives the rows (lib/live-costs.ts costRows).
import { formatCost } from '../lib/format';
import type { CostRow } from '../lib/live-costs';
import { HarnessMark } from './Icons';
import { t } from '../i18n';

function Row({ r, onOpen }: { r: CostRow; onOpen?: (chatId: string) => void }) {
  const tag = r.chatId ? (r.running ? t('costs.running') : r.closed ? t('costs.closed') : null) : t('costs.outside');
  const cost = r.unpriced ? (r.usd > 0 ? `≈ ${formatCost(r.usd)} + ?` : t('costs.unavailable')) : `${r.approx ? '≈ ' : ''}${formatCost(r.usd)}`;
  const body = (
    <>
      <HarnessMark harness={r.harness} orchestrator={r.isOrchestrator} size={16} />
      <span className="ub-label ub-chat" title={r.title}>{r.title || t('costs.untitled')}</span>
      {tag ? <span className={`lc-tag ${r.running ? 'run' : ''}`}>{tag}</span> : null}
      {r.unpriced ? <span className="ub-tag" data-tip={t('costs.unpricedHint')}>{t('costs.unpriced')}</span> : null}
      <b>{cost}</b>
    </>
  );
  return r.chatId && !r.closed && onOpen
    ? <li><button type="button" className="ub-row lc-row lc-open" onClick={() => onOpen(r.chatId!)} data-testid={`live-cost-${r.chatId}`}>{body}</button></li>
    : <li className="ub-row lc-row" data-testid={`live-cost-${r.key}`}>{body}</li>;
}

/** limit: show only the first ones (onMore opens the full list); onOpen: a click on an app chat's row. */
export function LiveCostList({ rows, limit, onMore, onOpen, unpricedModels, testid = 'live-costs' }: { rows: CostRow[]; limit?: number; onMore?: () => void; onOpen?: (chatId: string) => void; unpricedModels?: string[]; testid?: string }) {
  if (!rows.length) return <p className="ub-note" data-testid={`${testid}-empty`}>{t('costs.liveEmpty')}</p>;
  const shown = limit ? rows.slice(0, limit) : rows;
  return (
    <>
      <ul className="ub-rows lc-list" data-testid={testid}>{shown.map(r => <Row key={r.key} r={r} onOpen={onOpen} />)}</ul>
      {limit && rows.length > limit && onMore ? <button type="button" className="link-btn lc-more" onClick={onMore} data-testid={`${testid}-more`}>{t('costs.all',{count:rows.length})}</button> : null}
      <details className="ub-note" data-testid={`${testid}-provenance`}><summary>{t('costs.provenance')}</summary><p>{t('costs.provenanceUnknown')}</p></details>
      {unpricedModels?.length ? <p className="ub-note" data-testid={`${testid}-unpriced`}>{t('costs.unpricedModels',{models:unpricedModels.join(', ')})}</p> : null}
      {shown.some(r => r.approx) ? <p className="ub-note">{t('costs.approxNote')}</p> : null}
    </>
  );
}
