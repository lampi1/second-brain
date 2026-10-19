// Reads the brain's delivery timing words (orchestratorMail) for chats/orchestrator-delivery.ts. UTF-8 (with or without BOM)
// and UTF-16 LE files are accepted. The retired crossHarnessMessages key no longer controls delivery.
// The explicit retirement migration updates only a valid legacy false in brain-settings.json,
// keeping every unrelated key; unreadable files are left intact. Used by brain/index.ts at product startup.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const BRAIN_SETTINGS = 'brain-settings.json';
const MAX_BYTES = 256 * 1024;

function parseRaw(buf: Buffer): Record<string, unknown> | 'unreadable' {
  try {
    const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le') : buf.toString('utf8');
    const j = JSON.parse(text.replace(/^﻿/, '')) as unknown;
    return j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : 'unreadable';
  } catch { return 'unreadable'; }
}

function readRaw(root: string): Record<string, unknown> | null | 'unreadable' {
  const f = path.join(root, BRAIN_SETTINGS);
  if (!fs.existsSync(f)) return null;
  try {
    if (fs.statSync(f).size > MAX_BYTES) return 'unreadable'; // read on every mail tick: a runaway file never blocks it
    return parseRaw(fs.readFileSync(f));
  } catch { return 'unreadable'; }
}

/** Keeps an installed older inbox compatible while it waits for its normal tool update. No file is created for
 *  missing settings, and no malformed settings are overwritten. The caller logs migration or failure explicitly. */
export function migrateCrossHarness(root: string): 'unchanged' | 'migrated' | 'unreadable' {
  const file = path.join(root, BRAIN_SETTINGS);
  if (!fs.existsSync(file)) return 'unchanged';
  const before = fs.lstatSync(file);
  if (!before.isFile() || before.nlink !== 1 || before.size > MAX_BYTES) return 'unreadable';
  const fd = fs.openSync(file, 'r');
  let raw: Record<string, unknown> | 'unreadable';
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== before.ino || opened.dev !== before.dev || opened.size > MAX_BYTES) return 'unreadable';
    raw = parseRaw(fs.readFileSync(fd));
  } finally { fs.closeSync(fd); }
  if (raw === 'unreadable') return 'unreadable';
  if (raw.crossHarnessMessages !== false) return 'unchanged';
  const tmp = path.join(root, `.brain-settings-${crypto.randomUUID()}.tmp`);
  // Exclusive creation never follows a preexisting staging link. Clean up only a file we successfully created.
  fs.writeFileSync(tmp, `${JSON.stringify({ ...raw, crossHarnessMessages: true }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  try {
    const current = fs.lstatSync(file);
    if (!current.isFile() || current.nlink !== 1 || current.ino !== before.ino || current.dev !== before.dev || current.size !== before.size || current.mtimeMs !== before.mtimeMs)
      throw new Error('brain-settings.json changed during messaging migration; retry on the next start');
    fs.renameSync(tmp, file);
    return 'migrated';
  } finally { try { fs.unlinkSync(tmp); } catch { /* renamed or already removed */ } }
}

/** The words that time the mail to an Orchestrator without a sender's kind (`orchestratorMail`: { urgent, progress, action } lists,
 *  chats/orchestrator-delivery.ts). undefined = the file says nothing or is unreadable: the defaults apply. */
export function readOrchestratorMail(root: string): unknown {
  const r = readRaw(root);
  return r && r !== 'unreadable' ? r.orchestratorMail : undefined;
}
