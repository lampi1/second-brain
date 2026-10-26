// The Connettori hub's pure readings and server-rendered cards (ADR 0086): a server's state, the totals and how they
// count, the form to a definition and back (no secret field ever holds a value), and a card that shows its error with
// the fix, its tools split read/write, its token only as a mask, in Italian and English.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { defOf, emptyForm, formOf, hubTotals, monogram, rolesWith, runsAs, serverStatus } from '../../../src/renderer/lib/mcp-servers';
import { HubTotalsRow, ServerCard } from '../../../src/renderer/components/ConnectorsHub';
import { AgentMcpSection } from '../../../src/renderer/components/AgentMcpSection';
import type { McpServerView, McpServersState } from '../../../src/shared/mcp-servers';
import { setLang } from '../../../src/renderer/i18n';
import { connectorsEn } from '../../../src/renderer/i18n/areas/connectors.en';
import { connectorsIt } from '../../../src/renderer/i18n/areas/connectors.it';

const ok: McpServerView = { id: 'ado', label: 'Azure DevOps', transport: 'stdio', command: 'npx', args: ['-y', '@azure-devops/mcp'], secrets: [], enabled: true, secretMasks: {},
  lastTest: { ok: true, at: 0, ms: 900, tools: [{ name: 'list', description: '', readOnly: true }, { name: 'update', description: '', readOnly: false }] } };
const broken: McpServerView = { id: 'gh', label: 'GitHub', transport: 'http', url: 'https://api.githubcopilot.com/mcp/', secrets: [{ where: 'header', name: 'Authorization', prefix: 'Bearer ' }], enabled: true,
  secretMasks: { 'header:Authorization': 'ghp_…9f2c' }, lastTest: { ok: false, at: 0, ms: 10, tools: [], error: { code: 'auth', message: 'Accesso rifiutato (HTTP 401).', fix: 'Il token è scaduto.' } } };
const state: McpServersState = { servers: [ok, broken], access: { herald: { servers: { ado: 'none' } } }, secretsAvailable: true };

describe('readings', () => {
  it('state, roles, totals', () => {
    expect(serverStatus(ok)).toBe('ok');
    expect(serverStatus(broken)).toBe('failed');
    expect(serverStatus({ ...broken, secretMasks: { 'header:Authorization': null } })).toBe('missing');
    expect(serverStatus({ ...ok, lastTest: null })).toBe('untested');
    expect(serverStatus({ ...ok, enabled: false })).toBe('off');
    expect(rolesWith(state, 'ado')).toHaveLength(5);
    expect(hubTotals(state.servers, [{ status: 'verified' }, { status: 'pending' }])).toEqual({ working: 2, toFix: 1, total: 4, tools: 2, reading: 1 });
    expect(runsAs(broken)).toBe('api.githubcopilot.com/mcp');
    expect(monogram('Azure DevOps')).toBe('AD');
  });
  it('form to definition and back', () => {
    const f = { ...emptyForm(), label: 'Azure DevOps', command: 'npx', args: '-y\n@azure-devops/mcp\n', env: 'ORG=contoso', tokenName: 'AZURE_DEVOPS_PAT' };
    const d = defOf(f);
    expect(d).toMatchObject({ id: 'azure-devops', transport: 'stdio', args: ['-y', '@azure-devops/mcp'], env: { ORG: 'contoso' }, secrets: [{ where: 'env', name: 'AZURE_DEVOPS_PAT' }] });
    expect(formOf(d)).toMatchObject({ args: '-y\n@azure-devops/mcp', env: 'ORG=contoso', tokenName: 'AZURE_DEVOPS_PAT' });
    expect(defOf({ ...formOf(broken), headers: 'X-Team: web' }, broken)).toMatchObject({ id: 'gh', headers: { 'X-Team': 'web' }, secrets: [{ where: 'header', name: 'Authorization', prefix: 'Bearer ' }] });
  });
});

describe('cards', () => {
  const card = (server: McpServerView) => renderToStaticMarkup(createElement(ServerCard, { server, state, onEdit() {}, onState() {}, testing: false, onTest() {} }));
  it('a failing server shows its error and fix, the token only as a mask, one Prova', () => {
    const html = card(broken);
    expect(html).toContain('Non funziona');
    expect(html).toContain('Accesso rifiutato (HTTP 401).');
    expect(html).toContain('Il token è scaduto.');
    expect(html).toContain('ghp_…9f2c');
    expect(html).not.toContain('type="password"');
    expect(html).toContain('aria-label="Prova GitHub"');
    expect(html).toContain('6 su 6');
  });
  it('a working server splits its tools; the totals explain themselves; English too', () => {
    expect(card(ok)).toContain('1 lettura · 1 scrittura');
    const totals = renderToStaticMarkup(createElement(HubTotalsRow, { servers: state.servers, connectors: [] }));
    expect(totals).toContain('Funzionano');
    expect(totals).toContain('help-tip');
    expect(Object.keys(connectorsEn).sort()).toEqual(Object.keys(connectorsIt).sort());
    try { setLang('en'); expect(card(ok)).toContain('1 read · 1 write'); expect(card(broken)).toContain('Not working'); } finally { setLang('it'); }
  });
  it('the agent card section renders before the state arrives', () => {
    expect(renderToStaticMarkup(createElement(AgentMcpSection, { roleId: 'herald', roleName: 'Herald' }))).toContain('Server MCP');
  });
});

it('round trips the explicit routine test-account opt-in and removes it when unchecked', () => {
  const form = { ...emptyForm(), label: 'Test API', command: 'node', args: 'test.mjs', routineTest: true };
  const enabled = defOf(form); expect(enabled.routineTest).toBe(true); expect(formOf(enabled).routineTest).toBe(true);
  expect(defOf({ ...formOf(enabled), routineTest: false }, enabled).routineTest).toBeUndefined();
});
