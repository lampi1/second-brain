// The working line's phrase (src/renderer/lib/typing-line.ts): picked by the task's kind of work, "any" when none
// matches, changing every LINE_MS, every key present in the three dictionaries.
import { describe, expect, it } from 'vitest';
import { LINE_MS, LINES, lastAsk, typingKey } from '../../src/renderer/lib/typing-line';
import { typingIt } from '../../src/renderer/i18n/areas/typing.it';

describe('typing line', () => {
  it('follows the kind of task', () => {
    expect(typingKey('Correggi il bug del login', 0)).toMatch(/^typing\.fix\.\d+$/);
    expect(typingKey('Ricerca fonti sui modelli', 0)).toMatch(/^typing\.research\.\d+$/);
    expect(typingKey('Ciao', 0)).toMatch(/^typing\.any\.\d+$/);
  });
  it('changes phrase over time and every key exists', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) seen.add(typingKey('', i * LINE_MS));
    expect(seen.size).toBe(LINES.any);
    for (const [kind, n] of Object.entries(LINES)) for (let i = 0; i < n; i++) expect(typingIt).toHaveProperty([`typing.${kind}.${i}`]);
    expect(Object.keys(typingIt).length).toBe(Object.values(LINES).reduce((a, b) => a + b, 0));
  });
  it('reads the last request', () => {
    expect(lastAsk([{ kind: 'user', id: 'a', at: 1, text: 'primo' }, { kind: 'user', id: 'b', at: 2, text: 'testa il login' }] as never)).toBe('testa il login');
    expect(lastAsk(undefined)).toBe('');
  });
});
