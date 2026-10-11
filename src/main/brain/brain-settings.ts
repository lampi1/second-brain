// The brain's own settings file (<brain>/brain-settings.json), read by the brain's tools too (today inbox.mjs: the
// Claude <-> Cursor mail switch; the user, 2026-10-11: "vorrei che le chat di claude potessero parlare con quelle di cursor
// e viceversa però disattivabile con un'opzione per sicurezza"). The app mirrors its setting `messaging.crossHarness`
// into this file; the file wins at start (it may have been edited by hand). Same reading rules as inbox.mjs: UTF-8 with
// or without BOM, UTF-16 LE; unreadable = switch off (fail closed). Used by brain/index.ts.
import fs from 'node:fs';
import path from 'node:path';

export const BRAIN_SETTINGS = 'brain-settings.json';

function readRaw(root: string): Record<string, unknown> | null | 'unreadable' {
  const f = path.join(root, BRAIN_SETTINGS);
  if (!fs.existsSync(f)) return null;
  try {
    const buf = fs.readFileSync(f);
    const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le') : buf.toString('utf8');
    const j = JSON.parse(text.replace(/^﻿/, '')) as unknown;
    return j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : 'unreadable';
  } catch { return 'unreadable'; }
}

/** null = the file says nothing (keep the app's value). */
export function readCrossHarness(root: string): boolean | null {
  const r = readRaw(root);
  if (r === 'unreadable') return false;
  if (!r || typeof r.crossHarnessMessages !== 'boolean') return null;
  return r.crossHarnessMessages;
}

/** Writes the switch, keeping any other key of the file (UTF-8, no BOM, atomic rename). */
export function writeCrossHarness(root: string, on: boolean): void {
  const r = readRaw(root);
  const base = r && r !== 'unreadable' ? r : {};
  const f = path.join(root, BRAIN_SETTINGS);
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ ...base, crossHarnessMessages: on }, null, 2)}\n`);
  fs.renameSync(tmp, f);
}
