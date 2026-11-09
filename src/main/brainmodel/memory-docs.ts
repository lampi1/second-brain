// Memoria → Diario e note (#368): the brain's memory outside skills, as documents the page lists, searches and shows:
// now.md (Adesso), each journal day (newest first), ideas.md, ai-errors.md, the knowledge notes (model.ts readMemory
// finds them), the shared memory and the roles' old memories (kept readable, ADR 0242). Read-only. Each text is masked
// like every other read of the brain (brain/mask.ts) and bounded (200 KB per file, 4 MB in all, 400 journal days), so a
// huge brain never stalls the page. Used by service.ts memoryDocs; tests: test/unit/brainmodel/memory-docs.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { AgentProfile } from '../../shared/agents';
import type { MemoryDoc, MemoryDocs } from '../../shared/brain-model';
import { maskSecrets } from '../brain/mask';
import { readMemory } from './model';

const PER_FILE = 200 * 1024, TOTAL = 4 * 1024 * 1024, DAYS = 400;

export function memoryDocs(root: string | null, profiles: readonly AgentProfile[]): MemoryDocs {
  if (!root) return { root: null, docs: [] };
  const docs: MemoryDoc[] = [];
  let used = 0;
  const add = (file: string, kind: MemoryDoc['kind'], title: string, group: string): void => {
    if (used >= TOTAL) return;
    const abs = path.join(root, ...file.split('/'));
    let raw: string, changedAt: number | null = null;
    try {
      const st = fs.lstatSync(abs);
      if (!st.isFile()) return;
      changedAt = st.mtimeMs;
      const fd = fs.openSync(abs, 'r');
      try { const buf = Buffer.alloc(Math.min(st.size, PER_FILE)); fs.readSync(fd, buf, 0, buf.length, 0); raw = buf.toString('utf8'); }
      finally { fs.closeSync(fd); }
      if (raw.includes('\0')) return;
      const text = maskSecrets(raw).text;
      used += text.length;
      docs.push({ id: `${kind}:${file}`, kind, title, group, file, text, changedAt: changedAt === null ? null : Math.round(changedAt), ...(st.size > PER_FILE ? { truncated: true } : {}) });
    } catch { /* missing or unreadable: not listed */ }
  };
  add('now.md', 'now', 'Adesso', 'now.md');
  let days: string[] = [];
  try { days = fs.readdirSync(path.join(root, 'journal')).filter(f => /\.md$/i.test(f)).sort().reverse().slice(0, DAYS); } catch { /* none yet */ }
  for (const f of days) add(`journal/${f}`, 'journal', path.posix.basename(f, '.md'), path.posix.basename(f, '.md'));
  add('ideas.md', 'ideas', 'Idee', 'ideas.md');
  add('ai-errors.md', 'errors', 'Errori dell’AI', 'ai-errors.md');
  for (const m of readMemory(root, profiles)) {
    if (m.kind === 'knowledge') add(m.file, 'knowledge', m.title, m.group);
    else if (m.kind === 'shared') add(m.file, 'shared', m.title, m.group);
    else if (m.kind === 'agent') add(m.file, 'agent', m.title, m.group);
  }
  return { root, docs };
}
