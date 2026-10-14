// The Cursor model list the CLI itself offered (src/main/brain/models-seen.ts): cleaned, saved only when it changes,
// read back after a restart; a broken file or a Claude list never ends up in it.
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

  it('keeps the last Cursor list across restarts, writes only on a change, ignores Claude', () => {
    const file = path.join(tmpDir(), 'cursor-models.json');
    const a = new ModelsSeenStore(file);
    expect(a.get()).toEqual({ cursor: null });
    a.record('claude', [{ id: 'x', name: 'X' }]);
    expect(fs.existsSync(file)).toBe(false);
    a.record('cursor', [{ id: 'grok-4.7', name: 'Grok 4.7' }, { id: 'gpt-5', name: 'GPT-5' }]);
    const at = a.get().cursor!.at;
    expect(new ModelsSeenStore(file).get().cursor!.ids.map(m => m.id)).toEqual(['grok-4.7', 'gpt-5']);
    fs.writeFileSync(file, 'changed on disk');
    a.record('cursor', [{ id: 'grok-4.7', name: 'Grok 4.7' }, { id: 'gpt-5', name: 'GPT-5' }]);
    expect(fs.readFileSync(file, 'utf8')).toBe('changed on disk'); // same list: no write
    expect(a.get().cursor!.at).toBe(at);
    expect(new ModelsSeenStore(file).get()).toEqual({ cursor: null }); // a broken file reads as "none yet"
  });
});
