// "Regole" (G L, ADR 0077): the brain's rules as cards. A rule applies to every agent; the card says how agents get it
// (always, when relevant: the topic file's `when` words, tools and files, or not loaded: on disk but not in brain.json)
// and opens the file in the viewer. Lessons that apply to everyone land here by themselves (the corrections job), so
// the maintenance panel below lists the rule changes with "Annulla". Below the cards, "Regole imparate": the brain's own
// self-improvement policies (estimates, model choice, thresholds; brain/pages/LearnedRules.tsx), a page of their own
// until ADR 0082, shown only when the brain has some. Rendered by App.tsx PageFrame for 'regole' (old 'miglioramento'
// links land here).
import type { CSSProperties } from 'react';
import type { BrainRule } from '@shared/brain-model';
import { goTarget } from '../../actions';
import { t } from '../../i18n';
import { useBrainModel } from '../../store/brain-model';
import { PageHead } from '../../brain/components/States';
import { MaintenancePanel, when } from './MaintenancePanel';
import { LearnedRules } from '../../brain/pages/LearnedRules';
import '../../styles/agent-catalog.css';
import '../../styles/brain-model.css';

const TONE = { always: 'green', topic: 'blue', none: 'muted' } as const;

function RuleCard({ rule, index }: { rule: BrainRule; index: number }) {
  const w = rule.when;
  const parts = w ? ([['whenPrompt', w.prompt], ['whenTools', w.tools], ['whenPaths', w.paths]] as const).filter(([, v]) => v.length) : [];
  return <article className="catalog-card" data-kind="rule" data-testid={`bm-rule-${rule.file}`} style={{ '--row-index': Math.min(index, 8) } as CSSProperties}>
    <header className="bm-card-head">
      <div><h3>{rule.title}</h3><p className="bm-card-sub" title={rule.file}>{rule.file}</p></div>
      <span className="bm-badges"><span className="bm-badge" data-tone={TONE[rule.loaded]} title={t(`bm.rules.loadedHint.${rule.loaded}`)} data-testid="bm-rule-loaded">{t(`bm.rules.loaded.${rule.loaded}`)}</span></span>
    </header>
    {rule.summary && <p className="bm-desc">{rule.summary}</p>}
    {parts.map(([k, v]) => <dl key={k} className="bm-row"><dt>{t(`bm.rules.${k}`)}</dt><dd className="bm-chips">{v.slice(0, 8).map(x => <span key={x} className="bm-chip" data-kind="tool">{x}</span>)}</dd></dl>)}
    <footer className="bm-card-foot">
      <span>{t('bm.lines', { n: rule.lines })}{rule.changedAt ? ` · ${t('bm.changed', { at: when(rule.changedAt) })}` : ''}</span>
      <span className="sp" />
      <button type="button" className="btn btn-ghost btn-s" onClick={() => goTarget(`file/${rule.file}`)}>{t('bm.open')}</button>
    </footer>
  </article>;
}

export function RulesPage() {
  const { state, error } = useBrainModel();
  const order = { always: 0, topic: 1, none: 2 };
  const rules = [...(state?.rules ?? [])].sort((a, b) => order[a.loaded] - order[b.loaded] || a.file.localeCompare(b.file));
  return <div className="bm-page agent-overview" data-testid="bm-rules-page">
    <PageHead title={t('bm.rules.title')} lead={state ? t('bm.rules.lead', { n: rules.length }) : t('bm.loading')} />
    {error && <p role="alert">{error}</p>}
    {state && !state.root ? <p className="bm-empty">{t('bm.noBrain')}</p>
      : state && !rules.length ? <p className="bm-empty" data-testid="bm-rules-empty">{t('bm.rules.empty')}</p>
        : <div className="catalog-grid">{rules.map((r, i) => <RuleCard key={r.file} rule={r} index={i} />)}</div>}
    <LearnedRules />
    <MaintenancePanel kinds={['rule']} job="corrections" testId="bm-maint-rules" />
  </div>;
}
