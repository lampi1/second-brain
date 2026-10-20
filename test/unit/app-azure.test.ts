// Azure Settings probes must verify fresh DevOps evidence, isolate account selections and never use a vault.
import { expect, it, vi } from 'vitest';
import { azureProof } from '../../src/modules/onboarding/app-azure';
import { AppConnectorService, type ConnectorAdapters } from '../../src/modules/onboarding/app-service';
import type { TasksState } from '../../src/shared/contract';
const state = (patch: Partial<TasksState> = {}) => ({ at: 1, error: null, assigned: [], urgent: [], prs: [], reviews: [], ...patch }) as TasksState;
const account = async () => JSON.stringify({ tenant: 'tenant-a', user: 'user@example.com' });
it('uses fresh DevOps results and deduplicates projects with organization-qualified IDs', async () => {
  const item = { url: 'https://dev.azure.com/o/Shop/_workitems/edit/1', project: 'Shop' };
  const refresh = vi.fn(async () => state({ assigned: [{ ...item, url: 'https://[' }, item, item] as TasksState['assigned'] }));
  expect(await azureProof(account, refresh)).toEqual({ identity: 'tenant-a/user@example.com', account: 'user@example.com', projects: [{ id: 'o/Shop', name: 'o/Shop' }] });
  expect(refresh).toHaveBeenCalledOnce();
});
it('rejects an account switch during the fresh DevOps read', async () => {
  const read = vi.fn().mockResolvedValueOnce(await account()).mockResolvedValueOnce(JSON.stringify({ tenant: 'tenant-b', user: 'other@example.com' }));
  await expect(azureProof(read, async () => state())).rejects.toThrow('cambiato');
});
it('never treats Azure login alone or cached data with a refresh error as verified', async () => {
  await expect(azureProof(account, async () => state({ error: { kind: 'login', message: 'expired' } }))).rejects.toThrow();
  await expect(azureProof(account, async () => state({ at: null }))).rejects.toThrow();
  const refresh = vi.fn(async () => state());
  await expect(azureProof(async () => '{}', refresh)).rejects.toThrow(); expect(refresh).not.toHaveBeenCalled();
});
it('Azure login, verify and disconnect do not read or write Jira credentials', async () => {
  const vault = { get: vi.fn(), set: vi.fn(), available: vi.fn() };
  const login = vi.fn(async () => {});
  const service = new AppConnectorService({ vault, azureLogin: login, azureProbe: () => azureProof(account, async () => state()), loadSelections: () => ({}), saveSelections: async () => {} } as unknown as ConnectorAdapters);
  await service.login('azure'); expect(login).toHaveBeenCalledOnce();
  expect((await service.probe('azure')).status).toBe('verified');
  await service.disconnect('azure');
  expect(vault.get).not.toHaveBeenCalled(); expect(vault.set).not.toHaveBeenCalled(); expect(vault.available).not.toHaveBeenCalled();
});
it('a good Task page read is proof by itself (account read after it); a failed read never is', async () => {
  const { azureReadProof } = await import('../../src/modules/onboarding/app-azure');
  const item = { url: 'https://dev.azure.com/o/Shop/_workitems/edit/1', project: 'Shop' };
  expect(await azureReadProof(account, state({ assigned: [item] as TasksState['assigned'] }))).toEqual({ identity: 'tenant-a/user@example.com', account: 'user@example.com', projects: [{ id: 'o/Shop', name: 'o/Shop' }] });
  const read = vi.fn(account);
  await expect(azureReadProof(read, state({ error: { kind: 'login', message: 'x' } }))).rejects.toThrow(); expect(read).not.toHaveBeenCalled();
  await expect(azureReadProof(async () => '{}', state())).rejects.toThrow();
});
