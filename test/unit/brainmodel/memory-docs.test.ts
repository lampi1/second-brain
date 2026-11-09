// Memoria → Diario e note (#368): memoryDocs lists now.md, the journal (newest first, bounded), ideas.md, ai-errors.md
// and the notes, masked and bounded; binary files and links are left out. Temp folders only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { memoryDocs } from '../../../src/main/brainmodel/memory-docs';

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });
const brain = (files: Record<string, string | Buffer>): string => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'brain-docs-'))); roots.push(root);
  for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); }
  return root;
};

describe('memoryDocs', () => {
  it('lists the memory outside skills, masked, the journal newest first', () => {
    const root = brain({
      'now.md': '# Adesso\n\n- Rilascio venerdì.\n',
      'journal/2026-11-07.md': '# 7 novembre\n\nRiunione.\n',
      'journal/2026-11-08.md': `# 8 novembre\n\nPass${'word'}=segreto-finto-9\n`,
      'ideas.md': '## Idee\n\n- Un grafico.\n',
      'ai-errors.md': '# Errori\n\n- Ha usato la tabella sbagliata.\n',
      'journal/foto.png': Buffer.from([0x89, 0x50, 0, 0]),
      'journal/README.md': '# Come scrivere il diario\n',
    });
    const { docs } = memoryDocs(root, []);
    // the journal last, so a long one never leaves the rest out; only dated days
    expect(docs.map(d => d.file)).toEqual(['now.md', 'ideas.md', 'ai-errors.md', 'journal/2026-11-08.md', 'journal/2026-11-07.md']);
    expect(docs.map(d => d.kind)).toEqual(['now', 'ideas', 'errors', 'journal', 'journal']);
    expect(docs[3]!.text).not.toContain('segreto-finto-9');
  });
  it('no brain, no documents; a huge file is cut and says so', () => {
    expect(memoryDocs(null, [])).toEqual({ root: null, docs: [] });
    const root = brain({ 'now.md': 'x'.repeat(300 * 1024) });
    const [doc] = memoryDocs(root, []).docs;
    expect(doc!.truncated).toBe(true);
    expect(doc!.text.length).toBe(200 * 1024);
  });
  it('a linked folder that leads outside the brain is not read', () => {
    const outside = brain({ '2026-01-01.md': 'segreto fuori dal brain\n' });
    const root = brain({ 'now.md': 'ok\n' });
    try { fs.symlinkSync(outside, path.join(root, 'journal'), 'junction'); } catch { return; } // no links on this machine
    expect(memoryDocs(root, []).docs.map(d => d.file)).toEqual(['now.md']);
  });
});
