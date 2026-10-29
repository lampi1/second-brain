// The Guida's anchors read from a checkout (ADR 0196): the hash of each anchored symbol's source (shared/guide-anchors.ts
// cuts the block out; here it is read from disk and hashed with sha256), the whole table for scripts/guide-anchors.mjs to
// store in src/shared/guide-anchors.json, and the cards whose code changed since. Only a run from the repo can check:
// a packaged build has no sources, so `repoRoot` is null there and the Guida shows nothing «da verificare». Used by
// main/guide/service.ts (IPC guide:stale), main/guide/maintenance.ts (the research hook), anchors-cli.ts (the script)
// and test/unit/guide-anchors.test.ts.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CONCEPTS } from '../../shared/concept-guide';
import { anchorSource, anchorUses, parseAnchor, staleCards, type AnchorRef, type StaleCard, type StoredAnchors } from '../../shared/guide-anchors';
import stored from '../../shared/guide-anchors.json';

export const hashText = (s: string): string => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

/** The anchor's hash in this checkout; null = its file is gone or no longer declares the symbol. */
export function currentHash(root: string, ref: AnchorRef): string | null {
  const { file, symbol } = parseAnchor(ref);
  let text: string;
  try { text = fs.readFileSync(path.join(root, file), 'utf8'); } catch { return null; }
  const src = anchorSource(text, symbol);
  return src === null ? null : hashText(src);
}

/** Every anchor of every card with its hash now (null = cannot be found), sorted by ref. */
export function computeHashes(root: string, cards = CONCEPTS): { hashes: Record<AnchorRef, string>; missing: { ref: AnchorRef; card: string; point: number }[] } {
  const hashes: Record<string, string> = {};
  const missing: { ref: AnchorRef; card: string; point: number }[] = [];
  for (const u of anchorUses(cards)) {
    if (u.ref in hashes) continue;
    const h = currentHash(root, u.ref);
    if (h === null) missing.push(u); else hashes[u.ref] = h;
  }
  return { hashes: Object.fromEntries(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b, 'en'))), missing };
}

export const storedAnchors = (): StoredAnchors => stored as StoredAnchors;
/** The stored hashes of a checkout (its src/shared/guide-anchors.json as it is on disk), else the bundled copy: a clone
 *  updated but not rebuilt must not show cards «da verificare» only because the build is older. */
export function anchorsIn(root: string): StoredAnchors {
  try {
    const o = JSON.parse(fs.readFileSync(path.join(root, 'src', 'shared', 'guide-anchors.json'), 'utf8')) as Partial<StoredAnchors>;
    if (o && o.version === 1 && o.hashes && typeof o.hashes === 'object') return o as StoredAnchors;
  } catch { /* unreadable: the bundled copy */ }
  return storedAnchors();
}

/** The cards whose anchored code differs from the stored hashes. */
export function staleInRepo(root: string, cards = CONCEPTS, table: StoredAnchors = storedAnchors()): StaleCard[] {
  return staleCards(anchorUses(cards), table.hashes, ref => currentHash(root, ref));
}

/** The repo a dev build runs from: out/main/.. holding a .git (a file in a worktree), the same rule as "Aggiorna"'s
 *  devRepo (wiring.ts createAppSource); null in a packaged build. */
export function repoRootOf(mainDir: string): string | null {
  const root = path.resolve(mainDir, '..', '..');
  return fs.existsSync(path.join(root, '.git')) && fs.existsSync(path.join(root, 'src', 'shared', 'concept-guide.ts')) ? root : null;
}

/** The test's and the script's message for one stale card. */
export function staleMessage(c: StaleCard): string {
  return c.anchors.map(a => `card ${c.id} ${a.point >= 0 ? `point ${a.point + 1}` : 'technical part'}: ${a.why === 'missing' ? `${a.ref} not found (renamed or removed?)` : a.why === 'new' ? `${a.ref} has no stored hash` : `${a.ref} code changed`}, re-read and update the text, then run node scripts/guide-anchors.mjs`).join('\n');
}
