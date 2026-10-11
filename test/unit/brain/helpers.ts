// Test helpers for the brain module: temporary brain folders (never the user's real brain) with the brain's parsers
// (test/fixtures/brain/parse.mjs, a copy of the brain's ops/tools/brain-site/parse.mjs with neutral sample values; refresh it when the
// brain's file changes) and a fake harness/cursor/chats.mjs that prints the lines of chats.txt. Used by the unit tests.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { NodeRunner } from '../../../src/main/brain/node';

export const FIXTURES = path.resolve(import.meta.dirname, '..', '..', 'fixtures', 'brain');
export const plainNode: NodeRunner = { exe: process.execPath, env: { ...process.env } };

export function tmpDir(prefix = 'sb-brain-'): string { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

/** A fake brain: parsers, a chats.mjs that prints chats.txt, an ideas file with one idea, an empty errors file. */
export function tmpBrain(opts: { parsers?: boolean; chats?: string } = {}): string {
  const d = tmpDir();
  if (opts.parsers !== false) {
    fs.mkdirSync(path.join(d, 'ops', 'tools', 'brain-site'), { recursive: true });
    fs.copyFileSync(path.join(FIXTURES, 'parse.mjs'), path.join(d, 'ops', 'tools', 'brain-site', 'parse.mjs'));
  }
  fs.mkdirSync(path.join(d, 'harness', 'cursor'), { recursive: true });
  fs.writeFileSync(path.join(d, 'harness', 'cursor', 'chats.mjs'),
    "import fs from 'node:fs'; try { process.stdout.write(fs.readFileSync(new URL('../../chats.txt', import.meta.url), 'utf8')); } catch { }\n");
  fs.writeFileSync(path.join(d, 'chats.txt'), opts.chats ?? '- Claude · OS · Prova · brain · 11/10, 09:00 · in corso · id abc123\n');
  fs.writeFileSync(path.join(d, 'ideas.md'), '# Idee\n\n## 2026-10-10 · [personale] · Vecchia idea · `aperta`\n- **Idea:** x\n');
  fs.writeFileSync(path.join(d, 'ai-errors.md'), '# Errori\n');
  return d;
}

export async function until(fn: () => boolean, ms = 5000): Promise<boolean> {
  const t = Date.now();
  while (Date.now() - t < ms) { if (fn()) return true; await new Promise(r => setTimeout(r, 50)); }
  return fn();
}
