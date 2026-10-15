// Settings as data (src/main/brain/settings-schema.ts + config.ts): schema, validate(), save/load, env locks, change
// log order, undo, agents limited to non-protected keys (protected ones become proposals the user confirms).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ConfigStore, DEFAULTS, applyPatch, fromSaved } from '../../../src/main/brain/config';
import { schema, defOf, flattenPatch, validate } from '../../../src/main/brain/settings-schema';
import type { SettingChange } from '../../../src/shared/contract';
import { tmpDir } from './helpers';

describe('settings schema and validate()', () => {
  it('every key has a type, a default that passes validate(), an Italian label and description', () => {
    for (const d of schema()) {
      expect(d.label.length, d.key).toBeGreaterThan(2);
      expect(d.description.length, d.key).toBeGreaterThan(10);
      const key = d.key === 'mute.*' ? 'mute.idea' : d.key;
      expect(validate(key, d.default).ok, d.key).toBe(true);
    }
  });

  it('protects engines, spending limits, notifications off and security keys; view and theme are free', () => {
    const prot = schema().filter(d => d.protected).map(d => d.key);
    for (const k of ['engineOn.claude', 'engineOn.cursor', 'engines.claude', 'engines.cursor', 'messaging.crossHarness', 'budget.enabled', 'budget.claude.dailyUsd', 'budget.cursor.mode', 'osToasts', 'dnd', 'mute.*', 'brainRoot', 'mcpPort'])
      expect(prot, k).toContain(k);
    expect(defOf('view')!.protected).toBe(false);
    expect(defOf('devops.enabled')!.protected).toBe(true);
    expect(validate('devops.everyMin', 2).ok).toBe(false);
    expect(validate('devops.everyMin', 60).ok).toBe(true);
    expect(defOf('theme')!.protected).toBe(false);
    expect(defOf('mute.chat-done')!.key).toBe('mute.*');
  });

  it('accepts and normalizes good values, refuses bad ones with an Italian message', () => {
    expect(validate('budget.claude.dailyUsd', 199.999)).toMatchObject({ ok: true, value: 200 });
    expect(validate('budget.claude.dailyUsd', null)).toMatchObject({ ok: true, value: null });
    expect(validate('view', 'corsie')).toMatchObject({ ok: true });
    const bad: [string, unknown][] = [
      ['brainRoot', 'relative/path'], ['mcpPort', 70000], ['mcpPort', 1.5], ['view', 'grid'], ['osToasts', 'always'], ['dnd', 'yes'],
      ['mute.idea', 'yes'], ['mute.Bad Kind', true], ['budget.claude.mode', 'stop'], ['budget.claude.dailyUsd', -1], ['budget.enabled', 1],
      ['theme', null], ['nope', 1], ['engines.claude', 'on'],
    ];
    for (const [k, v] of bad) {
      const r = validate(k, v);
      expect(r.ok, `${k}=${JSON.stringify(v)}`).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/[a-zà-ù]/i);
    }
    expect(() => applyPatch(DEFAULTS, { budget: { claude: { dailyUsd: -5 } } })).toThrow(/da 0,01/);
    // rounded to cents before the check: 0.004 is not a 0 $ limit (0 = no limit)
    expect(validate('budget.claude.dailyUsd', 0.004).ok).toBe(false);
    expect(validate('budget.claude.dailyUsd', 0.005)).toMatchObject({ ok: true, value: 0.01 });
    expect(validate('budget.claude.dailyUsd', 1e6 + 1).ok).toBe(false);
    expect(() => applyPatch(DEFAULTS, { colour: 'red' } as never)).toThrow(/sconosciuta/);
  });
});

describe('flattenPatch', () => {
  it('turns the nested UI patch of every group into dot keys (the engines and chats across engines too)', () => {
    expect(flattenPatch({ messaging: { crossHarness: false }, engineOn: { cursor: false }, engines: { cursor: false }, view: 'corsie' }))
      .toEqual([['messaging.crossHarness', false], ['engineOn.cursor', false], ['engines.cursor', false], ['view', 'corsie']]);
    expect(flattenPatch({ regiaChats: { harness: 'cursor', cursorModel: 'grok-4.7' } }))
      .toEqual([['regiaChats.harness', 'cursor'], ['regiaChats.cursorModel', 'grok-4.7']]);
  });
});

