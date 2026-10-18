// Accessible catalogue card: authoritative run metrics retain their sample sizes and unknown values.
import { inProbation, type AgentMetrics, type AgentProfile } from '@shared/agents';
import { locale, t } from '../i18n';
import { AgentAvatar } from './AgentAvatar';

export function AgentCatalogCard({ profile, metrics, loaded, engine, lastStart, onOpen }: {
  profile: AgentProfile; metrics?: AgentMetrics; loaded: boolean; engine: string; lastStart: number | null; onOpen: () => void;
}) {
  const stats = metrics?.all;
  const ended = loaded ? stats?.ended ?? 0 : null;
  const unknown = t('catalog.unknown');
  const rate = stats?.successRate, cost = stats?.costPerRun.median;
  const sample = (n: number) => loaded ? t('catalog.samples', { n, total: ended ?? 0 }) : unknown;
  return <article className="catalog-card" data-testid={`catalog-card-${profile.id}`}>
    <div className="catalog-card-top"><AgentAvatar avatar={profile.avatar} name={profile.name} size={48} />
      <span className="catalog-badge" data-probation={inProbation(profile)}>{inProbation(profile) ? t('catalog.probation') : t('catalog.active')}</span></div>
    <h3><button type="button" onClick={onOpen}>{profile.name}</button></h3>
    <p className="catalog-role">{profile.role || profile.purpose}</p>
    <p className="catalog-purpose">{profile.purpose}</p>
    <p className="catalog-engine">{engine} · {profile.model ?? t('studio.defaultEngine')}</p>
    <dl className="catalog-stats">
      <div><dt>{t('catalog.runs')}</dt><dd>{ended?.toLocaleString(locale()) ?? unknown}</dd></div>
      <div><dt>{t('catalog.open')}</dt><dd>{loaded ? metrics?.open ?? 0 : unknown}</dd></div>
      <div><dt>{t('catalog.success')}</dt><dd>{rate?.value != null ? new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 0 }).format(rate.value) : unknown}</dd><small>{sample(rate?.n ?? 0)}</small></div>
      <div><dt>{t('catalog.cost')}</dt><dd>{cost?.value != null ? new Intl.NumberFormat(locale(), { style: 'currency', currency: 'USD', maximumFractionDigits: 3 }).format(cost.value) : unknown}</dd><small>{sample(cost?.n ?? 0)}</small></div>
    </dl>
    <footer><span>{profile.origin.kind === 'preset' ? t('catalog.preset') : t('catalog.custom')} · v{profile.activeVersion}</span><span>{t('catalog.last')}: {lastStart === null ? unknown : new Date(lastStart).toLocaleString(locale())}</span></footer>
  </article>;
}
