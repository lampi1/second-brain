// Resolves a file path named in a chat message (a path in `inline code` or a visual's diffList) to an absolute local
// path. The path comes from a model's text, so it is untrusted: the rules of open-path.ts (an absolute local path, with a
// drive letter on Windows, or one relative to the chat's own folder without `..`; never a UNC share). Used by
// file-view.ts; pinned by test/unit/peek-file.test.ts.
import path from 'node:path';
import { localPath } from './open-path';

/** A path from a message → an absolute local path: absolute as open-path.ts allows, or relative inside `cwd`. */
export function resolvePeek(raw: string, cwd?: string, platform: NodeJS.Platform = process.platform): string | null {
  const abs = localPath(raw, platform);
  if (abs) return abs;
  const p = raw.trim().replace(/^<|>$/g, '');
  const base = cwd ? localPath(cwd, platform) : null;
  if (!base || !p || /^[\\/]/.test(p) || /^[a-z][a-z0-9+.-]*:/i.test(p) || p.includes(':')) return null;
  if (p.split(/[\\/]/).includes('..')) return null;
  return (platform === 'win32' ? path.win32 : path.posix).join(base, p);
}
