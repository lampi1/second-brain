// The shapes of a local file path inside a chat's text, on every OS (ADR 0054): a Windows drive path (C:\x or C:/x) or a
// macOS/Linux path under a usual root (/Users, /home, /tmp, /Volumes…). A bare POSIX path is recognised only under these
// roots, so an API route or a URL path in prose ("/api/v1/x.json") never turns into a file link. Pure regex sources;
// main checks every path again (open-path.ts). Used by askContext.ts and askImages.ts.

/** Start of a Windows absolute path. */
export const DRIVE = String.raw`[a-zA-Z]:[\\/]`;
/** Start of a macOS/Linux absolute path under a usual root. */
export const POSIX_ROOT = String.raw`\/(?:Users|home|tmp|private|var\/folders|Volumes|opt|mnt|media|srv|root)\/`;
/** Start of a local path of any OS. */
export const LOCAL_START = `(?:${DRIVE}|${POSIX_ROOT})`;

/** A file: URL or a matched path → the plain path: Windows paths with backslashes, POSIX paths as they are. */
export function plainPath(p: string): string {
  let x = p;
  if (/^file:/i.test(x)) {
    x = x.replace(/^file:\/\//i, '');
    try { x = decodeURIComponent(x); } catch { /* as is */ }
    if (/^\/[a-zA-Z]:[\\/]/.test(x)) x = x.slice(1);
  }
  return /^[a-zA-Z]:[\\/]/.test(x) ? x.replace(/\//g, '\\') : x;
}
