// Writes one idea the AI had to the brain's Idee (its «IA» side) through the brain's own tool, ops/tools/mem.mjs
// `idea`, so the page reads it like every other idea: the Battito's «Salva» and the maintenance's app ideas (ADR 0149).
// The text goes through a temporary file (never a command line), removed after. Used by pulse/wiring.ts and wiring.ts.
import fs from 'node:fs';
import path from 'node:path';
import { electronNode, runNode } from './node';

/** The brain's idea tool, null when the brain has none (an old or foreign brain). */
export const ideaTool = (root: string | null): string | null => {
  if (!root) return null;
  const file = path.join(root, 'ops', 'tools', 'mem.mjs');
  return fs.existsSync(file) ? file : null;
};

/** `source`: where it was born, after «IA ·» (e.g. «Battito», «Manutenzione»). */
export async function saveAiIdea(o: { root: string | null; userData: string; title: string; body: string; why: string; source: string }): Promise<void> {
  const script = ideaTool(o.root);
  if (!script || !o.root) throw new Error('mem.mjs non disponibile');
  const one = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();
  const dir = path.join(o.userData, 'pulse-ideas');
  fs.mkdirSync(dir, { recursive: true });
  const temp = fs.mkdtempSync(path.join(dir, 'idea-'));
  const file = path.join(temp, 'idea.txt');
  fs.writeFileSync(file, `Idea: ${one(o.body)}\nPerché: ${one(o.why)}\nFonte: IA · ${one(o.source)} · ${one(o.why)}\n`, { flag: 'wx' });
  try {
    const r = await runNode(electronNode(), script, ['idea', '--area', 'personale', '--per', 'owner', '--title', one(o.title).slice(0, 120), '--file', file], o.root);
    if (r.code !== 0) throw new Error('Salvataggio idea non riuscito');
  } finally { fs.unlinkSync(file); fs.rmdirSync(temp); }
}
