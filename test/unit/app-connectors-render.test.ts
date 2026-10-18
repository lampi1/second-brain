// Server-rendered connector panel semantics: explicit evidence, named actions and no secret entry inside the renderer.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { AppConnectorScreen, ConnectorCard } from '../../src/modules/onboarding/AppScreen';
import type { ConnectorState } from '../../src/shared/connectors';
import { setLang } from '../../src/renderer/i18n';
import { connectorsIt } from '../../src/renderer/i18n/areas/connectors.it';
import { connectorsEn } from '../../src/renderer/i18n/areas/connectors.en';
const value: ConnectorState = { provider: 'jira', status: 'pending', checkedAt: null, account: null, projects: [], selected: [], detail: 'Accesso da completare' };
const render = (patch: Partial<ConnectorState> = {}) => renderToStaticMarkup(createElement(ConnectorCard, { value: { ...value, ...patch }, busy: false, onLogin() {}, onProbe() {}, onSelect() {}, onDisconnect() {} }));
it('imports and server-renders the default panel in Node without a window or bridge mock', () => {
  expect(typeof window).toBe('undefined');
  const html = renderToStaticMarkup(createElement(AppConnectorScreen));
  expect(html).toContain('data-testid="app-connectors"');
  expect(html).toContain('Caricamento dei collegamenti');
});
it('offers official access and an explicit read-only verification; no token/password renderer field', () => {
  const html = render(); expect(html).toContain('Accedi a Jira Cloud'); expect(html).toContain('Verifica accesso a Jira Cloud'); expect(html).toContain('role="status"'); expect(html).not.toContain('type="password"'); expect(html).not.toContain('Collegato e verificato');
});
it('gives Azure the same named actions and explains its existing DevOps integration', () => {
  const html = render({ provider: 'azure' });
  expect(html).toContain('Accedi a Azure DevOps'); expect(html).toContain('Verifica accesso a Azure DevOps');
  expect(html).toContain('Azure CLI'); expect(html).toContain('devops-me.mjs');
  expect(html).toContain('btn-primary'); expect(html).not.toContain('type="password"');
});
it('renders verified projects with keyboard-accessible named checkboxes and preserves failures as failures', () => {
  const html = render({ status: 'verified', projects: [{ id: '1', name: 'Project one' }], selected: ['1'], checkedAt: '2026-10-17T10:00:00Z' });
  expect(html).toContain('Collegato e verificato'); expect(html).toContain('type="checkbox"'); expect(html).toContain('checked=""'); expect(html).toContain('Project one'); expect(html).toContain('Ultima verifica');
  expect(render({ status: 'failed' })).toContain('Verifica non riuscita');
});
it('shows the pending status once, keeps disconnect on demand and localizes the card in English', () => {
  expect(Object.keys(connectorsEn).sort()).toEqual(Object.keys(connectorsIt).sort());
  expect(render().match(/Accesso da completare/g)).toHaveLength(1);
  try {
    setLang('en'); const html = render();
    expect(html).toContain('Sign-in pending'); expect(html).toContain('Sign in to Jira Cloud');
    expect(html).not.toContain('Accesso da completare'); expect(html).not.toContain('Accedi');
    expect(html).toContain('<details>'); expect(html).not.toContain('<details open');
    expect(html).not.toContain('type="password"');
  } finally { setLang('it'); }
});
