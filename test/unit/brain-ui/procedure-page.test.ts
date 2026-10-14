// Unit tests of the Procedure page's pure parts: the list filter (words anywhere, accents ignored, every chosen tag)
// and the copy marks added to the rendered markdown (a "Copia" button per code block, inline code clickable, nothing
// that runs). Pages: src/renderer/brain/pages/Procedure.tsx, components/Markdown.tsx.
import { describe, expect, it } from 'vitest';
import type { ProcedureSummary } from '@shared/contract';
import { filterProcedures } from '../../../src/renderer/brain/pages/Procedure';
import { withCopy } from '../../../src/renderer/brain/components/Markdown';

const p = (o: Partial<ProcedureSummary>): ProcedureSummary => ({
  id: 'a.md#x', title: 'X', purpose: '', area: 'Runbook', group: null, file: 'a.md', line: 1, source: 'Runbook', tags: [], changedAt: null, ...o,
});
const LIST = [
  p({ id: '1', title: 'Attivare una funzionalità', purpose: 'Accende una funzionalità', tags: ['passi', 'query'] }),
  p({ id: '2', title: 'Cercare un cliente con lookup', file: 'runbook/database.md', tags: ['query'] }),
  p({ id: '3', title: 'Brief mattutino', area: 'Routine', tags: ['passi', 'comandi'] }),
];
const ids = (l: ProcedureSummary[]) => l.map(x => x.id);

describe('filterProcedures', () => {
  it('no words, no tags: everything', () => expect(ids(filterProcedures(LIST, '  ', new Set()))).toEqual(['1', '2', '3']));
  it('every word must match somewhere, accents ignored', () => {
    expect(ids(filterProcedures(LIST, 'FUNZIONALITA attivare', new Set()))).toEqual(['1']);
    expect(ids(filterProcedures(LIST, 'database', new Set()))).toEqual(['2']);
    expect(ids(filterProcedures(LIST, 'routine', new Set()))).toEqual(['3']);
    expect(filterProcedures(LIST, 'lookup deploy', new Set())).toEqual([]);
  });
  it('every chosen tag must be there', () => {
    expect(ids(filterProcedures(LIST, '', new Set(['query'])))).toEqual(['1', '2']);
    expect(ids(filterProcedures(LIST, '', new Set(['query', 'passi'])))).toEqual(['1']);
  });
});

describe('withCopy', () => {
  const html = '<p>Lancia <code>node a.mjs</code>.</p><pre><code class="language-sql">SELECT 1;\n</code></pre><p>fine</p>';
  it('a Copia button after each code block, inline code becomes click-to-copy', () => {
    const out = withCopy(html);
    expect(out).toContain('<div class="bx-pre"><pre><code class="language-sql">SELECT 1;\n</code></pre><button type="button" class="bx-btn s bx-pre-copy" data-copy="block"');
    expect(out).toContain('<code class="bx-copy" data-copy="inline" role="button" tabindex="0" title="Clic per copiare">node a.mjs</code>');
    expect(out.match(/data-copy=/g)).toHaveLength(2);
  });
  it('only copy: no run or execute markup', () => expect(withCopy(html)).not.toMatch(/esegui|run|exec/i));
});
