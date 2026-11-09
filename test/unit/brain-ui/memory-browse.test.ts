// Memoria → Diario e note (#368): shelves, search (every word, accents and case ignored), order and highlight ranges.
import { describe, expect, it } from 'vitest';
import type { MemoryDoc } from '../../../src/shared/brain-model';
import { ordered, ranges, search, shelfOf, words } from '../../../src/renderer/lib/memory-browse';

const doc = (kind: MemoryDoc['kind'], title: string, text: string, group = title): MemoryDoc => ({ id: `${kind}:${title}`, kind, title, group, file: `${title}.md`, text, changedAt: null });
const docs = [
  doc('knowledge', 'Clienti', '# Clienti\n\n- Rossi paga a 60 giorni.\n', 'Clienti'),
  doc('journal', '2026-11-07', '# 7\n\nCaffè con Rossi: perché il rilascio slitta.\n'),
  doc('journal', '2026-11-08', '# 8\n\nNiente.\n'),
  doc('now', 'Adesso', '- Rilascio venerdì.\n'),
  doc('errors', 'Errori dell’AI', '- Tabella sbagliata.\n'),
];

describe('memory browse', () => {
  it('puts each kind on its shelf and orders Adesso, newest day, then the rest', () => {
    expect(shelfOf('now')).toBe('diary'); expect(shelfOf('agent')).toBe('notes'); expect(shelfOf('errors')).toBe('errors');
    expect(ordered(docs).map(d => d.title)).toEqual(['Adesso', '2026-11-08', '2026-11-07', 'Errori dell’AI', 'Clienti']);
  });
  it('finds documents holding every word, accents and case ignored, with the matching lines and a snippet', () => {
    expect(words('  Perche  a ROSSI ')).toEqual(['perche', 'rossi']);
    const hits = search(docs, 'all', 'perche rossi');
    expect(hits.map(h => h.doc.title)).toEqual(['2026-11-07']);
    expect(hits[0]).toMatchObject({ lines: 1, snippet: 'Caffè con Rossi: perché il rilascio slitta.' });
    expect(search(docs, 'diary', 'rossi').map(h => h.doc.title)).toEqual(['2026-11-07']);
    expect(search(docs, 'notes', '').map(h => h.snippet)).toEqual(['Rossi paga a 60 giorni.']);
  });
  it('gives highlight ranges on the original text', () => {
    const text = 'Caffè con Rossi: perché';
    expect(ranges(text, ['perche', 'rossi']).map(([a, b]) => text.slice(a, b))).toEqual(['Rossi', 'perché']);
    expect(ranges(text, [])).toEqual([]);
  });
});
