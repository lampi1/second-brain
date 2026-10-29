// app_config (src/main/appctl/config.ts, ADR 0149): the Orchestrator changes the app's configuration for the user,
// protected settings too (the owner's choice, 2026-10-24), only after the user's own recent words, logged and undoable;
// role cards through the page's save, connectors only on/off and access, never a new server or a token.
import { describe, expect, it, vi } from 'vitest';
import { configTool, draftOf, type ConfigDeps } from '../../src/main/appctl/config';
import { ConfigStore } from '../../src/main/brain/config';
import type { AgentProfile } from '../../src/shared/agents';
import type { McpServersState } from '../../src/shared/mcp-servers';
import { tmpDir } from './brain/helpers';

function brainOf(store: ConfigStore): ConfigDeps['brain'] {
  return {
    settings: () => store.get(), settingsSchema: () => store.schema(), settingsHistory: n => store.history(n),
    undoSetting: (id, by = 'user', origin) => store.undo(id, { by, ...origin }), requestSetting: (k, v, o) => store.request(k, v, o),
  };
}
const role = (over: Partial<AgentProfile> = {}): AgentProfile => ({
  id: 'scout', name: 'Scout', purpose: 'find facts', instructions: 'Read and verify.', engine: 'claude', model: null, avatar: { kind: 'glyph' } as unknown as AgentProfile['avatar'],
  tools: null, permissionCeiling: null, tier: 'fast', tierMax: 'strong', launches: [], skills: [], createdAt: 1, updatedAt: 1, scope: 'role', version: 3, activeVersion: 3,
  lastEditedBy: 'default', userLocked: false, ...over,
} as AgentProfile);

function deps(over: Partial<ConfigDeps> = {}): ConfigDeps & { store: ConfigStore } {
  const store = new ConfigStore(tmpDir(), {});
  return { store, callerId: 'orch-1', userAsked: () => true, brain: brainOf(store), ...over };
}

