// Memoria → Diario e note (#368): the brain's memory outside skills, as documents the page lists, searches and shows:
// now.md (Adesso), each journal day (newest first), ideas.md, ai-errors.md, the knowledge notes (model.ts readMemory
// finds them), the shared memory and the roles' old memories (kept readable, ADR 0242). Read-only. Each text is masked
// like every other read of the brain (brain/mask.ts) and bounded (200 KB per file, 4 MB in all, 400 journal days), so a
// huge brain never stalls the page; the journal comes last, so a long one never leaves the rest out (the days left out
// are counted). A linked folder that leads outside the brain is not read. Used by service.ts memoryDocs; tests:
// test/unit/brainmodel/memory-docs.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { AgentProfile } from '../../shared/agents';
import type { MemoryDoc, MemoryDocs } from '../../shared/brain-model';
import { maskSecrets } from '../brain/mask';
import { readMemory } from './model';

const PER_FILE = 200 * 1024, TOTAL = 4 * 1024 * 1024, DAYS = 400;

export function memoryDocs(root: string | null, profiles: readonly AgentProfile[]): MemoryDocs {
  if (!root) return { root: null, docs: [] };
  let base: string;
  try { base = fs.realpathSync(root); } catch { return { root, docs: [] }; }
  const docs: MemoryDoc[] = [];
  let used = 0;
  const add = (file: string, kind: MemoryDoc['kind'], title: string, group: string): boolean => {
    if (used >= TOTAL) return false;
    const abs = path.join(base, ...file.split('/'));
    try {
      // the real file stays inside the brain: a linked folder (journal/, memory/, agents/<id>/) may point anywhere
      const real = fs.realpathSync(abs);
      if (!real.startsWith(base + path.sep)) return true;
      const fd = fs.openSync(real, 'r');
      let raw: string, size: number, changedAt: number;
      try {
        const st = fs.fstatSync(fd);
        if (!st.isFile()) return true;
        size = st.size; changedAt = st.mtimeMs;
        const buf = Buffer.alloc(Math.min(size, PER_FILE));
        const n = fs.readSync(fd, buf, 0, buf.length, 0);
        raw = buf.subarray(0, n).toString('utf8');
      } finally { fs.closeSync(fd); }
      if (raw.includes('\0')) return true;
      // a cut in the middle of a character leaves a replacement mark at the end: dropped
      if (size > PER_FILE) raw = raw.replace(/\uFFFD+$/, '');
      const text = maskSecrets(raw).text;
      used += text.length;
      docs.push({ id: `${kind}:${file}`, kind, title: maskSecrets(title).text, group: maskSecrets(group).text, file, text, changedAt: Math.round(changedAt), ...(size > PER_FILE ? { truncated: true } : {}) });
    } catch { /* missing or unreadable: not listed */ }
    return true;
  };
  // the small, always-useful documents first: a long journal must not leave ideas, errors and notes out
  add('now.md', 'now', 'Adesso', 'now.md');
  add('ideas.md', 'ideas', 'Idee', 'ideas.md');
  add('ai-errors.md', 'errors', 'Errori dell’AI', 'ai-errors.md');
  for (const m of readMemory(base, profiles)) {
    if (m.kind === 'knowledge' || m.kind === 'shared' || m.kind === 'agent') add(m.file, m.kind, m.title, m.group);
  }
  let days: string[] = [];
  try { days = fs.readdirSync(path.join(base, 'journal')).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/i.test(f)).sort().reverse(); } catch { /* none yet */ }
  let shown = 0;
  for (const f of days.slice(0, DAYS)) { if (!add(`journal/${f}`, 'journal', f.slice(0, 10), f.slice(0, 10))) break; shown++; }
  const omitted = days.length - shown;
  return { root, docs, ...(omitted > 0 ? { omitted } : {}) };
}