describe('"Domande alla Regia" removed (the user, 2026-10-13)', () => {
  it('a config from before the engine switches keeps its keys and meaning; every engine starts on', () => {
    // the user's real file: the Regie may not use Cursor, chats across engines on (older releases read the same keys)
    expect(fromSaved({ messaging: { crossHarness: true }, engines: { claude: true, cursor: false } })).toMatchObject({
      engineOn: { claude: true, cursor: true }, engines: { claude: true, cursor: false }, messaging: { crossHarness: true } });
  });

  it('an older config with regiaDriven loads without it; the key is no setting any more', () => {
    expect('regiaDriven' in DEFAULTS).toBe(false);
    expect(defOf('regiaDriven' as never)).toBeNull();
    expect('regiaDriven' in fromSaved({ view: 'corsie', regiaDriven: false })).toBe(false);
    expect(fromSaved({ view: 'corsie', regiaDriven: false }).view).toBe('corsie');
  });
});

describe('engine switches (ADR 0046)', () => {
  it('an engine switched off closes «Le Regie possono usare» too, by the same hand, events in order; on again leaves it closed', () => {
    const dir = tmpDir();
    const store = new ConfigStore(dir, {});
    const seen: string[] = [];
    store.onChange((c, now) => seen.push(`${c.key}=${String(c.after)} by ${c.by} (engines.cursor ${String(now.engines.cursor)})`));
    store.set({ engineOn: { cursor: false } });
    expect(seen).toEqual(['engineOn.cursor=false by user (engines.cursor true)', 'engines.cursor=false by user (engines.cursor false)']);
    // the key an older release reads is in the file
    expect(new ConfigStore(dir, {}).get()).toMatchObject({ engineOn: { cursor: false }, engines: { cursor: false } });
    store.set({ engineOn: { cursor: true } });
    expect(store.get()).toMatchObject({ engineOn: { cursor: true }, engines: { cursor: false } });
  });

  it('every engine of the registry has its protected switches; a new one ships off; an id from a later brain survives a restart', () => {
    for (const k of ['engineOn.kimi', 'engines.anthropic', 'engineOn.qwen-2']) expect(defOf(k)?.protected, k).toBe(true);
    for (const k of ['engineOn.Kimi', 'engines.../x', 'engineOn.']) expect(defOf(k), k).toBeNull();
    expect(DEFAULTS.engineOn).toMatchObject({ claude: true, cursor: true, kimi: false, anthropic: false });
    expect(DEFAULTS.engineOn).not.toHaveProperty('gemini');
    expect(validate('engineOn.kimi', 'yes').ok).toBe(false);
    // an engine the brain defines after the settings were loaded: its saved switch is kept
    expect(fromSaved({ engineOn: { qwen: true, 'Bad id': true }, engines: { qwen: false } })).toMatchObject({ engineOn: { qwen: true }, engines: { qwen: false } });
    expect(fromSaved({ engineOn: { 'Bad id': true } }).engineOn).not.toHaveProperty('Bad id');
    // the Regia's engine too: Settings and "Nuova chat" do not fall back to Claude on a restart
    expect(fromSaved({ regiaChats: { harness: 'qwen' } }).regiaChats.harness).toBe('qwen');
    expect(fromSaved({ regiaChats: { harness: '../x' } }).regiaChats.harness).toBe('claude');
    // Gemini, removed from the app (ADR 0046): a config saved by an older release loads without it, the Regia back on Claude
    const old = fromSaved({ engineOn: { gemini: true, kimi: true }, engines: { gemini: true }, regiaChats: { harness: 'gemini' } });
    expect(old.engineOn).not.toHaveProperty('gemini');
    expect(old.engines).not.toHaveProperty('gemini');
    expect(old.engineOn.kimi).toBe(true);
    expect(old.regiaChats.harness).toBe('claude');
  });
});

