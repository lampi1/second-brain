// The brain's rules as shareable files (ADR 0077, 0088): its topic files and the files of rules/, as `rules/<name>.md`,
// for the shareable brain zip (pack/brain-share.ts). Never memory or private knowledge: the always-loaded files (me.md,
// AGENTS.md, CLAUDE.md), now.md, the journal and agents/<id>/memory.md never enter it; the guard scan still checks what
// does. RULE_FILE and TOOLS_FILE also name the plain-text files the know-how sanitizer (pack/read.ts) keeps. The agent
// pack's TOOLS.md and rule import are gone with it (ADR 0125). Unit tests: test/unit/agents/pack-rules.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { configOf } from '../../rules/storage';
import type { PackFiles } from './zip';

export const RULE_FILE = /^rules\/[a-z0-9][a-z0-9._-]{0,80}\.md$/;
export const TOOLS_FILE = 'TOOLS.md';
const MAX_RULE = 256 * 1024, MAX_RULES = 50;
/** Folders whose files are memory or the app's state, never rules (even when listed as topic files). */
const PRIVATE = /^(agents|memory|journal|ops\/state|\.[^/]+)\//;
const PRIVATE_FILE = /^(me|now|agents|claude|ai-errors)\.md$/i;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'regola';

/** The brain's rules as pack files: topic files first, then rules/ (one per name; private files never). */
export function packRules(root: string): PackFiles {
  const out: PackFiles = new Map();
  let topics: string[] = [];
  try { topics = configOf(root).topicFiles; } catch { /* unreadable brain.json: rules/ only */ }
  const rels = [...topics];
  try { for (const f of fs.readdirSync(path.join(root, 'rules')).sort()) if (/\.md$/i.test(f)) rels.push(`rules/${f}`); } catch { /* none */ }
  for (const rel of rels) {
    // a topic file may be written with Windows separators or another case: test the normalized path
    const norm = rel.replace(/\\/g, '/').toLowerCase();
    if (out.size >= MAX_RULES || PRIVATE.test(norm) || PRIVATE_FILE.test(path.posix.basename(norm)) || path.posix.basename(norm) === 'memory.md' || /(credential|secret|password|token)/i.test(norm)) continue;
    const name = `rules/${slug(path.posix.basename(rel, '.md'))}.md`;
    if (out.has(name)) continue;
    try {
      const file = path.join(root, rel), st = fs.lstatSync(file);
      if (!st.isFile() || st.size > MAX_RULE) continue;
      out.set(name, fs.readFileSync(file));
    } catch { /* listed but missing */ }
  }
  return out;
}
