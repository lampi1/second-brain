// The automatic-configuration summary shows the DevOps write grant the user approves (ADR 0145), or that there is none.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { FlowAutomationConfig } from '../../src/shared/flow-automation';
import { FlowAutomationSummary } from '../../src/renderer/components/FlowAutomationSummary';

const config: FlowAutomationConfig = { flowId: 'fix', flowVersion: 2, scope: { project: 'ProjectA', areaPath: 'Team' }, inputs: {}, priority: 'normal',
  trigger: { kind: 'devops', everyMinutes: 15, organization: 'contoso', project: 'ProjectA', areaPath: 'Team', workItemType: 'Bug', states: ['New'], includeExisting: false } };

it('shows the grant organization, projects, operations and fields', () => {
  const html = renderToStaticMarkup(createElement(FlowAutomationSummary, { config: { ...config, devopsWrite: { organization: 'contoso', projects: ['ProjectA', 'ProjectB'], ops: ['tags', 'fields'], fields: ['System.State'] } } }));
  expect(html).toContain('data-testid="flow-auto-devops-write"');
  expect(html).toContain('contoso · ProjectA · ProjectB');
  expect(html).toContain('System.State');
  expect(html).not.toContain('flows.writeOp');
});
it('says the flow only reads when there is no grant', () => {
  const html = renderToStaticMarkup(createElement(FlowAutomationSummary, { config }));
  expect(html).toMatch(/data-testid="flow-auto-devops-write">[^<]+</);
});
