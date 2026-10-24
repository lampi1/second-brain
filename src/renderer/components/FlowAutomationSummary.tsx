// Exact automatic configuration is shared by review and the catalog so consent stays tied to visible scope, inputs
// and the DevOps write grant (ADR 0145).
import type { FlowAutomationConfig } from '@shared/flow-automation';
import { t } from '../i18n';
export function FlowAutomationSummary({ config }: { config: FlowAutomationConfig }) {
  const trigger = config.trigger, write = config.devopsWrite;
  return <div className="flow-auto-summary" data-testid="flow-auto-summary">
    <dl className="flow-facts">
      <dt>{t('flows.approvedVersion')}</dt><dd>{config.flowId} · v{config.flowVersion}</dd>
      <dt>{t('flows.trigger')}</dt><dd>{trigger.kind === 'interval' ? t('flows.interval') : 'Azure DevOps'}</dd>
      <dt>{t('flows.cadence')}</dt><dd>{trigger.everyMinutes} {t('flows.minutes')}</dd>
      <dt>{t('flows.scope')}</dt><dd>{[config.scope.project, config.scope.areaPath].filter(Boolean).join(' · ') || '—'}</dd>
      {trigger.kind === 'devops' && <><dt>Azure DevOps</dt><dd>{[trigger.organization, trigger.project, trigger.areaPath, trigger.workItemType].filter(Boolean).join(' · ')}<br />{trigger.states.join(' · ')}</dd><dt>{t('flows.existing')}</dt><dd>{t(trigger.includeExisting ? 'flows.included' : 'flows.excluded')}</dd></>}
      {trigger.kind === 'devops' && <><dt>{t('flows.devopsWrite')}</dt><dd data-testid="flow-auto-devops-write">{write
        ? <>{write.organization} · {write.projects.join(' · ')}<br />{write.ops.map(op => t(`flows.writeOp.${op}`)).join(' · ')}{write.fields.length ? <><br />{write.fields.join(' · ')}</> : null}{write.mentions?.length ? <><br /><span data-testid="flow-auto-mentions">{t('flows.devopsMentions')}: {write.mentions.join(' · ')}</span></> : null}<br /><span className="flows-muted">{t('flows.devopsWriteScope')}</span></>
        : t('flows.devopsWriteNone')}</dd></>}
      <dt>{t('flows.inputs')}</dt><dd>{Object.entries(config.inputs).length ? <dl className="flow-facts flow-inputs">{Object.entries(config.inputs).map(([name, value]) => <div className="flow-input-pair" key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl> : '—'}</dd>
      <dt>{t('flows.priority')}</dt><dd>{t(`flows.${config.priority}`)}</dd>
    </dl>
    <p className="flows-muted">{t('flows.autoCost')}</p>
  </div>;
}
