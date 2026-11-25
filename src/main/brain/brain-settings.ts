// Reads the brain's delivery timing words (orchestratorMail) for chats/orchestrator-delivery.ts. UTF-8 (with or without BOM)
// and UTF-16 LE files are accepted. The retired crossHarnessMessages key is ignored (ADR 0352).
import fs from 'node:fs';
import path from 'node:path';

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

/** The words that time the mail to an Orchestrator without a sender's kind (`orchestratorMail`: { urgent, progress, action } lists,
 *  chats/orchestrator-delivery.ts). undefined = the file says nothing or is unreadable: the defaults apply. */
export function readOrchestratorMail(root: string): unknown {
  const r = readRaw(root);
  return r && r !== 'unreadable' ? r.orchestratorMail : undefined;
}
