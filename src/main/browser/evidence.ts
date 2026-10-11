// Where QA evidence goes: <userData>/evidence/<group folder>/ (screenshots with save_to, downloads, response bodies).
// Agent-given names are confined to that folder (no absolute paths, no "..", safe characters only). Pure, unit-tested;
// used by browser/actions.ts and browser/tabs.ts (downloads).
import path from 'node:path';

/** 'chat:c_12' → 'chat-c_12', 'mcp:<uuid>' → 'external-<first 8>', 'user' → 'user'. */
export function groupFolder(group: string): string {
  if (group.startsWith('mcp:')) return `external-${safe(group.slice(4)).slice(0, 8) || 'default'}`;
  return safe(group.replace(':', '-')) || 'misc';
}

function safe(s: string): string { return s.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^\.+/, '').slice(0, 80); }

/** Absolute path for an agent-chosen file name inside dir (sub-folders allowed, never outside); adds ext if missing. */
export function evidencePath(dir: string, name: string, ext: string): string {
  const raw = String(name ?? '').trim();
  if (!raw) throw new Error('save_to is empty: pass a file name like "step-3-login.png".');
  if (path.isAbsolute(raw) || /^[a-z]:/i.test(raw) || raw.startsWith('\\\\')) throw new Error(`save_to must be a file name inside the evidence folder, not an absolute path: "${raw}".`);
  const parts = raw.split(/[\\/]+/).filter(Boolean);
  if (!parts.length || parts.some(p => p === '..' || p === '.')) throw new Error(`save_to must not contain "." or ".." segments: "${raw}".`);
  const clean = parts.map(p => safe(p)).filter(Boolean);
  let file = clean.join(path.sep);
  if (!file) throw new Error(`save_to has no usable characters: "${raw}".`);
  if (!file.toLowerCase().endsWith(ext.toLowerCase())) file += ext;
  const full = path.resolve(dir, file);
  const root = path.resolve(dir);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error(`save_to escapes the evidence folder: "${raw}".`);
  return full;
}

/** A timestamped default name: "shot-2026-10-11T10-02-03-123Z.png". */
export function stampName(prefix: string, ext: string, now = new Date()): string {
  return `${prefix}-${now.toISOString().replace(/[:.]/g, '-')}${ext}`;
}
