// Text helpers of the brain pages (src/renderer/brain/lib/text.ts): names not numbers, the owner's name read from the
// data, small counters.
import { describe, expect, it } from 'vitest';
import { bugName, clean, countBy, firstPerson, ownerOf, topicOf } from '../../../src/renderer/brain/lib/text';

describe('names not numbers', () => {
  it('clean drops a leading id, the commit prefix and double spaces', () => {
    expect(clean('#4242 fix(api):  send the orders')).toBe('send the orders');
    expect(clean('feat!: big change')).toBe('big change');
  });
  it('bugName drops the [Area] - prefix; topicOf reads it', () => {
    expect(bugName('[Fatture] - Sconto applicato due volte')).toBe('Sconto applicato due volte');
    expect(topicOf('[Fatture] - Nota')).toBe('Fatture');
  });
});

describe('owner', () => {
  it('ownerOf is the most common non-AI author; firstPerson drops the name', () => {
    expect(ownerOf([{ chi: 'IA' }, { chi: 'Alex' }, { chi: 'Alex' }, { chi: 'Sam' }])).toBe('Alex');
    expect(ownerOf([{ chi: 'IA' }])).toBe('');
    expect(firstPerson('Alex decide se Alex parte', 'Alex')).toBe('decide se parte');
    expect(firstPerson('nessun nome', '')).toBe('nessun nome');
  });
});

describe('small helpers', () => {
  it('countBy sorts by count then name; empty keys count as —', () => {
    expect(countBy([{ k: 'b' }, { k: 'a' }, { k: 'b' }, { k: '' }], r => r.k)).toEqual([['b', 2], ['—', 1], ['a', 1]]);
  });
});
