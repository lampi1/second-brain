// The small preview of a file the user clicked in a chat message (a path in `inline code` or a visual's diffList): the
// first lines of a text file, or a thumbnail of an image, shown in a popover before it is opened (the user, 2026-10-13:
// "anteprime" on click, not inline floods). The path comes from a model's text, so it is untrusted: the rules of
// open-path.ts (an absolute local path with a drive letter, or one relative to the chat's own folder without `..`;
// never a UNC share, real path checked again), only known text and image types (never .env, keys or binaries), at most
// PEEK_BYTES read and MAX_IMAGE bytes for an image. Nothing is written, run or sent anywhere. Used by index.ts
// (app:peekFile); pinned by test/unit/peek-file.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { PeekResult } from '../shared/contract';
import { linksToShare, localPath } from './open-path';

/** Text that is safe and useful to show: documents, data, code. */
export const PEEK_TEXT = new Set([
  '.md', '.txt', '.log', '.json', '.csv', '.tsv', '.xml', '.yml', '.yaml', '.sql', '.diff', '.patch', '.html', '.htm', '.css',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.cs', '.csproj', '.sln', '.razor', '.cshtml', '.py', '.ps1', '.psm1', '.sh',
  '.java', '.go', '.rs', '.c', '.h', '.cpp', '.trx',
]);
export const PEEK_IMAGE: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
export const PEEK_BYTES = 6_000;
export const PEEK_LINES = 14;
export const MAX_IMAGE = 3_000_000;

/** A path from a message → an absolute local path: absolute as open-path.ts allows, or relative inside `cwd`. */
export function resolvePeek(raw: string, cwd?: string): string | null {
  const abs = localPath(raw);
  if (abs) return abs;
  const p = raw.trim().replace(/^<|>$/g, '');
  const base = cwd ? localPath(cwd) : null;
  if (!base || !p || /^[\\/]/.test(p) || /^[a-z][a-z0-9+.-]*:/i.test(p) || p.includes(':')) return null;
  if (p.split(/[\\/]/).includes('..')) return null;
  return path.win32.join(base, p);
}

export function peekFile(raw: string, cwd?: string): PeekResult {
  const p = resolvePeek(raw, cwd);
  if (!p) return { kind: 'refused', reason: 'Solo file di questo PC (un percorso con la lettera del disco o dentro la cartella della chat).' };
  let real: string;
  let st: fs.Stats;
  if (linksToShare(p)) return { kind: 'refused', reason: 'Il percorso porta a una cartella di rete.' };
  try { real = fs.realpathSync.native(p); st = fs.statSync(real); } catch { return { kind: 'missing', reason: `Il file non c'è: ${p}`, path: p }; }
  if (/^[\\/]{2}/.test(real)) return { kind: 'refused', reason: 'Il percorso porta a una cartella di rete.' };
  if (!st.isFile()) return { kind: 'other', path: real, size: 0, what: 'cartella' };
  const ext = path.extname(real).toLowerCase();
  const mime = PEEK_IMAGE[ext];
  if (mime) {
    if (st.size > MAX_IMAGE) return { kind: 'other', path: real, size: st.size, what: 'immagine grande' };
    return { kind: 'image', path: real, size: st.size, dataUrl: `data:${mime};base64,${fs.readFileSync(real).toString('base64')}` };
  }
  if (!PEEK_TEXT.has(ext)) return { kind: 'other', path: real, size: st.size, what: ext ? ext.slice(1) : 'file' };
  const fd = fs.openSync(real, 'r');
  let buf: Buffer;
  try {
    buf = Buffer.alloc(Math.min(PEEK_BYTES, st.size));
    fs.readSync(fd, buf, 0, buf.length, 0);
  } finally { fs.closeSync(fd); }
  // UTF-16 LE with its BOM (what Windows PowerShell 5.1 writes with `>`) is text; a 0 byte anywhere else is a binary
  const utf16 = buf[0] === 0xff && buf[1] === 0xfe;
  if (!utf16 && buf.includes(0)) return { kind: 'other', path: real, size: st.size, what: 'binario' };
  const all = (utf16 ? buf.subarray(2, buf.length - (buf.length % 2)).toString('utf16le') : buf.toString('utf8')).replace(/^﻿/, '').split(/\r?\n/);
  const cut = st.size > buf.length ? all.slice(0, -1) : all; // the last line may be cut in half
  const lines = cut.slice(0, PEEK_LINES);
  return { kind: 'text', path: real, size: st.size, text: lines.join('\n'), more: st.size > buf.length || cut.length > PEEK_LINES };
}
