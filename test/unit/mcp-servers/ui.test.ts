// The Connettori hub's pure readings and server-rendered cards (ADR 0086): a server's state, the totals and how they
// count, the form to a definition and back (no secret field ever holds a value), and a card that shows its error with
// the fix, its tools split read/write, its token only as a mask, in Italian and English.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { defOf, emptyForm, formOf, hubTotals, monogram, rolesWith, runsAs, saveServer, serverStatus } from '../../../src/renderer/lib/mcp-servers';
import { HubTotalsRow, ServerCard, ServerEditor } from '../../../src/renderer/components/ConnectorsHub';
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

// The editor's Salva (ADR 0373): the secret box is cleared only after the secret is stored; a refusal keeps the text.
describe('saveServer', () => {
  const def = defOf({ ...formOf(broken), label: 'Gmail' }, broken);
  const fake = (calls: string[], o: { saveFails?: boolean; secretFails?: boolean } = {}) => ({
    save: async (a: { def: { id: string }; previousId?: string }) => { calls.push(`save:${a.def.id}:${a.previousId ?? ''}`); if (o.saveFails) throw new Error('def refused'); return state; },
    setSecret: async (a: { id: string; slot: string; value: string }) => { calls.push(`secret:${a.id}:${a.slot}`); if (o.secretFails) throw new Error('secret refused'); return state; },
  });

  it('saves the definition, then the secret, and reports no error', async () => {
    const calls: string[] = [];
    const r = await saveServer(fake(calls), def, 'gh', 'typed');
    expect(calls).toEqual(['save:gh:gh', 'secret:gh:oauth:client-secret']);
    expect(r.secretError).toBeUndefined();
    expect(r.savedId).toBe('gh');
  });

  it('a refused secret does not throw and is returned, so the editor keeps the text and shows the error', async () => {
    const calls: string[] = [];
    const r = await saveServer(fake(calls, { secretFails: true }), def, undefined, 'typed');
    expect((r.secretError as Error).message).toBe('secret refused');
    expect(r.savedId).toBe('gh');
    expect(calls).toEqual(['save:gh:', 'secret:gh:oauth:client-secret']);
  });

  it('a refused definition throws and the secret is never sent; no secret typed means no secret call', async () => {
    const calls: string[] = [];
    await expect(saveServer(fake(calls, { saveFails: true }), def, 'gh', 'typed')).rejects.toThrow('def refused');
    expect(calls).toEqual(['save:gh:gh']);
    const none: string[] = [];
    await saveServer(fake(none), def, 'gh', '');
    expect(none).toEqual(['save:gh:gh']);
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
    expect(html).toContain('5 su 5'); // the Orchestrator and the four work roles, every one on by default
  });
  it('OAuth (ADR 0273): «Accedi» when the test asked for it; «Connesso come …», «Esci» and no Authorization token once logged in', () => {
    const asks = card({ ...broken, secrets: [], secretMasks: {}, lastTest: { ...broken.lastTest!, error: { ...broken.lastTest!.error!, login: true } } });
    expect(asks).toContain('aria-label="Accedi a GitHub"');
    expect(asks).toContain('Non hai ancora fatto l’accesso.');
    expect(card(broken)).not.toContain('Accedi a GitHub');
    const inn = card({ ...broken, secretMasks: { 'header:Authorization': null }, login: { who: 'davide', at: 1 } });
    expect(inn).toContain('Connesso come davide');
    expect(inn).toContain('>Esci<');
    expect(inn).not.toContain('type="password"');
    expect(serverStatus({ ...broken, secretMasks: { 'header:Authorization': null }, login: { who: null, at: 1 } })).toBe('failed');
    expect(defOf({ ...formOf(broken), oauthClientId: 'second-brain', oauthPort: '8765' }, broken).oauth).toEqual({ clientId: 'second-brain', port: 8765 });
    expect(formOf({ ...broken, oauth: { clientId: 'x' } })).toMatchObject({ oauthClientId: 'x', oauthPort: '' });
  });
  it('OAuth client secret (ADR 0373): a write-only password box, «Salvato» when set, never in the definition; the scope round-trips', () => {
    const editor = (server: McpServerView) => renderToStaticMarkup(createElement(ServerEditor, { server, onDone() {} }));
    const none = editor(broken);
    expect(none).toContain('Client secret OAuth');
    expect(none).toContain('data-testid="hub-oauth-secret"');
    expect(none).toContain('placeholder="Nessun secret"');
    expect(none).not.toContain('hub-oauth-secret-state');
    const set = editor({ ...broken, oauthSecretSet: true });
    expect(set).toContain('placeholder="Salvato: scrivi per sostituirlo"');
    expect(set).toContain('data-testid="hub-oauth-secret-state"');
    expect(set).toContain('>Rimuovi<');
    expect(set).toMatch(/<input[^>]*type="password"[^>]*value=""/);
    const withScope = { ...broken, oauth: { clientId: 'cid', scope: 'https://www.googleapis.com/auth/gmail.readonly' } };
    expect(formOf(withScope)).toMatchObject({ oauthClientId: 'cid', oauthScope: 'https://www.googleapis.com/auth/gmail.readonly' });
    const def = defOf(formOf(withScope), withScope);
    expect(def.oauth).toEqual({ clientId: 'cid', scope: 'https://www.googleapis.com/auth/gmail.readonly' });
    expect(JSON.stringify(def)).not.toMatch(/clientSecret|client-secret/i);
  });
  it('a working server splits its tools; the totals explain themselves; English too', () => {
    expect(card(ok)).toContain('1 lettura · 1 scrittura');
    const totals = renderToStaticMarkup(createElement(HubTotalsRow, { servers: state.servers, connectors: [] }));
    expect(totals).toContain('Funzionano');
    expect(totals).toContain('help-tip');
    expect(Object.keys(connectorsEn).sort()).toEqual(Object.keys(connectorsIt).sort());
    try { setLang('en'); expect(card(ok)).toContain('1 read · 1 write'); expect(card(broken)).toContain('Not working'); } finally { setLang('it'); }
  });
});
