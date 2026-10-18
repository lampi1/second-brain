// The engines the brain defines and the user's trust in them (ADR 0046): models.json entries validated
// (registry.ts brainEngine, brain/engines.ts), and an engine that is not built in starts only while its definition is
// the one the user turned on (trust.ts, policy.ts engineOn): an agent editing models.json cannot make the app run
// another program or send a key to another host.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrainEngines } from '../../../src/main/brain/engines';
import { engineOn } from '../../../src/main/engines/policy';
import { brainEngine, engineOf, engines, fingerprint, safeBaseUrl, setBrainEngines, setTrust } from '../../../src/main/engines/registry';
import { EngineTrust } from '../../../src/main/engines/trust';
import { withApiModels } from '../../../src/main/engines/sessions';
import { setPriceTable } from '../../../src/main/chats/live-cost';
import { log } from '../../../src/main/log';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-trust-'));
const on = { engineOn: { claude: true, cursor: true, codex: true, anthropic: true, local: true } };
afterEach(() => { setBrainEngines([]); setTrust({}); });

describe('brainEngine', () => {
  it('takes an ACP CLI and an HTTP endpoint', () => {
    expect(brainEngine('qwen', { kind: 'acp', label: 'Qwen', command: 'qwen', args: ['--acp'], keyEnv: 'DASHSCOPE_API_KEY' }))
      .toEqual({ id: 'qwen', label: 'Qwen', name: 'Qwen', kind: 'acp', command: 'qwen', args: ['--acp'], keyEnv: 'DASHSCOPE_API_KEY', login: [], defaultOn: false });
    expect(brainEngine('local', { kind: 'api', label: 'Locale', baseUrl: 'http://127.0.0.1:11434/v1/', protocol: 'openai' }))
      .toMatchObject({ kind: 'api', baseUrl: 'http://127.0.0.1:11434/v1', protocol: 'openai' });
  });

  it('may change a preset, never a built-in', () => {
    expect(brainEngine('kimi', { kind: 'acp', command: 'kimi' })).toMatch(/ignorata/);
    expect(brainEngine('claude', { kind: 'acp', label: 'X', command: 'x' })).toMatch(/incorporato/);
    expect(brainEngine('cursor', { kind: 'acp', label: 'X', command: 'x' })).toMatch(/incorporato/);
  });

  it('refuses what could run something else or leak a key', () => {
    const acp = { kind: 'acp', label: 'X', command: 'x' };
    expect(brainEngine('x', { ...acp, command: 'x & calc' })).toMatch(/command/);
    expect(brainEngine('x', { ...acp, command: 'C:\\a\\b.exe" & calc' })).toMatch(/command/);
    expect(brainEngine('x', { ...acp, args: ['--acp', '$(rm)'] })).toMatch(/args/);
    expect(brainEngine('x', { ...acp, keyEnv: 'PATH' })).toMatch(/keyEnv/);
    expect(brainEngine('x', { ...acp, keyEnv: 'NODE_OPTIONS' })).toMatch(/keyEnv/);
    expect(brainEngine('x', { ...acp, modelFlag: '--model;x' })).toMatch(/modelFlag/);
    expect(brainEngine('x', { kind: 'api', label: 'X', baseUrl: 'http://example.com/v1', protocol: 'openai' })).toMatch(/baseUrl/);
    expect(brainEngine('x', { kind: 'api', label: 'X', baseUrl: 'https://example.com/v1', protocol: 'grpc' })).toMatch(/protocol/);
    expect(brainEngine('X!', acp)).toMatch(/id/);
    expect(brainEngine('x', { kind: 'shell', label: 'X' })).toMatch(/kind/);
    expect(brainEngine('x', [acp])).toMatch(/oggetto/);
  });

  it('safeBaseUrl: https anywhere, http only here, no credentials or query', () => {
    expect(safeBaseUrl('https://api.example.com/v1/')).toBe('https://api.example.com/v1');
    expect(safeBaseUrl('http://localhost:8080')).toBe('http://localhost:8080');
    for (const bad of ['http://example.com/v1', 'https://u:p@localhost', 'https://x.com/?k=1', 'https://x.com/#a', 'file:///c:/x', 'nope', 42]) expect(safeBaseUrl(bad)).toBeNull();
  });
});

