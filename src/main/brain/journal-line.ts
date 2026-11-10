// The «fatto» line the app writes to the brain's journal when a role reports its work done or partly done (#375): the
// roles never wrote it (since 2026-10-14 the journal had 0-2 lines a day against 50-100 results), so the app does it,
// the same for every engine and model. It goes through the brain's own tool, ops/tools/mem.mjs `journal` (the app's
// rendered copy for a product brain, ADR 0062), so the line has the format and file of a manual call; the text goes
// through a temporary file (never a command line), removed after, and anything that looks like a credential is masked.
// Used by wiring.ts (ChatManager journalFatto).
import fs from 'node:fs';
import path from 'node:path';
import { maskSecrets } from './mask';
import { errLine, runNode, type NodeRunner } from './node';

const one = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();

/** The journal text: `fatto · <role> · <chat>: <summary>` (a partial result says so), at most ~400 characters. */
export function fattoText(e: { role: string; title: string; summary: string; outcome: 'done' | 'partial' }): string {
  const summary = [...one(maskSecrets(e.summary).text)]; // by code point: a cut never splits an emoji
  const head = `fatto${e.outcome === 'partial' ? ' (in parte)' : ''} · ${one(e.role)} · ${[...one(maskSecrets(e.title).text)].slice(0, 80).join('')}: `;
  const room = 400 - [...head].length;
  return head + (summary.length > room ? `${summary.slice(0, room - 1).join('')}…` : summary.join(''));
}

/** Appends the line with the brain's mem.mjs; throws when there is no tool or it refuses (the caller logs it). */
export async function writeFatto(o: { tool: string | null; root: string | null; userData: string; node: NodeRunner; run?: typeof runNode }, e: Parameters<typeof fattoText>[0]): Promise<void> {
  if (!o.tool || !o.root || !fs.existsSync(o.tool)) throw new Error('the brain has no ops/tools/mem.mjs');
  const dir = path.join(o.userData, 'journal-lines');
  fs.mkdirSync(dir, { recursive: true });
  const temp = fs.mkdtempSync(path.join(dir, 'line-'));
  const file = path.join(temp, 'line.txt');
  try {
    fs.writeFileSync(file, `${fattoText(e)}\n`, { flag: 'wx' });
    const r = await (o.run ?? runNode)(o.node, o.tool, ['journal', '--file', file], o.root, 20_000);
    if (r.code !== 0) throw new Error(`mem.mjs journal: ${errLine(r.stderr) || r.error || `exit ${r.code}`}`);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
