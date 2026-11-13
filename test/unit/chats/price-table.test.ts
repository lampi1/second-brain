// chats/live-cost.ts priceTableSource (issue #96): the brain's registry when it has one, else the release template's
// harness/models.json, so the Claude model list and prices exist from the first start; re-read at most every ttl.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { priceTableSource, registryModels } from '../../../src/main/chats/live-cost';
import type { ModelRegistry } from '../../../src/shared/contract';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const TEMPLATE = path.resolve(__dirname, '../../../brain-template/harness/models.json');
const own: ModelRegistry = { harnesses: {}, defaultModel: 'x', models: [{ id: 'own-model', harness: 'claude', provider: 'anthropic', routing: 'auto', price: { input: 1, cacheWrite5m: 1, cacheWrite1h: 1, cacheRead: 1, output: 1 }, efforts: [], defaultEffort: null }] };

describe('price table source', () => {
  it('falls back to the template registry when the brain has none', () => {
    const table = priceTableSource(() => null, () => TEMPLATE);
    const ids = registryModels('claude', table()).map(m => m.id);
    expect(ids).toContain('claude-opus-5-5');
    for (const gone of ['claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6']) expect(ids).not.toContain(gone);
  });
  it('prefers the brain registry and re-reads it only after the ttl', () => {
    let clock = 0, reg: ModelRegistry | null = null, reads = 0;
    const table = priceTableSource(() => { reads++; return reg; }, () => TEMPLATE, 1000, () => clock);
    expect(table()?.models.some(m => m.id === 'claude-opus-5-5')).toBe(true);
    reg = own; clock = 500;
    expect(table()?.models[0]?.id).not.toBe('own-model'); // cached
    clock = 1600;
    expect(table()?.models[0]?.id).toBe('own-model');
    expect(reads).toBe(2);
  });
  it('a missing or broken template is no table, and a throwing brain falls back', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-prices-')); dirs.push(d);
    fs.writeFileSync(path.join(d, 'models.json'), '{ broken');
    expect(priceTableSource(() => null, () => path.join(d, 'models.json'))()).toBeNull();
    expect(priceTableSource(() => null, () => null)()).toBeNull();
    expect(priceTableSource(() => { throw new Error('no brain'); }, () => TEMPLATE)()?.defaultModel).toBe('claude-opus-5-5');
  });
});
