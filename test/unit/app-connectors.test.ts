// Connector state/security regression tests with fake official CLI, Jira, vault and selection persistence adapters.
import { describe, expect, it, vi } from 'vitest';
import { AppConnectorService, jiraCredential, type ConnectorAdapters, type ConnectorSelections } from '../../src/modules/onboarding/app-service';
import { githubProbe, jiraProbe } from '../../src/modules/onboarding/app-providers';
const credential = { site: 'https://example.atlassian.net', email: 'user@example.com', token: 'synthetic-test-value' };
const userInfoSite = new URL(credential.site);
userInfoSite.username = 'user';
function fixture(saved: ConnectorSelections = {}) {
  const adapters: ConnectorAdapters = {
    githubLogin: vi.fn(async () => {}), githubProbe: vi.fn(async () => ({ identity: 'github.com/user', account: 'user', projects: [{ id: '1', name: 'org/repo' }] })),
    jiraLogin: vi.fn(async (save: (value: typeof credential) => Promise<void>) => { await save(credential); }), jiraProbe: vi.fn(async () => ({ identity: 'tenant-a/user', account: 'User', projects: [{ id: '1', name: 'Project' }] })),
    vault: { available: () => true, get: vi.fn(async () => credential), set: vi.fn(async () => {}) },
    loadSelections: () => saved, saveSelections: vi.fn(async () => {}),
  };
  return { adapters, service: new AppConnectorService(adapters) };
}
describe('app connector state', () => {
  it('does no login, network or vault read while listing; saved preferences never imply verification', async () => {
    const { service, adapters } = fixture({ jira: { identity: 'tenant-a/user', projects: ['1'] } });
    expect((await service.list()).every(s => s.status === 'pending' && !s.selected.length)).toBe(true);
    expect(adapters.vault.get).not.toHaveBeenCalled(); expect(adapters.githubProbe).not.toHaveBeenCalled();
  });
  it('only verifies after read-only probe and does not expose credentials', async () => {
    const { service } = fixture(); await service.login('jira');
    expect((await service.list())[1]?.status).toBe('pending');
    expect((await service.probe('jira')).status).toBe('verified');
    expect(JSON.stringify(await service.list())).not.toContain(credential.token);
  });
  it('keeps missing login and raw secret-bearing errors out of IPC state', async () => {
    const { service, adapters } = fixture(); vi.mocked(adapters.githubProbe).mockRejectedValue(new Error(credential.token));
    expect(await service.probe('github')).toMatchObject({ status: 'failed', account: null, projects: [] });
    expect(JSON.stringify(await service.list())).not.toContain(credential.token);
    vi.mocked(adapters.vault.get).mockResolvedValue(null);
    expect((await service.probe('jira')).status).toBe('failed'); expect(adapters.jiraProbe).not.toHaveBeenCalled();
  });
  it('refuses Jira login without OS encryption', async () => {
    const { service, adapters } = fixture(); adapters.vault.available = () => false;
    await expect(service.login('jira')).rejects.toThrow('Portachiavi'); expect(adapters.jiraLogin).not.toHaveBeenCalled();
  });
  it('accepts only verified project ids and clones results', async () => {
    const { service } = fixture(); await expect(service.select('github', ['1'])).rejects.toThrow();
    const proof = await service.probe('github'); proof.projects[0]!.id = 'injected';
    await expect(service.select('github', ['injected'])).rejects.toThrow();
    expect((await service.select('github', ['1', '1'])).selected).toEqual(['1']);
  });
  it('restores selections only for the same tenant and account', async () => {
    const { service, adapters } = fixture({ jira: { identity: 'tenant-a/user', projects: ['1', 'deleted'] } });
    expect((await service.probe('jira')).selected).toEqual(['1']);
    vi.mocked(adapters.jiraProbe).mockResolvedValue({ identity: 'tenant-b/user', account: 'User', projects: [{ id: '1', name: 'Different project' }] });
    expect((await service.probe('jira')).selected).toEqual([]);
  });
  it('serializes cross-provider persistence and preserves state when saving fails', async () => {
    const { service, adapters } = fixture(); await service.probe('github'); await service.probe('jira');
    let release!: () => void;
    vi.mocked(adapters.saveSelections).mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const saving = service.select('github', ['1']);
    await expect(service.select('jira', ['1'])).rejects.toThrow('corso'); release(); await saving;
    vi.mocked(adapters.saveSelections).mockRejectedValue(new Error('disk full'));
    await expect(service.select('github', [])).rejects.toThrow(); expect((await service.list())[0]?.selected).toEqual(['1']);
  });
  it('disconnects locally without revoking the official GitHub login; removes Jira vault entry', async () => {
    const { service, adapters } = fixture(); await service.probe('jira'); await service.disconnect('jira');
    expect(adapters.vault.set).toHaveBeenCalledWith(null); expect((await service.list())[1]?.status).toBe('pending');
    await service.disconnect('github'); expect(adapters.githubLogin).not.toHaveBeenCalled();
  });
  it('rejects forged provider identifiers', async () => { await expect(fixture().service.probe('other' as 'github')).rejects.toThrow(); });
  it('cancels an unfinished Jira login and releases all connector actions', async () => {
    const { service, adapters } = fixture();
    adapters.jiraLogin = vi.fn((_save, signal) => new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })));
    const login = service.login('jira'); const rejected = expect(login).rejects.toThrow('cancelled');
    // a screen opened meanwhile sees the sign-in in progress (and offers the cancel)
    expect((await service.list()).map(s => !!s.signingIn)).toEqual([false, true]);
    await service.cancelLogin(); await rejected;
    expect((await service.list()).some(s => s.signingIn)).toBe(false);
    expect((await service.probe('github')).status).toBe('verified');
  });
});
describe('official provider adapters', () => {
  it('uses fixed gh API GET commands, handles raw jq login and caps repository listing', async () => {
    const run = vi.fn().mockResolvedValueOnce('user\n').mockResolvedValueOnce('[{"id":"1","name":"org/repo"}]');
    expect(await githubProbe(run)).toMatchObject({ account: 'user', identity: 'github.com/user' });
    expect(run.mock.calls[0]?.[0]).toEqual(['api', '--hostname', 'github.com', 'user', '--jq', '.login']);
    expect(run.mock.calls[1]?.[0][3]).toContain('per_page=100');
  });
  it('bounds Jira endpoints, binds tenant identity and refuses credential-bearing redirects', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ accountId: 'a', displayName: 'User' })).mockResolvedValueOnce(Response.json({ values: [{ id: '1', name: 'Project' }] }));
    expect(await jiraProbe(credential, request)).toMatchObject({ identity: 'https://example.atlassian.net/a' });
    expect(request.mock.calls[0]?.[0]).toBe(`${credential.site}/rest/api/3/myself`);
    expect(request.mock.calls.every(call => call[1]?.method === 'GET' && call[1]?.redirect === 'error')).toBe(true);
    expect(request.mock.calls[1]?.[0]).toContain('maxResults=100');
  });
  it.each(['http://example.atlassian.net', 'https://attacker.test', 'https://example.atlassian.net.attacker.test', userInfoSite.href, 'https://example.atlassian.net/path', 'https://127.0.0.1', 'https://example.atlassian.net?token=x'])('rejects unsafe Jira site %s before transport', async site => {
    const request = vi.fn<typeof fetch>(); await expect(jiraProbe({ ...credential, site }, request)).rejects.toThrow(); expect(request).not.toHaveBeenCalled();
  });
  it('rejects password-style invalid inputs, HTTP errors and oversized provider bodies', async () => {
    expect(() => jiraCredential({ ...credential, email: 'user:password@example.com' })).toThrow();
    await expect(jiraProbe(credential, vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 401 })))).rejects.toThrow();
    await expect(jiraProbe(credential, vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(512 * 1024 + 1))))).rejects.toThrow('grande');
  });
});