describe('Chat aperte dalla Regia (regiaChats)', () => {
  it('protected keys (engine and model choose whose credits are spent), CLI defaults by default', () => {
    for (const k of ['regiaChats.harness', 'regiaChats.claudeModel', 'regiaChats.claudeEffort', 'regiaChats.cursorModel']) expect(defOf(k)!.protected, k).toBe(true);
    expect(DEFAULTS.regiaChats).toEqual({ harness: 'claude', claudeModel: '', cursorModel: '', claudeEffort: '', cursorReasoning: 'medium', cursorFast: false });
  });
  it('model ids as the CLIs take them, trimmed; nothing that could become a CLI flag or a path', () => {
    expect(validate('regiaChats.cursorModel', ' grok-4.7 ')).toMatchObject({ ok: true, value: 'grok-4.7' });
    expect(validate('regiaChats.cursorModel', 'gpt-5.6-sol[effort=high]')).toMatchObject({ ok: true });
    expect(validate('regiaChats.claudeModel', '')).toMatchObject({ ok: true, value: '' });
    for (const v of ['grok 4.7', 'a;b', '"x"', 'x'.repeat(121), 7, null]) expect(validate('regiaChats.claudeModel', v).ok, String(v)).toBe(false);
    expect(validate('regiaChats.claudeEffort', 'xhigh')).toMatchObject({ ok: true });
    expect(validate('regiaChats.claudeEffort', 'huge').ok).toBe(false);
    expect(validate('regiaChats.harness', 'codex').ok).toBe(false);
  });
  it('a config saved before this setting gets the defaults; a saved choice survives a restart', () => {
    expect(fromSaved({ view: 'corsie' }).regiaChats).toEqual(DEFAULTS.regiaChats);
    const dir = tmpDir();
    new ConfigStore(dir, {}).set({ regiaChats: { harness: 'cursor', cursorModel: 'grok-4.7', claudeEffort: 'high' } });
    expect(new ConfigStore(dir, {}).get().regiaChats).toEqual({ harness: 'cursor', claudeModel: '', cursorModel: 'grok-4.7', claudeEffort: 'high', cursorReasoning: 'medium', cursorFast: false });
  });
});

