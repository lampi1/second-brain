// The images a question shows (the user, 2026-10-14: "mi piacerebbe che le immagini si potessero vedere direttamente
// nella domanda"): a chat names a local PNG, JPG or WebP in its question, an option or the turn's prose, and the panel
// shows it as a thumbnail that opens large. The path comes from a model's text, so it is untrusted: an absolute local
// path (open-path.ts rules: a drive letter, never a network share, real path checked again), inside one of the allowed
// folders (the app's evidence and profile folders, the brain, the app's code and its worktrees), with an image
// extension AND the matching magic bytes, at most MAX_ASK_IMAGE bytes. It is handed to the renderer as a data: URL (the
// CSP already allows img-src data:; no file: URL ever reaches the page). Nothing is written, run or sent anywhere.
// Used by index.ts (app:askImage); pinned by test/unit/ask-image.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { AskImageResult } from '../shared/contract';
import { linksToShare, localPath } from './open-path';

export const MAX_ASK_IMAGE = 4_000_000;
const MIME: Record<string, 'image/png' | 'image/jpeg' | 'image/webp'> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

/** Do the first bytes say what the extension says? */
export function magicMatches(mime: string, head: Buffer): boolean {
  if (mime === 'image/png') return head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'image/jpeg') return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (mime === 'image/webp') return head.length >= 12 && head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP';
  return false;
}

const norm = (p: string) => path.win32.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
/** Is `p` the folder `root` or inside it (whole path segments, case-insensitive like Windows)? */
export function isInside(p: string, root: string): boolean {
  const a = norm(p);
  const b = norm(root);
  return a === b || a.startsWith(`${b}\\`);
}

const realOr = (p: string) => { try { return fs.realpathSync.native(p); } catch { return p; } };

export function readAskImage(raw: string, roots: readonly string[]): AskImageResult {
  const p = localPath(raw);
  if (!p) return { kind: 'refused', reason: 'Solo immagini di questo PC, con il percorso completo (C:\\…).' };
  const mime = MIME[path.extname(p).toLowerCase()];
  if (!mime) return { kind: 'refused', reason: 'Solo immagini PNG, JPG o WebP.' };
  if (linksToShare(p)) return { kind: 'refused', reason: 'Il percorso porta a una cartella di rete.' };
  let real: string;
  let st: fs.Stats;
  try { real = fs.realpathSync.native(p); st = fs.statSync(real); } catch { return { kind: 'missing', reason: `L'immagine non c'è: ${p}`, path: p }; }
  if (/^[\\/]{2}/.test(real)) return { kind: 'refused', reason: 'Il percorso porta a una cartella di rete.' };
  if (!roots.some(r => isInside(real, realOr(r)))) return { kind: 'refused', reason: 'Fuori dalle cartelle ammesse (evidence, cervello, codice dell’app).', path: real };
  if (!st.isFile()) return { kind: 'refused', reason: 'Non è un file.', path: real };
  if (st.size > MAX_ASK_IMAGE) return { kind: 'refused', reason: 'Immagine troppo grande per l’anteprima (oltre 4 MB).', path: real };
  let buf: Buffer;
  try { buf = fs.readFileSync(real); } catch { return { kind: 'missing', reason: `L'immagine non si legge adesso (in uso?): ${p}`, path: p }; }
  if (buf.length > MAX_ASK_IMAGE) return { kind: 'refused', reason: 'Immagine troppo grande per l’anteprima (oltre 4 MB).', path: real };
  if (!magicMatches(mime, buf.subarray(0, 12))) return { kind: 'refused', reason: 'Il file non è l’immagine che dice di essere.', path: real };
  return { kind: 'image', path: real, dataUrl: `data:${mime};base64,${buf.toString('base64')}` };
}

/** The allowed folders: the evidence and profile of both instances, the current profile, the brain, the app's code and
 *  the folder of its worktrees beside it. Missing ones are simply never matched. */
export function askImageRoots(o: { userData: string; appData?: string; brainRoot?: string | null; repos: readonly (string | null | undefined)[] }): string[] {
  const out = [o.userData];
  if (o.appData) out.push(path.join(o.appData, 'second-brain', 'evidence'), path.join(o.appData, 'second-brain-dev', 'evidence'));
  if (o.brainRoot) out.push(o.brainRoot);
  for (const r of o.repos) if (r) out.push(r, path.join(path.dirname(r), 'second-brain-wt'));
  return out;
}
