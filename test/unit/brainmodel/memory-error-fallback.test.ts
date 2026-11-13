// Conservative lexical error recall for small brains: useful before vectors exist without reducing cosine thresholds.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { lexicalErrors } from '../../../src/main/search/hybrid/recall';
import { HybridSearch } from '../../../src/main/search/hybrid/service';
it('requires multiple specific matching words and rejects generic or unrelated requests', () => {
  const entries = [{ line: 2, day: '2026-01-01', text: 'Controllare migrazione database prima del deploy' }];
  expect(lexicalErrors('migrazione database', entries)).toHaveLength(1);
  expect(lexicalErrors('database', entries)).toEqual([]);
  expect(lexicalErrors('questo errore prima dopo', entries)).toEqual([]);
  expect(lexicalErrors('scaricare immagini prodotto', entries)).toEqual([]);
});
it('recalls small error files without starting an embedding worker', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-errors-small-'));
  try {
    fs.writeFileSync(path.join(root, 'ai-errors.md'), '# Errors\n- 2026-01-01 · artisan · database · regola: Controllare migrazione database\n');
    const search = new HybridSearch({ brainRoot: () => root, dir: root, workerFile: 'must-not-start', download: false });
    const result = await search.recall('migrazione database');
    expect(result.ready).toBe(true); expect(result.errors).toHaveLength(1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