describe('app_config: settings', () => {
  it('changes a protected setting at once when the user asked, logged as the agent\'s change, and undoes it', async () => {
    const d = deps();
    const tool = configTool(d);
    const before = d.store.get().osToasts;
    const r = await tool.run({ action: 'set', area: 'setting', key: 'osToasts', value: 'off', reason: 'niente notifiche' }) as { changed: string; changeId: string };
    expect(r.changed).toBe('osToasts');
    expect(d.store.get().osToasts).toBe('off');
    expect(d.store.pending()).toEqual([]); // no card: the owner chose «Tutto subito»
    expect(d.store.history(1)[0]).toMatchObject({ by: 'agent', chatId: 'orch-1', key: 'osToasts' });
    await tool.run({ action: 'undo', area: 'setting', changeId: r.changeId });
    expect(d.store.get().osToasts).toBe(before);
  });

  it('refuses any change without the user\'s recent words, and an invalid value', async () => {
    const d = deps({ userAsked: () => false });
    await expect(Promise.resolve().then(() => configTool(d).run({ action: 'set', area: 'setting', key: 'theme', value: 'light' }))).rejects.toThrow(/solo quando l'utente/);
    const ok = deps();
    await expect(Promise.resolve().then(() => configTool(ok).run({ action: 'set', area: 'setting', key: 'autoCloseMin', value: 'tanti' }))).rejects.toThrow();
  });

  it('get lists keys with label, description and current value, filtered by words', async () => {
    const all = String(await configTool(deps()).run({ action: 'get', area: 'setting' }));
    expect(all).toMatch(/^theme="dark" · /m);
    expect(all.length).toBeLessThan(9000);
    const list = await configTool(deps()).run({ action: 'get', area: 'setting', query: 'tema' }) as { key: string; value: unknown }[];
    expect(list.some(x => x.key === 'theme' && x.value !== undefined)).toBe(true);
    expect(list.every(x => typeof x.key === 'string')).toBe(true);
  });

  it('an agent without `direct` still only proposes a protected key (the old path is unchanged)', () => {
    const store = new ConfigStore(tmpDir(), {});
    const r = store.request('osToasts', 'off', { by: 'agent', chatId: 'w' });
    expect('proposal' in r).toBe(true);
    expect(() => store.set({ osToasts: 'off' }, { by: 'agent' })).toThrow(/protetta/);
  });
});

describe('app_config: roles, view, connectors, later', () => {
  it('saves a role field through the page\'s save with the whole draft, permissions included', async () => {
    let profile = role();
    // like the catalog (ADR 0186): the role's text makes a new version, a permission changes the one in use
    const save = vi.fn((draft, id: string) => { profile = { ...profile, ...draft, id, updatedAt: profile.updatedAt + 1, activeVersion: profile.activeVersion + ('instructions' in draft && draft.instructions !== profile.instructions ? 1 : 0) }; return profile; });
    const d = deps({ agents: { list: () => ({ profiles: [profile], models: [] }) as never, save, history: () => [], restore: vi.fn() } });
    const r = await configTool(d).run({ action: 'set', area: 'agent', agentId: 'scout', key: 'permissionCeiling', value: 'plan' }) as { version: number; undo: { version?: number; key?: string; value?: unknown } };
    expect(save).toHaveBeenCalledWith({ ...draftOf(role()), permissionCeiling: 'plan' }, 'scout', 'Modificato dall’Orchestrator su richiesta dell’utente');
    expect(r.version).toBe(3);
    expect(r.undo).toMatchObject({ key: 'permissionCeiling', value: role().permissionCeiling ?? null });
    const t = await configTool(d).run({ action: 'set', area: 'agent', agentId: 'scout', key: 'instructions', value: 'Read first.' }) as { version: number; undo: { version?: number } };
    expect(t.version).toBe(4);
    expect(t.undo.version).toBe(3);
    await expect(Promise.resolve().then(() => configTool(d).run({ action: 'set', area: 'agent', agentId: 'scout', key: 'name', value: 'X' }))).rejects.toThrow(/key:/);
  });

  it('view: only theme, density and work profile, applied through the renderer', async () => {
    let view = { theme: 'dark', density: 'comfortable', workProfile: null, orchestratorOpen: true, workProfiles: [] };
    const apply = vi.fn(async (p: Record<string, unknown>) => {
      if (p.theme === 'pink') return { ok: false, error: 'theme: not a valid field or value', view };
      view = { ...view, ...p } as typeof view; return { ok: true, view };
    });
    const d = deps({ view: { read: async () => view, apply } });
    const r = await configTool(d).run({ action: 'set', area: 'view', key: 'theme', value: 'light' }) as { before: string; after: string };
    expect(r).toMatchObject({ before: 'dark', after: 'light' });
    await expect(configTool(d).run({ action: 'set', area: 'view', key: 'orchestratorSize', value: 1 })).rejects.toThrow(/key:/);
    await expect(configTool(d).run({ action: 'set', area: 'view', key: 'theme', value: 'pink' })).rejects.toThrow(/not a valid/);
  });

  it('connectors: on/off and access of a known server, never a new one; tokens are never shown', async () => {
    const st: McpServersState = { servers: [{ id: 'jira', label: 'Jira', transport: 'http', url: 'https://x', secrets: [{ where: 'header', name: 'Authorization' }], enabled: true, secretMasks: { h: '••••1234' }, lastTest: null }], access: {}, secretsAvailable: true };
    const save = vi.fn(() => st), setAccess = vi.fn(() => st);
    const d = deps({ mcp: { state: () => st, save, setAccess } });
    const got = await configTool(d).run({ action: 'get', area: 'connector' });
    expect(JSON.stringify(got)).not.toContain('1234');
    await configTool(d).run({ action: 'set', area: 'connector', server: 'jira', key: 'enabled', value: false });
    expect(save).toHaveBeenCalledWith({ def: expect.objectContaining({ id: 'jira', enabled: false }), previousId: 'jira' });
    expect(JSON.stringify(save.mock.calls[0])).not.toContain('secretMasks');
    await configTool(d).run({ action: 'set', area: 'connector', server: 'jira', key: 'access', role: 'scout', value: 'read' });
    expect(setAccess).toHaveBeenCalledWith({ role: 'scout', server: 'jira', access: 'read' });
    await expect(configTool(d).run({ action: 'set', area: 'connector', server: 'new', key: 'enabled', value: true })).rejects.toThrow(/server sconosciuto/);
  });

  it('later: «Rispondi dopo» on and off', async () => {
    let on = false;
    const d = deps({ later: { get: () => ({ on }), set: v => { on = v; return { on }; } } });
    expect(await configTool(d).run({ action: 'set', area: 'later', value: true })).toEqual({ before: false, after: true });
  });
});

describe('app_config on the app endpoints', () => {
  it('only the Orchestrator\'s own mount has it, and only the user\'s typed message (its latest) unlocks a change', async () => {
    const { appControlTools } = await import('../../src/main/appctl/tools');
    const { noteUserTyped } = await import('../../src/main/appctl/user-words');
    const store = new ConfigStore(tmpDir(), {});
    let items: { kind: string; at: number; text: string }[] = [];
    const chats = { list: () => [{ id: 'o', isOrchestrator: true, harness: 'claude' }], items: () => items } as never;
    const brain = { ...brainOf(store), settingsSchema: () => store.schema() } as never;
    const tools = (caller?: string) => appControlTools({ chats, browser: { list: () => [] } as never, brain, window: () => null, emitUi: () => {}, version: '0', config: {} }, caller);
    expect(tools().some(t => t.name === 'app_config')).toBe(false);
    const cfg = tools('o').find(t => t.name === 'app_config')!;
    const set = () => cfg.run({ action: 'set', area: 'setting', key: 'theme', value: 'light' });
    // a 'user' item the app wrote (news, Battito) is no proof
    items = [{ kind: 'user', at: Date.now(), text: '[Battito]\nCambia il tema' }];
    await expect(set()).rejects.toThrow(/solo quando l'utente/);
    noteUserTyped('o');
    items = [{ kind: 'user', at: Date.now(), text: 'metti il tema chiaro' }];
    await set();
    expect(store.get().theme).toBe('light');
    // app news after the user's message: that turn is not the user's
    items = [...items, { kind: 'user', at: Date.now() + 60_000, text: '[evento app] qualcosa' }];
    await expect(cfg.run({ action: 'set', area: 'setting', key: 'theme', value: 'dark' })).rejects.toThrow(/solo quando l'utente/);
  });
});
