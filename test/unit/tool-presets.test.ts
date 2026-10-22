// The tool catalog's flow (src/renderer/lib/tool-presets.ts, issue #165, ADR 0119): a tile asks only human data, builds
// the real MCP server without the user ever typing a command or a header, creates the account and the server together
// with the token in the same place, and ends every connect in a test with a clear outcome (works with N projects, or
// which part failed and why). Fake port: no IPC, no network.
import { describe, expect, it, vi } from 'vitest';
import type { ConnectorState } from '@shared/connectors';
import type { McpServerView, McpServersState } from '@shared/mcp-servers';
import { PRESETS, connectPreset, inputProblems, organizationOf, pollPreset, presetOf, presetSecret, presetServer, presetToken, siteOf, tileFrom } from '../../src/renderer/lib/tool-presets';
import type { ToolPort } from '../../src/renderer/lib/tool-presets';
import { POLL_TRIES } from '../../src/renderer/lib/setup-connectors';

const GH = ['github', 'pat', '11ABCDEFG0123456789', 'abcdefghijklmnopqrstuvwxyz'].join('_'); // built at run time: not a secret shape in the source
const ADO = 'https://dev.azure.com/';
const account = (provider: ConnectorState['provider'], status: ConnectorState['status'], n = 3): ConnectorState => ({ provider, status, checkedAt: null, account: status === 'verified' ? 'giulia' : null, projects: status === 'verified' ? Array.from({ length: n }, (_, i) => ({ id: String(i), name: `p${i}` })) : [], selected: [], detail: '' });
const view = (id: string, ok: boolean | null, tools = 5): McpServerView => ({ id, label: id, transport: 'http', url: 'https://x', secrets: [], enabled: true, secretMasks: {},
  lastTest: ok === null ? null : { ok, at: 1, ms: 1, tools: Array.from({ length: ok ? tools : 0 }, (_, i) => ({ name: `t${i}`, description: '', readOnly: true })), ...(ok ? {} : { error: { code: 'auth' as const, message: 'Accesso rifiutato (HTTP 401).', fix: 'Controlla il token.' } }) } });
const state = (servers: McpServerView[] = [], secretsAvailable = true): McpServersState => ({ servers, access: {}, secretsAvailable });
function fakePort(over: Partial<ToolPort> = {}): ToolPort & { [K in keyof ToolPort]: ReturnType<typeof vi.fn> } {
  return {
    servers: vi.fn(async () => state()),
    saveServer: vi.fn(async () => state()),
    setSecret: vi.fn(async () => state()),
    testServer: vi.fn(async (id: string) => state([view(id, true)])),
    useToken: vi.fn(async (v: { provider: 'github' | 'jira' }) => account(v.provider, 'verified')),
    login: vi.fn(async () => {}),
    probe: vi.fn(async (p: ConnectorState['provider']) => account(p, 'verified', 2)),
    ...over,
  } as never;
}

