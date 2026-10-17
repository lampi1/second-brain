// Typed bridge fixture tests: official-login handoff, authoritative memory selection and reply evidence only.
import { beforeEach, expect, it, vi } from 'vitest';
import type { SetupState } from '../../shared/agents';
const mock = vi.hoisted(() => ({ invoke: vi.fn(), on: vi.fn(), save: vi.fn(), create: vi.fn(), focus: vi.fn(), close: vi.fn(), get: vi.fn(), refresh: vi.fn() }));
vi.mock('../../renderer/sb', () => ({ sb: { invoke: mock.invoke, on: mock.on } }));
vi.mock('../../renderer/store/store', () => ({ app: { get: mock.get }, createChat: mock.create, refreshInfo: mock.refresh }));
vi.mock('../../renderer/store/agents', () => ({ saveSetup: mock.save }));
vi.mock('../../renderer/actions', () => ({ focusChat: mock.focus }));
vi.mock('../../renderer/store/ui', () => ({ closeModal: mock.close }));
import { createAiSetupPort } from './port';
const state: SetupState = { version: 1, status: 'new', updatedAt: 0, preferences: { step: 0, work: '', goals: '', tools: '', style: 'balanced', agentIds: [] } };
const info = { brainRoot: 'authoritative-root', brainProblem: null, engines: [{ id: 'claude', source: 'app', trusted: true, runs: 'claude' }] };
beforeEach(() => {
  vi.clearAllMocks(); mock.save.mockImplementation(async preferences => ({ ...state, status: 'draft', preferences })); mock.refresh.mockResolvedValue(undefined);
  mock.on.mockReturnValue(() => {}); mock.get.mockReturnValue({ chats: { 'fixture-chat': {} } }); mock.create.mockResolvedValue({ id: 'fixture-chat' });
  mock.invoke.mockImplementation(async channel => channel === 'app:info' ? info : channel === 'app:createBrain' ? { root: 'stale-created-root', connected: true } : channel === 'cli:status' ? { found: true, loggedIn: null, path: null, version: null } : undefined);
});
it('saves draft before automatic memory and uses authoritative current root, never stale created root', async () => {
  const port = createAiSetupPort(state, 'en'), result = await port.bootstrap();
  expect(mock.save.mock.invocationCallOrder[0]).toBeLessThan(mock.invoke.mock.invocationCallOrder[0]!);
  expect(mock.invoke).toHaveBeenCalledWith('app:createBrain', expect.objectContaining({ automatic: true, harness: 'none' }));
  expect(result.root).toBe('authoritative-root'); expect(mock.create).not.toHaveBeenCalled();
});
it('hands login to the existing official bridge and sends no credential fields', async () => {
  const port = createAiSetupPort(state, 'it'); await port.login('claude');
  expect(mock.invoke).toHaveBeenCalledWith('cli:login', { harness: 'claude' }); expect(mock.create).not.toHaveBeenCalled();
});
it('rejects a stale memory selection before creating a token-spending guide chat', async () => {
  await expect(createAiSetupPort(state, 'en').start('claude', 'stale-root')).rejects.toThrow('MEMORY_CHANGED'); expect(mock.create).not.toHaveBeenCalled();
});
it('starts the actual guide in the chosen engine without widening permission mode', async () => {
  expect(await createAiSetupPort(state, 'it').start('claude', 'authoritative-root')).toBe('fixture-chat');
  expect(mock.create).toHaveBeenCalledWith(expect.objectContaining({ harness: 'claude', cwd: 'authoritative-root', permissionMode: 'default' }));
});
it('verifies a completed provider reply rather than chat creation and stops an aborted trial', async () => {
  mock.invoke.mockImplementation(async channel => channel === 'chat:items' ? [{ kind: 'user', id: 'u', at: 1, text: 'Hi' }, { kind: 'assistant', id: 'a', at: 2, text: 'How do you work?' }, { kind: 'result', id: 'r', at: 3, isError: false, costUsd: 0, durationMs: 1, turns: 1 }] : undefined);
  const port = createAiSetupPort(state, 'en'); expect(await port.prove('fixture-chat', new AbortController().signal)).toBe('How do you work?');
  const aborted = new AbortController(); aborted.abort();
  await expect(port.prove('fixture-chat', aborted.signal)).rejects.toThrow('CANCELLED'); expect(mock.invoke).toHaveBeenCalledWith('chat:stop', { chatId: 'fixture-chat' });
});
