// The model lists the engines' CLIs themselves offered (src/main/brain/models-seen.ts): cleaned, kept per engine,
// saved only when a list changes, read back after a restart; a broken file or a bad engine id never ends up in it.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ModelsSeenStore, cleanModels } from '../../../src/main/brain/models-seen';
import { tmpDir } from './helpers';

describe('models seen', () => {
  it('cleans the list: valid ids only, once each, a name for every id', () => {
    expect(cleanModels([{ id: 'grok-4.7', name: 'Grok 4.7' }, { id: 'grok-4.7', name: 'dup' }, { id: 'bad id', name: 'x' }, { id: 'auto', name: '' }, null, 'x']))
      .toEqual([{ id: 'grok-4.7', name: 'Grok 4.7' }, { id: 'auto', name: 'auto' }]);
    expect(cleanModels('nope')).toEqual([]);
  });

  it('keeps each engine\'s last list across restarts, writes only on a change', () => {
    const file = path.join(tmpDir(), 'engine-models.json');
    const a = new ModelsSeenStore(file);
    expect(a.get()).toEqual({});
    a.record('bad id', [{ id: 'x', name: 'X' }]);
    expect(fs.existsSync(file)).toBe(false);
    a.record('cursor', [{ id: 'grok-4.7', name: 'Grok 4.7' }, { id: 'gpt-5', name: 'GPT-5' }]);
    a.record('kimi', [{ id: 'kimi-k2', name: 'Kimi K2' }]);
    const at = a.get().cursor!.at;
    const back = new ModelsSeenStore(file).get();
    expect(back.cursor!.ids.map(m => m.id)).toEqual(['grok-4.7', 'gpt-5']);
    expect(back.kimi!.ids.map(m => m.id)).toEqual(['kimi-k2']);
    fs.writeFileSync(file, 'changed on disk');
    a.record('cursor', [{ id: 'grok-4.7', name: 'Grok 4.7' }, { id: 'gpt-5', name: 'GPT-5' }]);
    expect(fs.readFileSync(file, 'utf8')).toBe('changed on disk'); // same list: no write
    expect(a.get().cursor!.at).toBe(at);
    expect(new ModelsSeenStore(file).get()).toEqual({}); // a broken file reads as "none yet"
  });

  it('reads the list saved when only Cursor reported (same shape)', () => {
    const file = path.join(tmpDir(), 'cursor-models.json');
    fs.writeFileSync(file, JSON.stringify({ cursor: { ids: [{ id: 'grok-4.7', name: 'Grok 4.7' }], at: 5 } }));
    expect(new ModelsSeenStore(file).get()).toEqual({ cursor: { ids: [{ id: 'grok-4.7', name: 'Grok 4.7' }], at: 5 } });
  });
});
