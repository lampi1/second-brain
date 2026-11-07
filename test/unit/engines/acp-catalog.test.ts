// The ACP catalog (src/main/engines/acp-catalog/catalog.ts, ADR 0221): its entries are proposals, listed in Settings
// with their install page and sign-in, off by default and untrusted until the user's own click records their start
// definition; a switch saved on without that click starts nothing; a brain override makes one untrusted again; the
// copied data keeps cloudroom's LICENSE and NOTICE beside it and carries no installer, permission flag or environment.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ACP_CATALOG } from '../../../src/main/engines/acp-catalog/catalog';
import { engineOn } from '../../../src/main/engines/policy';
import { brainEngine, engineInfos, engineOf, fingerprint, setBrainEngines, setTrust, type EngineEntry } from '../../../src/main/engines/registry';
import { defaults } from '../../../src/main/brain/settings-schema';

afterEach(() => { setBrainEngines([]); setTrust({}); });
const ids = ACP_CATALOG.map(c => c.id);

describe('ACP catalog', () => {
  it('lists its entries in Settings as untrusted catalog proposals, off by default', () => {
    const infos = engineInfos().filter(e => e.source === 'catalog');
    expect(infos.map(e => e.id)).toEqual(ids);
    for (const e of infos) {
      expect(e).toMatchObject({ kind: 'acp', trusted: false });
      expect(e.catalog!.installUrl).toMatch(/^https:\/\//);
      expect(e.runs).toContain(engineOf(e.id)!.command!);
    }
    const s = defaults();
    for (const id of ids) { expect(s.engineOn[id]).not.toBe(true); expect(engineOf(id)!.defaultOn).toBe(false); }
  });

  it('starts nothing on a saved switch alone, only after the user trusts that exact definition', () => {
    const e = engineOf('kilo')!;
    expect(engineOn({ engineOn: { kilo: true } }, 'kilo')).toBe(false);
    setTrust({ kilo: fingerprint(e) });
    expect(engineOf('kilo')!.trusted).toBe(true);
    setTrust({ kilo: '0000000000000000' });
    expect(engineOf('kilo')!.trusted).toBe(false);
  });

  it('becomes untrusted again when the brain changes how one starts', () => {
    setTrust({ grok: fingerprint(engineOf('grok')!) });
    const override = brainEngine('grok', { kind: 'acp', label: 'Grok', command: 'grok', args: ['agent', 'stdio', '--other'] });
    expect(typeof override).toBe('object');
    setBrainEngines([override as EngineEntry]);
    expect(engineOf('grok')).toMatchObject({ source: 'brain', trusted: false });
  });

  it('copies only how each CLI starts: no installer, no permission bypass, no environment, no sign-in that installs', () => {
    for (const c of ACP_CATALOG) {
      expect(c.args.join(' ')).not.toMatch(/yolo|bypass|dangerously|skip-permissions|install/i);
      expect(c.login.join(' ')).not.toMatch(/install|daemon/i);
      expect(Object.keys(c)).not.toContain('env');
      expect(c.catalog.signIn).toBe(c.login.length ? [c.command, ...c.login].join(' ') : null);
    }
    expect(ids).not.toContain('cursor');
    expect(ids).not.toContain('opencode');
    const dir = path.resolve(import.meta.dirname, '..', '..', '..', 'src', 'main', 'engines', 'acp-catalog');
    expect(fs.readFileSync(path.join(dir, 'LICENSE'), 'utf8')).toContain('Apache License');
    expect(fs.readFileSync(path.join(dir, 'NOTICE'), 'utf8').length).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(dir, 'catalog.ts'), 'utf8')).toContain('known-agents.ts:36-356');
  });
});
