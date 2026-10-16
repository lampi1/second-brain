// Opens a local file the user clicked in a question's context (a report, a screenshot, a PR description saved to disk:
// the user, 2026-10-12, "il link dei report o pr"). The path comes from a model's text, so it is untrusted: only an
// absolute local path (Windows: a drive letter, never a UNC \\host share, which would send the Windows login to that
// host; macOS/Linux: a /-rooted path, ADR 0054), read with realpath; documents and images open with their own app, anything else (an .exe, a .ps1, a shortcut, a
// folder) is only shown selected in Explorer, never run. Used by index.ts (app:openPath); pinned by test/unit/open-path.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OpenPathResult } from '../shared/contract';

/** What opens with its own app: text, documents, images, data. Never something Windows would run. */
export const OPENABLE = new Set([
  '.md', '.txt', '.log', '.json', '.csv', '.tsv', '.xml', '.yml', '.yaml', '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp',
  '.bmp', '.svg', '.html', '.htm', '.docx', '.xlsx', '.pptx', '.diff', '.patch', '.sql', '.trx',
]);

export interface Shell { openPath(p: string): Promise<string>; showItemInFolder(p: string): void }

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
export function linksToShare(p: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== 'win32') return false;
  const parts = path.win32.normalize(p).split('\\');
  for (let i = 2; i <= parts.length; i++) {
    const cur = parts.slice(0, i).join('\\');
    let st: fs.Stats;
    try { st = fs.lstatSync(cur); } catch { return false; }
    if (!st.isSymbolicLink()) continue;
    let to = '';
    try { to = fs.readlinkSync(cur); } catch { return true; }
    if (/^[\\/]{2}/.test(to) || /^\\\?\?\\UNC\\/i.test(to)) return true;
  }
  return false;
}

export async function openLocal(raw: string, shell: Shell): Promise<OpenPathResult> {
  const p = localPath(raw);
  if (!p) return { how: 'refused', reason: process.platform === 'win32' ? 'Solo file di questo PC (un percorso con la lettera del disco).' : 'Solo file di questo computer (un percorso completo, da /).' };
  let real: string;
  let isFile = false;
  if (linksToShare(p)) return { how: 'refused', reason: 'Il percorso porta a una cartella di rete.' };
  try { real = fs.realpathSync.native(p); isFile = fs.statSync(real).isFile(); } catch { return { how: 'missing', reason: `Il file non c'è più: ${p}` }; }
  if (/^[\\/]{2}/.test(real)) return { how: 'refused', reason: 'Il percorso porta a una cartella di rete.' };
  if (isFile && OPENABLE.has(path.extname(real).toLowerCase())) {
    const err = await shell.openPath(real);
    if (!err) return { how: 'opened' };
  }
  shell.showItemInFolder(real);
  return { how: 'folder' };
}
