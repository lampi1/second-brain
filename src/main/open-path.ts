// Shows a local file the user chose in Explorer (the viewer's "Show in folder"), selected and never opened or run:
// every file link opens in the app's read-only viewer (SPEC 22, ADR 0181), so nothing here hands a file to its own app.
// The path comes from a model's text, so it is untrusted: only an absolute local path (Windows: a drive letter, never a
// UNC \\host share, which would send the Windows login to that host; macOS/Linux: a /-rooted path, ADR 0054), read with
// realpath. Used by index.ts (app:showInFolder) and file-view.ts; pinned by test/unit/open-path.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OpenPathResult } from '../shared/contract';

export interface Shell { showItemInFolder(p: string): void }

/** A file: URL or an absolute path of this OS → an absolute local path, or null (relative, UNC, another scheme).
 *  `platform` = whose rules (tests pass it; the app uses its own). */
export function localPath(raw: string, platform: NodeJS.Platform = process.platform): string | null {
  const win = platform === 'win32';
  let p = raw.trim().replace(/^<|>$/g, '');
  if (/^file:/i.test(p)) {
    if (/^file:\/\/[^/]/i.test(p)) return null; // file://host/share: a remote share
    try { p = fileURLToPath(p, { windows: win }); } catch { return null; }
  }
  if (/^[\\/]{2}/.test(p)) return null; // \\host\share, //host/share, \\?\ device paths
  if (!win) return p.startsWith('/') ? path.posix.normalize(p) : null;
  if (!/^[a-zA-Z]:[\\/]/.test(p)) return null;
  if (p.indexOf(':', 2) !== -1) return null; // an alternate data stream (evil.exe:a.md) would pass for a document
  return path.win32.normalize(p);
}

/** True when a component of the path is a link (symlink, junction) to a network share: checked with lstat/readlink,
 *  which never follow the link, before realpath would connect to the share (and send the Windows login to it). Windows
 *  only: on macOS/Linux a share is a folder mounted beforehand, and following a link to it sends nothing. */
export function linksToShare(p: string, platform: NodeJS.Platform = process.platform, depth = 0): boolean {
  if (platform !== 'win32') return false;
  if (depth > 8) return true; // a chain this long is refused rather than followed
  const parts = path.win32.normalize(p).split('\\');
  for (let i = 2; i <= parts.length; i++) {
    const cur = parts.slice(0, i).join('\\');
    let st: fs.Stats;
    try { st = fs.lstatSync(cur); } catch { return false; }
    if (!st.isSymbolicLink()) continue;
    let to = '';
    try { to = fs.readlinkSync(cur); } catch { return true; }
    if (/^[\\/]{2}/.test(to) || /^\\\?\?\\UNC\\/i.test(to)) return true;
    // a link to another link: every hop is checked before realpath would follow the chain to a share
    if (linksToShare(path.win32.resolve(path.win32.dirname(cur), to.replace(/^\\\?\?\\/, '')), platform, depth + 1)) return true;
  }
  return false;
}

export function showLocal(raw: string, shell: Shell): OpenPathResult {
  const p = localPath(raw);
  if (!p) return { how: 'refused', reason: process.platform === 'win32' ? 'Solo file di questo PC (un percorso con la lettera del disco).' : 'Solo file di questo computer (un percorso completo, da /).' };
  let real: string;
  if (linksToShare(p)) return { how: 'refused', reason: 'Il percorso porta a una cartella di rete.' };
  try { real = fs.realpathSync.native(p); } catch { return { how: 'missing', reason: `Il file non c'è più: ${p}` }; }
  if (/^[\\/]{2}/.test(real)) return { how: 'refused', reason: 'Il percorso porta a una cartella di rete.' };
  shell.showItemInFolder(real);
  return { how: 'folder' };
}
