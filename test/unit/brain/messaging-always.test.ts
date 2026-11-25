// The retired cross-engine messaging switch (messaging.crossHarness, ADR 0065) is gone (ADR 0352): an old value never
// closes the transport, is no setting, and leaves config.json once while engine choices stay. Used by Vitest.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ConfigStore, fromSaved } from '../../../src/main/brain/config';
import { defOf, schema } from '../../../src/main/brain/settings-schema';
import { openRefusal } from '../../../src/main/engines/policy';
import { tmpDir } from './helpers';

describe('the retired cross-engine messaging switch', () => {
  it('an old false neither enables engines nor refuses one', () => {
    const settings = fromSaved({ messaging: { crossHarness: false }, engineOn: { cursor: false }, engines: { cursor: false } });
    expect('messaging' in settings).toBe(false);
    expect(settings.engineOn.cursor).toBe(false);
    expect(openRefusal(settings, 'cursor')).toMatch(/Cursor è spento/);
    expect(openRefusal(settings, 'claude')).toBeNull();
  });

  it('is no setting for the UI or for agents', () => {
    expect(defOf('messaging.crossHarness')).toBeNull();
    expect(schema().some(d => d.key.startsWith('messaging'))).toBe(false);
    const store = new ConfigStore(tmpDir(), {});
    expect(() => store.set({ messaging: { crossHarness: false } } as never)).toThrow(/sconosciuta/);
    expect(store.request('messaging.crossHarness', false, { by: 'agent' })).toHaveProperty('error');
    expect(store.pending()).toHaveLength(0);
  });

  it('leaves config.json once, keeping engine choices and domains', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'config.json');
    const domain = path.resolve('work');
    fs.writeFileSync(file, JSON.stringify({ messaging: { crossHarness: false }, engineOn: { cursor: false }, engines: { cursor: false }, domains: [domain] }));
    new ConfigStore(dir, {});
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect('messaging' in saved).toBe(false);
    expect(saved).toMatchObject({ engineOn: { cursor: false }, engines: { cursor: false }, domains: [domain] });
  });
});
