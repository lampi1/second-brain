// Confined file access and serialized atomic updates for product rules. Never follows brain links or reads credentials.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BrainRulesConfig } from './types';

export const DEFAULT_RULES: BrainRulesConfig = {
  fixedFiles: ['AGENTS.md', 'me.md', 'CLAUDE.md'], fixedBudget: 15_000,
  topicFiles: ['code.md', 'brain-rules.md', 'hub.md'], turnBudget: 6000, nowLineLimit: 250, autoCommit: false, claudeLaunch: true, appRules: false,
};
export function confined(root: string, relative: string): string {
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some(p => !p || p === '..' || p === '.') || /[:\x00-\x1f]/.test(relative)) throw new Error('Use a relative brain path without traversal.');
  const base = fs.realpathSync(root);
  let cursor = base;
  for (const part of relative.split(/[\\/]/)) {
    cursor = path.join(cursor, part);
    try { if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('Brain links are not allowed.'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
  return cursor;
}
export function read(root: string, relative: string): string {
  const file = confined(root, relative);
  try {
    if (fs.statSync(file).size > 2_000_000) throw new Error('Brain file exceeds 2 MB.');
    return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw e; }
}
export function configOf(root: string): BrainRulesConfig {
  const raw = read(root, 'brain.json');
  const input = raw ? (JSON.parse(raw) as { rules?: Partial<BrainRulesConfig> }).rules ?? {} : {};
  const c = { ...DEFAULT_RULES, ...input };
  for (const key of ['fixedBudget', 'turnBudget', 'nowLineLimit'] as const) {
    if (!Number.isSafeInteger(c[key]) || c[key] < 100 || c[key] > 100_000) throw new Error(`Invalid rules.${key}.`);
  }
  for (const list of [c.fixedFiles, c.topicFiles]) {
    if (!Array.isArray(list) || list.length > 100) throw new Error('Invalid rule file list.');
    for (const p of list) { if (typeof p !== 'string' || !p.endsWith('.md')) throw new Error('Rule files must be Markdown.'); confined(root, p); }
  }
  if (typeof c.autoCommit !== 'boolean') throw new Error('Invalid rules.autoCommit.');
  if (typeof c.claudeLaunch !== 'boolean') throw new Error('Invalid rules.claudeLaunch.');
  if (typeof c.appRules !== 'boolean') throw new Error('Invalid rules.appRules.');
  return c;
}
export function atomicWrite(root: string, relative: string, text: string): void {
  const file = confined(root, relative);
  const temp = `${file}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temp, text, { flag: 'wx', mode: 0o600 }); renameRetrying(temp, file); }
  finally { fs.rmSync(temp, { force: true }); }
}
/** On Windows an antivirus or indexer briefly holding the target makes rename fail with EPERM/EACCES/EBUSY: retry a
 * few times with a short pause (~1 s in all) before giving up with the real error. */
export function renameRetrying(from: string, to: string): void {
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(from, to); return; } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (attempt >= 8 || (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY')) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 * (attempt + 1));
    }
  }
}
/** Locks are never stolen on time alone: a crashed writer requires an explicit recovery, avoiding two writers. */
export function locked<T>(root: string, name: string, action: () => T): T {
  const lock = confined(root, `${name}.lock`);
  const fd = fs.openSync(lock, 'wx', 0o600);
  try { return action(); } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
