// The brain's own settings file (<brain>/brain-settings.json), read by the brain's tools too (today inbox.mjs: the
// mail switch between chats on different engines; the user, 2026-10-11: "vorrei che le chat di claude potessero parlare con quelle di cursor
// e viceversa però disattivabile con un'opzione per sicurezza"). The app mirrors its setting `messaging.crossHarness` («Chat
// tra motori diversi», ADR 0046) into this file as `crossHarnessMessages`; at start the file may only close it, never
// open it (agents write to the brain). It also holds `regiaMail`, the words that time the mail to a Regia (readRegiaMail). Same reading rules as inbox.mjs: UTF-8 with
// or without BOM, UTF-16 LE; unreadable = switch off (fail closed). Used by brain/index.ts.
import fs from 'node:fs';
import path from 'node:path';

export const BRAIN_SETTINGS = 'brain-settings.json';
const MAX_BYTES = 256 * 1024;

function readRaw(root: string): Record<string, unknown> | null | 'unreadable' {
  const f = path.join(root, BRAIN_SETTINGS);
  if (!fs.existsSync(f)) return null;
  try {
    if (fs.statSync(f).size > MAX_BYTES) return 'unreadable'; // read on every mail tick: a runaway file never blocks it
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

/** The words that time the mail to a Regia without a sender's kind (`regiaMail`: { urgent, progress, action } lists,
 *  chats/regia-delivery.ts). undefined = the file says nothing or is unreadable: the defaults apply. */
export function readRegiaMail(root: string): unknown {
  const r = readRaw(root);
  return r && r !== 'unreadable' ? r.regiaMail : undefined;
}
