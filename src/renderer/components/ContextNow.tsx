// «Contesto adesso» on Costi (once the Dashboard's «Token e contesto» tab, ADR 0122): every open chat's context against
// its window, fullest first, the ones above the warning threshold (Settings) marked. Live from the app's chat list.
// Loaded lazily by brain/pages/Costi.tsx. Styles: styles/memory-hub.css (mh-ctx-*).
import { isLongChat } from '@shared/context';
import { t } from '../i18n';
import { useApp } from '../store/store';
import { fmt } from '../brain/lib/format';
import { Section } from '../brain/components/ui';
import { chatName, contextLevel, contextRatio } from '../dashboard/data';
import '../styles/memory-hub.css';

export default function ContextNow() {
  const chats = useApp(s => s.chats);
  const warn = useApp(s => s.settings?.contextWarnTokens ?? 200_000);
  const live = Object.values(chats).filter(c => !c.closedAt && c.state !== 'closed');
  if (!live.length) return null;
  const rows = [...live].sort((a, b) => (contextRatio(b) ?? -1) - (contextRatio(a) ?? -1));
  const long = live.filter(c => isLongChat(c, warn)).length;
  return (
    <Section title={t('mh.ctx.title')} count={live.length} note={long ? t('mh.ctx.noteLong', { n: long }) : t('mh.ctx.note')} testId="bx-cost-context">
      <div className="bx-card tight mh-ctx">{rows.map(c => {
        const ratio = contextRatio(c), high = contextLevel(c, warn) === 'above';
        const value = c.contextTokens === undefined ? t('brainText.dash.notReported') : `${c.contextEstimated ? '≈ ' : ''}${fmt.int(c.contextTokens)}${c.contextMaxTokens ? ` / ${fmt.int(c.contextMaxTokens)}` : ''}`;
        return <div className={`mh-ctx-row${high ? ' warn' : ''}`} key={c.id} data-testid="bx-ctx-row">
          <div className="mh-ctx-name"><b>{chatName(c)}</b><small>{c.harness} · {c.model ?? '—'}{high ? ` · ${t('brainText.dash.overThreshold')}` : ''}</small></div>
          <div className="mh-ctx-track" role="meter" aria-label={`${chatName(c)}: ${t('brainText.dash.context')}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={ratio === null ? undefined : Math.min(100, Math.round(ratio * 100))}><i style={{ width: `${ratio === null ? 0 : Math.min(100, ratio * 100)}%` }} /></div>
          <strong>{value}</strong>
        </div>;
      })}</div>
    </Section>
  );
}

