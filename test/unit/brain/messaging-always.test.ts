// Regression coverage for retired cross-engine messaging settings: legacy values never close the transport,
// while engine availability, trust and protected actions retain their existing checks. Used by Vitest.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ConfigStore, fromSaved } from '../../../src/main/brain/config';
import { defOf, schema } from '../../../src/main/brain/settings-schema';
import { crossRefusal, openRefusal } from '../../../src/main/engines/policy';
import { tmpDir } from './helpers';

describe('cross-engine messaging is always available', () => {
  it('ignores a legacy false without enabling engines or granting agent access', () => {
    const settings = fromSaved({ messaging: { crossHarness: false }, engineOn: { cursor: false }, engines: { cursor: false } });
    expect(settings.messaging.crossHarness).toBe(true);
    expect(settings.engineOn.cursor).toBe(false);
    expect(settings.engines.cursor).toBe(false);
    expect(crossRefusal(settings, 'claude', 'cursor')).toBeNull();
    expect(openRefusal(settings, 'claude', 'cursor')).toMatch(/Cursor è spento/);
  });

  it('does not offer the retired switch to the UI or to agents', () => {
    expect(defOf('messaging.crossHarness')).toBeNull();
    expect(schema().some(d => d.key === 'messaging.crossHarness')).toBe(false);
    const store = new ConfigStore(tmpDir(), {});
    expect(() => store.set({ messaging: { crossHarness: false } })).toThrow(/sconosciuta/);
    expect(store.request('messaging.crossHarness', false, { by: 'agent' })).toHaveProperty('error');
    expect(store.pending()).toHaveLength(0);
  });

  it('persists the migration once and preserves engine choices and domains', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'config.json');
    const domain = path.resolve('work');
    fs.writeFileSync(file, JSON.stringify({ messaging: { crossHarness: false }, engineOn: { cursor: false }, engines: { cursor: false }, domains: [domain] }));
    const store = new ConfigStore(dir, {});
    expect(store.get().messaging.crossHarness).toBe(true);
    const saved = fs.readFileSync(file, 'utf8');
    expect(JSON.parse(saved)).toMatchObject({ messaging: { crossHarness: true }, engineOn: { cursor: false }, engines: { cursor: false }, domains: [domain] });
    expect(new ConfigStore(dir, {}).get().messaging.crossHarness).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe(saved);
  });

  it('accepts both directions even when an old caller still supplies false', () => {
    const settings = fromSaved(null);
    settings.messaging.crossHarness = false;
    expect(crossRefusal(settings, 'claude', 'cursor')).toBeNull();
    expect(crossRefusal(settings, 'cursor', 'claude')).toBeNull();
  });
});
