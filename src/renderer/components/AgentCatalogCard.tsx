// Agent card of the Agenti catalogue (AgentCatalogPage): identity (glyph, name, role), engine and model, a live status
// and four compact run metrics, with the launch composer (CatalogRun) and an expandable details panel instead of a
// tall strip. Authoritative run metrics keep their sample sizes and unknown values: a missing value is shown as a dash
// with "Non disponibile" for screen readers and in its tooltip, never as zero. Styles: styles/agent-catalog.css.
import { useId, useState, type CSSProperties, type ReactNode } from 'react';
import { inProbation, type AgentMetrics, type AgentProfile } from '@shared/agents';
import { locale, t } from '../i18n';
import { AgentAvatar } from './AgentAvatar';

type Value = { text: string | null; samples?: string };

function Metric({ label, full, value, unknown }: { label: string; full: string; value: Value; unknown: string }) {
  const tip = [full, value.text ?? unknown, value.samples].filter(Boolean).join(' · ');
  return <div title={tip}>
    <dt>{label}</dt>
    <dd>{value.text ?? <><span aria-hidden="true">—</span><span className="sr-only">{unknown}</span></>}</dd>
  </div>;
}

export function AgentCatalogCard({ profile, metrics, loaded, engine, lastStart, onOpen, updateAvailable, index = 0, run }: {
  profile: AgentProfile; metrics?: AgentMetrics; loaded: boolean; engine: string; lastStart: number | null; onOpen: () => void; updateAvailable?: boolean;
  index?: number; run?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const stats = metrics?.all;
  const ended = loaded ? stats?.ended ?? 0 : null;
  const open = loaded ? metrics?.open ?? 0 : null;
  const unknown = t('catalog.unknown');
  const rate = stats?.successRate, cost = stats?.costPerRun.median;
  const sample = (n: number) => loaded ? t('catalog.samples', { n, total: ended ?? 0 }) : unknown;
  const values: Record<'runs' | 'open' | 'success' | 'cost', Value> = {
    runs: { text: ended?.toLocaleString(locale()) ?? null },
    open: { text: open?.toLocaleString(locale()) ?? null },
    success: { text: rate?.value != null ? new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 0 }).format(rate.value) : null, samples: sample(rate?.n ?? 0) },
    cost: { text: cost?.value != null ? new Intl.NumberFormat(locale(), { style: 'currency', currency: 'USD', maximumFractionDigits: 3 }).format(cost.value) : null, samples: sample(cost?.n ?? 0) },
  };
  const probation = inProbation(profile);
  const working = !probation && (open ?? 0) > 0;
  const state = probation ? 'probation' : working ? 'working' : 'active';
  const tone = profile.avatar?.kind === 'symbol' ? profile.avatar.tone ?? 'blue' : 'blue';
  const origin = profile.origin.kind === 'preset' ? t('catalog.preset') : t('catalog.custom');
  const role = profile.role || origin;
  const last = lastStart === null ? unknown : new Date(lastStart).toLocaleString(locale());
  return <article className="catalog-card" data-testid={`catalog-card-${profile.id}`} data-state={state} data-tone={tone}
    style={{ '--row-index': Math.min(index, 8) } as CSSProperties}>
    <header className="catalog-card-head">
      <span className="catalog-avatar"><AgentAvatar avatar={profile.avatar} name={profile.name} size={40} /></span>
      <div className="catalog-card-id">
        <h3><button type="button" onClick={onOpen}>{profile.name}</button></h3>
        <p className="catalog-role" title={role}>{role}</p>
      </div>
      <span className="catalog-badge" data-probation={probation} data-state={state}>
        <i aria-hidden="true" />{probation ? t('catalog.probation') : working ? t('agentsGrid.working') : t('catalog.active')}</span>
    </header>
    <p className="catalog-purpose" title={profile.purpose || undefined}>{profile.purpose}</p>
    <div className="catalog-chips">
      <span className="catalog-chip" data-kind="engine">{engine}</span>
      <span className="catalog-chip" data-kind="model" title={profile.model ?? t('studio.defaultEngine')}>{profile.model ?? t('studio.defaultEngine')}</span>
      {updateAvailable && <button type="button" className="catalog-chip catalog-update" onClick={onOpen}>{t('catalog.presetUpdate')}</button>}
    </div>
    <dl className="catalog-stats">
      <Metric label={t('agentsGrid.runs')} full={t('catalog.runs')} value={values.runs} unknown={unknown} />
      <Metric label={t('agentsGrid.open')} full={t('catalog.open')} value={values.open} unknown={unknown} />
      <Metric label={t('agentsGrid.success')} full={t('catalog.success')} value={values.success} unknown={unknown} />
      <Metric label={t('agentsGrid.cost')} full={t('catalog.cost')} value={values.cost} unknown={unknown} />
    </dl>
    <footer className="catalog-card-foot">
      {run}
      <button type="button" className="btn btn-ghost btn-s catalog-more" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded(v => !v)}>
        {t('agentsGrid.details')}<span aria-hidden="true" className="catalog-more-chevron">▾</span></button>
    </footer>
    <div className="catalog-details" id={detailsId} hidden={!expanded}>
      {profile.purpose && <p>{profile.purpose}</p>}
      <dl>
        <div><dt>{t('catalog.runs')}</dt><dd>{values.runs.text ?? unknown}</dd></div>
        <div><dt>{t('catalog.open')}</dt><dd>{values.open.text ?? unknown}</dd></div>
        <div><dt>{t('catalog.success')}</dt><dd>{values.success.text ?? unknown} <small>{values.success.samples}</small></dd></div>
        <div><dt>{t('catalog.cost')}</dt><dd>{values.cost.text ?? unknown} <small>{values.cost.samples}</small></dd></div>
        <div><dt>{t('catalog.engine')}</dt><dd>{engine} · {profile.model ?? t('studio.defaultEngine')}</dd></div>
        <div><dt>{t('agentsGrid.origin')}</dt><dd>{origin} · v{profile.activeVersion}</dd></div>
        <div><dt>{t('catalog.last')}</dt><dd>{last}</dd></div>
      </dl>
      <button type="button" className="btn btn-ghost btn-s" onClick={onOpen}>{t('agentsGrid.openProfile')}</button>
    </div>
  </article>;
}
