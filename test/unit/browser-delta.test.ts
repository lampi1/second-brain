// read_page as a difference (browser/delta.ts): the same page read again returns only new or changed lines with their
// parents, how many went or stayed; nothing changed says so; a big change or a tiny page returns the whole tree.
import { describe, expect, it } from 'vitest';
import { snapshotDelta } from '../../src/main/browser/delta';

const page = (extra: string[] = [], status = 'Bozza') => [
  'Tab t1: "Ordini" http://localhost:3000/ordini',
  'main',
  '  heading "Ordini" [e1]',
  '  form "Nuovo ordine" [e2]',
  '    textbox "Cliente" [e3]',
  '    textbox "Importo" [e4]',
  '    button "Salva" [e5]',
  '  table "Elenco" [e6]',
  ...Array.from({ length: 20 }, (_, i) => `    row "Ordine ${i}" [e${10 + i}]`),
  `  status "${status}" [e40]`,
  ...extra,
].join('\n');

describe('snapshotDelta', () => {
  it('sends only the changed lines with their parents and the counts', () => {
    const d = snapshotDelta(page(), page(['  alert "Salvato" [e41]'], 'Salvato'))!;
    expect(d.split('\n')[0]).toBe('Tab t1: "Ordini" http://localhost:3000/ordini');
    expect(d).toContain('2 new or changed lines shown with their parents, 1 gone');
    expect(d).toContain('status "Salvato" [e40]');
    expect(d).toContain('alert "Salvato" [e41]');
    expect(d).toContain('main');
    expect(d).not.toContain('row "Ordine 3"');
    expect(d.length).toBeLessThan(page().length / 2);
  });

  it('says when nothing changed', () => {
    expect(snapshotDelta(page(), page())).toMatch(/no change since your last read_page/);
  });

  it('a big change, or a page whose difference is most of it, goes whole', () => {
    expect(snapshotDelta(page(), page().replace(/Ordine/g, 'Fattura'))).toBeNull();
    expect(snapshotDelta('Tab t1: "x" u\nmain\n  a', 'Tab t1: "x" u\nmain\n  b')).toBeNull();
  });
});