describe('trust', () => {

  it('a preset is off until the user turns it on; built-ins never need it', () => {
    expect(engineOn(on, 'claude')).toBe(true);
    expect(engineOn(on, 'anthropic')).toBe(false);
    expect(engineOf('anthropic')?.trusted).toBe(false);
    const t = new EngineTrust(tmp());
    t.onSetting({ key: 'engineOn.anthropic', after: true, by: 'agent' });
    expect(engineOn(on, 'anthropic')).toBe(false);
    t.onSetting({ key: 'engineOn.anthropic', after: true, by: 'user' });
    expect(engineOn(on, 'anthropic')).toBe(true);
  });

  it('a changed definition stops the engine until the user turns it on again; the trust survives a restart', () => {
    const d = tmp();
    const local = brainEngine('local', { kind: 'api', label: 'Locale', baseUrl: 'http://127.0.0.1:11434/v1', protocol: 'openai' });
    if (typeof local === 'string') throw new Error(local);
    setBrainEngines([local]);
    new EngineTrust(d).record('local');
    expect(engineOn(on, 'local')).toBe(true);
    setTrust({});
    new EngineTrust(d); // reloaded from engine-trust.json
    expect(engineOn(on, 'local')).toBe(true);
    setBrainEngines([{ ...local, baseUrl: 'https://elsewhere.example.com/v1' }]);
    expect(engineOn(on, 'local')).toBe(false);
    expect(engineOf('local')?.trusted).toBe(false);
    expect(fingerprint(engineOf('local')!)).not.toBe(fingerprint(local));
  });

  it('a changed login command untrusts the engine too (the user sees it in «Avvio»)', () => {
    const npx = brainEngine('adapter', { kind: 'acp', label: 'Adapter', command: 'npx', args: ['some-acp'] });
    if (typeof npx === 'string') throw new Error(npx);
    setBrainEngines([npx]);
    new EngineTrust(tmp()).record('adapter');
    expect(engineOf('adapter')?.trusted).toBe(true);
    setBrainEngines([{ ...npx, login: ['-y', 'other-pkg'] }]);
    expect(engineOf('adapter')?.trusted).toBe(false);
    expect(engineOf('adapter')?.runs).toBe('npx some-acp · accesso: npx -y other-pkg');
  });

  it('an unreadable or tampered trust file trusts nothing', () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'engine-trust.json'), JSON.stringify({ anthropic: 'not-a-fingerprint', '../x': '0123456789abcdef' }));
    new EngineTrust(d);
    expect(engineOf('anthropic')?.trusted).toBe(false);
    fs.writeFileSync(path.join(d, 'engine-trust.json'), '{');
    new EngineTrust(d);
    expect(engineOn(on, 'anthropic')).toBe(false);
  });
});

describe('BrainEngines', () => {
  it('reads harness/models.json engines, leaves invalid ones out, follows the file', () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, 'harness'));
    const f = path.join(root, 'harness', 'models.json');
    fs.writeFileSync(f, JSON.stringify({ harnesses: {}, engines: { qwen: { kind: 'acp', label: 'Qwen', command: 'qwen', args: ['--acp'] }, bad: { kind: 'acp', label: 'B', command: 'a|b' } } }));
    const b = new BrainEngines(() => root);
    b.refresh();
    expect(engines().map(e => e.id)).toEqual(['claude', 'cursor', 'codex', 'anthropic', 'qwen']);
    expect(engineOf('qwen')).toMatchObject({ source: 'brain', runs: 'qwen --acp', key: 'none', trusted: false });
    fs.writeFileSync(f, JSON.stringify({ engines: {} }));
    fs.utimesSync(f, new Date(), new Date(Date.now() + 5000));
    b.refresh();
    expect(engineOf('qwen')).toBeNull();
  });

  it('a gemini entry (an engine the app removed, ADR 0046) is ignored and logged once, even a complete one', () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, 'harness'));
    const f = path.join(root, 'harness', 'models.json');
    fs.writeFileSync(f, JSON.stringify({ engines: { gemini: { kind: 'acp', label: 'Gemini', command: 'gemini', args: ['--acp'], keyEnv: 'GEMINI_API_KEY' } } }));
    const warn = vi.spyOn(log, 'warn');
    try {
      const b = new BrainEngines(() => root);
      b.refresh();
      expect(engineOf('gemini')).toBeNull();
      fs.utimesSync(f, new Date(), new Date(Date.now() + 5000));
      b.refresh();
      expect(engineOf('gemini')).toBeNull();
      const left = warn.mock.calls.filter(c => c[1] === 'engine of the brain left out');
      expect(left).toHaveLength(1);
      expect(left[0]![2]).toMatchObject({ data: { engine: 'gemini', why: 'motore tolto dall’app: la voce è ignorata' } });
    } finally { warn.mockRestore(); }
  });

  it('no brain, no file or bad JSON: only the app engines', () => {
    new BrainEngines(() => null).refresh();
    expect(engines()).toHaveLength(4);
    const root = tmp();
    fs.mkdirSync(path.join(root, 'harness'));
    fs.writeFileSync(path.join(root, 'harness', 'models.json'), '{');
    new BrainEngines(() => root).refresh();
    expect(engines()).toHaveLength(4);
  });
});

describe('the models of an HTTP engine', () => {
  it('come from the brain\'s table when its CLI-less engine listed none; a CLI\'s own list stays', () => {
    const local = brainEngine('local', { kind: 'api', label: 'Locale', baseUrl: 'http://127.0.0.1:11434/v1', protocol: 'openai' });
    if (typeof local === 'string') throw new Error(local);
    setBrainEngines([local]);
    const row = (id: string, harness: string) => ({ id, harness, provider: 'x', routing: 'manual', price: { input: 1, cacheWrite5m: 1, cacheWrite1h: 1, cacheRead: 0.1, output: 2 }, efforts: [], defaultEffort: null });
    setPriceTable(() => ({ models: [row('qwen3', 'local'), row('opus', 'claude')] }) as never);
    try {
      const cursor = { ids: [{ id: 'gpt-5', name: 'GPT-5' }], at: 1 };
      expect(withApiModels({ cursor })).toEqual({ cursor, claude: { ids: [{ id: 'opus', name: 'opus' }], at: 0 }, anthropic: { ids: [{ id: 'opus', name: 'opus' }], at: 0 }, local: { ids: [{ id: 'qwen3', name: 'qwen3' }], at: 0 } });
      // Claude Code lists no models (#60): its table rows stand in, but a list it did report stays
      const seen = { ids: [{ id: 'claude-sonnet-5-5', name: 'Sonnet' }], at: 2 };
      expect(withApiModels({ claude: seen }).claude).toEqual(seen);
    } finally { setPriceTable(() => null); }
  });
});