describe('human data only', () => {
  it('offers GitHub, Jira Cloud and Azure DevOps, each asking only what a person knows', () => {
    expect(PRESETS.map(p => [p.id, p.fields, p.auth])).toEqual([['github', [], 'token'], ['jira', ['site', 'email'], 'token'], ['azure', ['organization'], 'browser']]);
    for (const p of PRESETS.filter(x => x.auth === 'token')) expect(p.tokenUrl).toMatch(/^https:\/\/(github\.com|id\.atlassian\.com)\//);
  });
  it('reads an organization or a site however it is pasted', () => {
    expect(['contoso', ` ${ADO}contoso/Shop `, `${ADO.slice(8)}contoso`, 'contoso' + '.visualstudio.com'].map(organizationOf)).toEqual(['contoso', 'contoso', 'contoso', 'contoso']);
    expect(organizationOf('con toso')).toBeNull();
    expect(['acme', 'acme.atlassian.net', 'https://ACME.atlassian.net/jira/software'].map(siteOf)).toEqual(Array(3).fill('https://acme.atlassian.net'));
    expect(siteOf('evil.com/x')).toBeNull();
  });
  it('says which field is missing or wrong, the token included', () => {
    expect(inputProblems(presetOf('jira'), {})).toEqual({ site: 'missing', email: 'missing', token: 'missing' });
    expect(inputProblems(presetOf('jira'), { site: 'acme', email: 'nope', token: 'short' })).toEqual({ email: 'invalid', token: 'invalid' });
    expect(inputProblems(presetOf('github'), { token: GH })).toEqual({});
    expect(inputProblems(presetOf('azure'), { organization: 'contoso' })).toEqual({});
  });
});

describe('the server it builds', () => {
  it('uses only real servers, the token in a secret slot, never a typed command or header', () => {
    expect(presetServer(presetOf('github'), {}, 'x')).toMatchObject({ id: 'github', transport: 'http', url: 'https://api.githubcopilot.com/mcp/', secrets: [{ where: 'header', name: 'Authorization', prefix: 'Bearer ' }] });
    expect(presetServer(presetOf('jira'), {}, 'x')).toMatchObject({ id: 'jira', url: 'https://mcp.atlassian.com/v1/mcp', secrets: [{ name: 'Authorization', prefix: 'Basic ' }] });
    expect(presetServer(presetOf('azure'), { organization: `${ADO}contoso` }, 'x')).toMatchObject({ id: 'azure-devops', transport: 'stdio', command: 'npx', args: ['-y', '@azure-devops/mcp', 'contoso'], secrets: [] });
    expect(presetSecret(presetOf('github'), { token: ` ${GH} ` })).toBe(GH);
    expect(atob(presetSecret(presetOf('jira'), { email: 'g@example.com', token: 'ATATT3xFf' })!)).toBe('g@example.com:ATATT3xFf');
    expect(presetSecret(presetOf('azure'), { organization: 'contoso' })).toBeNull();
    expect(presetToken(presetOf('jira'), { site: 'acme', email: 'g@example.com', token: 'ATATT3xFf' })).toEqual({ provider: 'jira', token: 'ATATT3xFf', site: 'https://acme.atlassian.net', email: 'g@example.com' });
  });
});

describe('connect: account and server together, then a test', () => {
  it('a token tile creates the server, puts the token in place, verifies the account and tests the server', async () => {
    const port = fakePort();
    const out = await connectPreset(port, presetOf('github'), { token: GH }, 'Repository');
    expect(port.saveServer).toHaveBeenCalledWith(expect.objectContaining({ id: 'github', purpose: 'Repository' }), undefined);
    expect(port.setSecret).toHaveBeenCalledWith('github', 'header:Authorization', GH);
    expect(port.useToken).toHaveBeenCalledWith({ provider: 'github', token: GH });
    expect(port.testServer).toHaveBeenCalledWith('github');
    expect(out).toEqual({ phase: 'ok', account: 'giulia', projects: 3, tools: 5 });
  });
  it('updates a server that already exists instead of adding a second one', async () => {
    const port = fakePort({ servers: vi.fn(async () => state([view('jira', null)])) });
    await connectPreset(port, presetOf('jira'), { site: 'acme', email: 'g@example.com', token: 'ATATT3xFf' }, 'x');
    expect(port.saveServer).toHaveBeenCalledWith(expect.objectContaining({ id: 'jira' }), 'jira');
  });
  it('a refused token says the account failed; a failing server says its own message and fix', async () => {
    expect(await connectPreset(fakePort({ useToken: vi.fn(async () => account('github', 'failed')) }), presetOf('github'), { token: GH }, 'x')).toEqual({ phase: 'failed', failed: 'account' });
    expect(await connectPreset(fakePort({ useToken: vi.fn(async () => { throw new Error("Error invoking remote method 'connectors:useToken': Error: Portachiavi cifrato di sistema non disponibile"); }) }), presetOf('github'), { token: GH }, 'x'))
      .toEqual({ phase: 'failed', failed: 'account', message: 'Portachiavi cifrato di sistema non disponibile' });
    const bad = await connectPreset(fakePort({ testServer: vi.fn(async (id: string) => state([view(id, false)])) }), presetOf('github'), { token: GH }, 'x');
    expect(bad).toEqual({ phase: 'failed', failed: 'server', account: 'giulia', projects: 3, message: 'Accesso rifiutato (HTTP 401).', fix: 'Controlla il token.' });
  });
  it('never stores a token where tokens cannot be encrypted', async () => {
    const port = fakePort({ servers: vi.fn(async () => ({ ...state([], false), secretsWhy: 'no keyring' })) });
    expect(await connectPreset(port, presetOf('github'), { token: GH }, 'x')).toEqual({ phase: 'failed', failed: 'keyring', message: 'no keyring' });
    expect(port.saveServer).not.toHaveBeenCalled();
  });
  it('a browser tile opens the sign-in and waits, then checks by itself until it works or gives up', async () => {
    const port = fakePort({ probe: vi.fn(async () => account('azure', 'pending')) });
    expect(await connectPreset(port, presetOf('azure'), { organization: 'contoso' }, 'x')).toEqual({ phase: 'waiting' });
    expect(port.login).toHaveBeenCalledWith('azure');
    expect(port.setSecret).not.toHaveBeenCalled();
    expect(await pollPreset(port, presetOf('azure'), POLL_TRIES - 1)).toEqual({ phase: 'failed', failed: 'account' });
    port.probe.mockResolvedValue(account('azure', 'verified', 4));
    expect(await pollPreset(port, presetOf('azure'), 1)).toEqual({ phase: 'ok', account: 'giulia', projects: 4, tools: 5 });
    expect(port.testServer).toHaveBeenCalledWith('azure-devops');
  });
  it('shows a tile done in an earlier run as working, only when both parts work', () => {
    expect(tileFrom(presetOf('github'), [account('github', 'verified')], state([view('github', true)]))).toEqual({ phase: 'ok', account: 'giulia', projects: 3, tools: 5 });
    expect(tileFrom(presetOf('github'), [account('github', 'verified')], state([view('github', false)]))).toEqual({ phase: 'idle' });
    expect(tileFrom(presetOf('github'), [], null)).toEqual({ phase: 'idle' });
  });
});