describe('settings store', () => {
  it('starts from generic defaults (no personal numbers, $ limits off, budget on in warn mode, engines on)', () => {
    const s = new ConfigStore(tmpDir(), {}).get();
    expect(s).toMatchObject({ brainRoot: null, mcpPort: 4319, view: 'mosaico', osToasts: 'urgent', theme: 'dark', dnd: false, mute: {}, engines: { claude: true, cursor: true } });
    expect(s.budget).toEqual({ enabled: true, claude: { mode: 'warn', dailyUsd: null, perChatUsd: null }, cursor: { mode: 'warn', dailyUsd: null, perChatUsd: null } });
    expect(s.locked).toBeUndefined();
    expect(s.devops).toEqual({ enabled: false, everyMin: 30, sound: true }); // DevOps reads only when the user turns it on; its alerts chime
  });

  it('saves a patch, reloads it, merges budget and mutes key by key; all-or-none on a bad key', () => {
    const dir = tmpDir();
    const a = new ConfigStore(dir, {});
    const brain = path.join(dir, 'brain');
    a.set({ brainRoot: brain, view: 'corsie', mute: { idea: true }, budget: { claude: { dailyUsd: 200 } } });
    a.set({ mute: { error: true }, budget: { cursor: { mode: 'ask', perChatUsd: 5 } } });
    expect(() => a.set({ theme: 'light', view: 'grid' as never })).toThrow();
    const b = new ConfigStore(dir, {}).get();
    expect(b.brainRoot).toBe(path.normalize(brain));
    expect(b.view).toBe('corsie');
    expect(b.theme).toBe('dark'); // the bad patch changed nothing
    expect(b.mute).toEqual({ idea: true, error: true });
    expect(b.budget.claude).toEqual({ mode: 'warn', dailyUsd: 200, perChatUsd: null });
    expect(b.budget.cursor).toEqual({ mode: 'ask', dailyUsd: null, perChatUsd: 5 });
    a.set({ mute: { idea: false } });
    expect(new ConfigStore(dir, {}).get().mute).toEqual({ error: true });
  });

  it('env overrides (SB_BRAIN, SB_MCP_PORT) are effective and locked, never written to config.json', () => {
    const dir = tmpDir();
    const env = { SB_BRAIN: path.join(dir, 'env-brain'), SB_MCP_PORT: '0' };
    const c = new ConfigStore(dir, env);
    expect(c.get()).toMatchObject({ brainRoot: path.normalize(env.SB_BRAIN), mcpPort: 0, locked: ['brainRoot', 'mcpPort'] });
    expect(() => c.set({ brainRoot: path.join(dir, 'other') })).toThrow(/SB_BRAIN/);
    c.set({ theme: 'light' });
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
    expect(saved).toMatchObject({ brainRoot: null, mcpPort: 4319, theme: 'light' });
    expect(saved.locked).toBeUndefined();
  });

  it('a broken or partly wrong file falls back to the defaults per key', () => {
    expect(fromSaved('nonsense')).toEqual(DEFAULTS);
    const s = fromSaved({ view: 'grid', theme: 'light', mcpPort: 'x', budget: { enabled: false, claude: { mode: 'nope', dailyUsd: 50 } }, mute: { idea: true, 'Bad Kind': true } });
    expect(s).toMatchObject({ view: 'mosaico', theme: 'light', mcpPort: 4319, mute: { idea: true } });
    expect(s.budget.enabled).toBe(false);
    expect(s.budget.claude).toEqual({ mode: 'warn', dailyUsd: 50, perChatUsd: null });
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'config.json'), '{ not json');
    expect(new ConfigStore(dir, {}).get().brainRoot).toBeNull();
  });

  it('logs every change with who made it; history is newest first and survives a restart', () => {
    const dir = tmpDir();
    const c = new ConfigStore(dir, {});
    c.set({ view: 'corsie' });
    c.request('theme', 'light', { by: 'agent', chatId: 'chat-7' });
    c.set({ theme: 'light' }); // same value: not a change
    const h = new ConfigStore(dir, {}).history();
    expect(h.map(x => [x.key, x.by, x.before, x.after])).toEqual([['theme', 'agent', 'dark', 'light'], ['view', 'user', 'mosaico', 'corsie']]);
    expect(h[0]!.chatId).toBe('chat-7');
  });

  it('undo restores the value before, as a new change; the original is marked undone (also after a restart)', () => {
    const dir = tmpDir();
    const c = new ConfigStore(dir, {});
    const seen: SettingChange[] = [];
    c.onChange(ch => seen.push(ch));
    const r = c.request('view', 'corsie', { by: 'agent', chatId: 'c1' });
    expect('applied' in r).toBe(true);
    const id = (r as { applied: SettingChange }).applied.id;
    const u = c.undo(id);
    expect(u).toMatchObject({ key: 'view', before: 'corsie', after: 'mosaico', by: 'user', undoOf: id });
    expect(c.get().view).toBe('mosaico');
    expect(seen.map(x => x.after)).toEqual(['corsie', 'mosaico']);
    expect(() => c.undo(id)).toThrow(/già annullata/);
    const again = new ConfigStore(dir, {});
    expect(again.get().view).toBe('mosaico');
    expect(again.history().find(x => x.id === id)?.undone).toBe(true);
  });

  it('a save that fails changes nothing: the value stays, no event, the proposal stays pending', () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, 'config.json')); // a folder where the file should be: every write fails
    const c = new ConfigStore(dir, {});
    let events = 0;
    c.onChange(() => events++);
    expect(() => c.set({ view: 'corsie' })).toThrow();
    expect(c.get().view).toBe('mosaico');
    const r = c.request('dnd', true, { by: 'agent' }) as { proposal: { id: string } };
    expect(() => c.confirm(r.proposal.id, true)).toThrow();
    expect(c.get().dnd).toBe(false);
    expect(c.pending().map(p => p.id)).toEqual([r.proposal.id]);
    expect(events).toBe(0);
    expect(c.history()).toEqual([]);
  });

  it('agents change non-protected keys directly, but protected keys only as a proposal the user confirms', () => {
    const c = new ConfigStore(tmpDir(), {});
    const proposals: string[] = [];
    c.onProposal(p => proposals.push(`${p.key}:${p.status}`));
    // refused as a direct change
    expect(() => c.set({ dnd: true }, { by: 'agent' })).toThrow(/protetta/);
    const r = c.request('budget.claude.dailyUsd', 150, { by: 'agent', chatId: 'c9', reason: "l'utente ha chiesto 150 $" });
    expect('proposal' in r).toBe(true);
    const p = (r as { proposal: { id: string; before: unknown; after: unknown; label: string } }).proposal;
    expect(p).toMatchObject({ before: null, after: 150 });
    expect(p.label).toMatch(/Limite Claude/);
    expect(c.get().budget.claude.dailyUsd).toBeNull(); // nothing applied yet
    expect(c.pending().map(x => x.id)).toEqual([p.id]);
    const ch = c.confirm(p.id, true)!;
    expect(ch).toMatchObject({ key: 'budget.claude.dailyUsd', after: 150, by: 'user', proposalId: p.id, chatId: 'c9' });
    expect(c.get().budget.claude.dailyUsd).toBe(150);
    expect(c.pending()).toEqual([]);
    expect(() => c.confirm(p.id, true)).toThrow(/già decisa/);
    // a rejected proposal changes nothing; an agent cannot undo a protected change either
    const r2 = c.request('engines.cursor', false, { by: 'agent' }) as { proposal: { id: string } };
    expect(c.confirm(r2.proposal.id, false)).toBeNull();
    expect(c.get().engines.cursor).toBe(true);
    expect(() => c.undo(ch.id, { by: 'agent' })).toThrow(/solo l'utente/);
    expect(proposals).toEqual(['budget.claude.dailyUsd:pending', 'budget.claude.dailyUsd:accepted', 'engines.cursor:pending', 'engines.cursor:rejected']);
    // invalid values are refused before any proposal
    expect(c.request('budget.claude.dailyUsd', 'tanti', { by: 'agent' })).toMatchObject({ error: expect.stringMatching(/importo/) });
    // the user changes protected keys directly
    expect('applied' in c.request('dnd', true, { by: 'user' })).toBe(true);
  });

  it('reads change logs written before the rename to "user": the old value of the user\'s changes becomes "user"', () => {
    const dir = tmpDir();
    const legacy = ['dav', 'ide'].join(''); // the value logged for the user's own changes before the rename
    fs.writeFileSync(path.join(dir, 'changes.jsonl'), [
      JSON.stringify({ id: 'chg_old1', at: 1, by: legacy, key: 'view', before: 'mosaico', after: 'corsie' }),
      JSON.stringify({ id: 'chg_old2', at: 2, by: 'agent', key: 'theme', before: 'dark', after: 'light', chatId: 'c1' }),
    ].join('\n') + '\n');
    const c = new ConfigStore(dir, {});
    expect(c.history().map(x => [x.id, x.by])).toEqual([['chg_old2', 'agent'], ['chg_old1', 'user']]);
    // an old change can still be undone; the undo and the re-saved original are logged with the new value
    expect(c.undo('chg_old1')).toMatchObject({ by: 'user', undoOf: 'chg_old1', after: 'mosaico' });
    const again = new ConfigStore(dir, {}).history();
    expect(again.find(x => x.id === 'chg_old1')).toMatchObject({ by: 'user', undone: true });
    expect(again.every(x => x.by === 'user' || x.by === 'agent')).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'changes.jsonl'), 'utf8').split('\n').filter(Boolean).slice(2).some(l => l.includes(legacy))).toBe(false);
  });
});

describe('compaction window 300k → 200k (ADR 0051)', () => {
  it('a saved 300000 nobody set follows the new default; a value the user set stays; a new install gets 200000', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ ...DEFAULTS, compactWindowTokens: 300_000 }));
    expect(new ConfigStore(dir, {}).get().compactWindowTokens).toBe(200_000);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')).compactWindowTokens).toBe(200_000);
    // the user sets 300000 again: it stays across restarts
    new ConfigStore(dir, {}).set({ compactWindowTokens: 300_000 });
    expect(new ConfigStore(dir, {}).get().compactWindowTokens).toBe(300_000);
    // once per userData: a choice that has left the change log (it keeps only its last entries) is not undone
    fs.rmSync(path.join(dir, 'changes.jsonl'));
    expect(new ConfigStore(dir, {}).get().compactWindowTokens).toBe(300_000);
    expect(new ConfigStore(tmpDir(), {}).get()).toMatchObject({ compactWindowTokens: 200_000, regiaDayCompact: true });
  });
});
