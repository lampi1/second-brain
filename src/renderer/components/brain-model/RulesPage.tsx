// "Sempre caricato" (#366, ADR 0243; once «Regole», ADR 0077, a tab of Memoria since ADR 0122): the fixed core every chat
// receives at its start, as cards: the brain's fixed files (brain.json fixedFiles: me.md, AGENTS.md, the style) with the
// characters against the brain's budget, plus the app's own fixed rules when the brain uses them. Every other rule file
// is no longer loaded (topic injection is gone: the topic files are skills now) and is listed below as «Non più
// caricate», each opening in the viewer. The maintenance panel lists the role-text changes with "Annulla". Rendered by
// MemoryPage.tsx for the «Sempre caricato» tab ('regole' and old 'miglioramento' links land there).
import type { CSSProperties } from 'react';
import type { BrainRule } from '@shared/brain-model';
import { goTarget } from '../../actions';
import { t } from '../../i18n';
import { useBrainModel } from '../../store/brain-model';
import { MaintenancePanel, when } from './MaintenancePanel';
import { HubIntro } from './HubIntro';
import '../../styles/agent-catalog.css';
import '../../styles/brain-model.css';

const TONE = { always: 'green', topic: 'muted', none: 'muted' } as const;

function RuleCard({ rule, index }: { rule: BrainRule; index: number }) {
  const loaded = rule.loaded === 'always' ? 'always' : 'none';
  return <article className="catalog-card" data-kind="rule" data-loaded={loaded} data-testid={`bm-rule-${rule.file}`} style={{ '--row-index': Math.min(index, 8) } as CSSProperties}>
    <header className="bm-card-head">
      <div><h3>{rule.title}</h3><p className="bm-card-sub" title={rule.file}>{rule.file}</p></div>
      <span className="bm-badges"><span className="bm-badge" data-tone={TONE[loaded]} title={t(`bm.rules.loadedHint.${loaded}`)} data-testid="bm-rule-loaded">{t(`bm.rules.loaded.${loaded}`)}</span></span>
    </header>
    {rule.summary && <p className="bm-desc">{rule.summary}</p>}
    <footer className="bm-card-foot">
      <span>{t('bm.lines', { n: rule.lines })}{rule.changedAt ? ` · ${t('bm.changed', { at: when(rule.changedAt) })}` : ''}</span>
      <span className="sp" />
      <button type="button" className="btn btn-ghost btn-s" onClick={() => goTarget(`file/${rule.file}`)}>{t('bm.open')}</button>
    </footer>
  </article>;
}

export function RulesPage() {
  const { state, error } = useBrainModel();
  const rules = [...(state?.rules ?? [])].sort((a, b) => a.file.localeCompare(b.file));
  const always = rules.filter(r => r.loaded === 'always'), old = rules.filter(r => r.loaded !== 'always');
  const core = state?.core;
  const lead = !state ? t('bm.loading') : core ? t('bm.rules.lead', { n: always.length, chars: core.chars, budget: core.budget, app: core.appRules }) : t('bm.rules.lead0');
  return <div className="bm-page agent-overview" data-testid="bm-rules-page">
    <HubIntro lead={lead} />
    {error && <p role="alert">{error}</p>}
    {state && !state.root ? <p className="bm-empty">{t('bm.noBrain')}</p>
      : state && !always.length ? <p className="bm-empty" data-testid="bm-rules-empty">{t('bm.rules.empty')}</p>
        : <div className="catalog-grid" data-testid="bm-rules-core">{always.map((r, i) => <RuleCard key={r.file} rule={r} index={i} />)}</div>}
    {old.length > 0 && <section className="bm-section" data-testid="bm-rules-old">
      <header><div><h3>{t('bm.rules.oldTitle')}</h3><p>{t('bm.rules.loadedHint.none')}</p></div></header>
      <div className="catalog-grid">{old.map((r, i) => <RuleCard key={r.file} rule={r} index={i} />)}</div>
    </section>}
    <MaintenancePanel kinds={['rule']} testId="bm-maint-rules" />
  </div>;
}
