// The images of a report opened in the file viewer (issue #83: "the AT fix report with base64 images, a Markdown report
// with relative images ... all show the images"). Pure rules, shared by the Markdown and the HTML report views:
// - classifyImageSrc: what an <img src> of a report may become. An embedded raster (data:image/png|jpeg|webp;base64)
//   stays as it is (the CSP allows img-src data:); a local path (relative to the report's folder, absolute, or a
//   file:/// URL of this PC) is read by main (app:askImage: allowed folders, magic bytes, size) and handed back as a
//   data: URL; anything else (http, a network share, SVG, another scheme) is never loaded.
// - embeddedRasterOk: an embedded raster is shown only when its header says a sane size (at most 16384 px a side and
//   64 million pixels), checked before Chromium decodes it.
// - scrubCss: a report's own CSS without anything that could load from outside (url(), @import, image-set,
//   expression(), behaviors), so a style can never fetch.
// Used by brain/components/ReportImages.tsx and brain/components/ReportHtml.tsx; pinned by test/unit/report-images.test.ts.
import {plainPath} from '../../lib/pathPatterns';
import {avatarRasterSize} from '../../lib/avatar-raster';

export type ImageSrc = { kind: 'data'; src: string } | { kind: 'local'; path: string } | { kind: 'blocked'; why: 'remote' | 'type' };

const RASTER = /\.(png|jpe?g|webp)$/i;
const DATA_RASTER = /^data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=\s]+$/i;
const WIN_ABS = /^[a-z]:[\\/]/i;

/** The folder of a file path, with its own separator style. */
export function dirOf(file: string): string {
  const i = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'));
  return i < 0 ? '' : file.slice(0, i);
}

/** `rel` against folder `dir` with `.` and `..` resolved (never above the drive or the root). Windows paths come back
 *  with backslashes, POSIX ones with slashes. */
export function joinPath(dir: string, rel: string): string {
  const win = WIN_ABS.test(dir);
  const parts = `${dir}/${rel}`.split(/[\\/]+/);
  const head = win ? parts.shift()! : '';
  const out: string[] = [];
  for (const p of parts) { if (!p || p === '.') continue; if (p === '..') out.pop(); else out.push(p); }
  return win ? `${head}\\${out.join('\\')}` : `/${out.join('/')}`;
}

/** What one image source of the report at `file` becomes (see the header). */
export function classifyImageSrc(raw: string, file: string): ImageSrc {
  const src = raw.trim();
  if (/^data:/i.test(src)) return DATA_RASTER.test(src) ? { kind: 'data', src: src.replace(/\s+/g, '') } : { kind: 'blocked', why: 'type' };
  if (!src || /^[\\/]{2}/.test(src) || /[\u0000-\u001f]/.test(src)) return { kind: 'blocked', why: 'remote' };
  let path: string;
  if (/^file:/i.test(src)) {
    // only file:///C:/… or file:///home/…: a host name (file://server/share) is a network share
    if (!/^file:\/\/\//i.test(src)) return { kind: 'blocked', why: 'remote' };
    path = plainPath(src.replace(/[?#].*$/, ''));
  } else if (WIN_ABS.test(src) || (src.startsWith('/') && !src.startsWith('//'))) {
    path = plainPath(safeDecode(src.replace(/[?#].*$/, '')));
  } else if (/^[a-z][\w+.-]*:/i.test(src)) {
    return { kind: 'blocked', why: 'remote' };
  } else {
    const base = dirOf(file);
    if (!base || !(WIN_ABS.test(base) || base.startsWith('/')) || /^[\\/]{2}/.test(base)) return { kind: 'blocked', why: 'remote' };
    path = joinPath(base, safeDecode(src.replace(/[?#].*$/, '')));
  }
  if (/^[\\/]{2}/.test(path)) return { kind: 'blocked', why: 'remote' };
  return RASTER.test(path) ? { kind: 'local', path } : { kind: 'blocked', why: 'type' };
}

function safeDecode(s: string): string { try { return decodeURIComponent(s); } catch { return s; } }

/** A report's CSS that can never load anything: every url(…) and image-set(…) becomes `none`, @import and the legacy
 *  script hooks (expression(), behavior, -moz-binding) go away. Also bounded in size. */
export function scrubCss(css: string): string {
  return css.slice(0, 200_000)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // CSS escapes decoded first (u\72l( is url(), so nothing hides behind them
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_m, hex: string) => { const n = parseInt(hex, 16); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''; })
    .replace(/\\(.)/g, '$1').replace(/\\/g, '')
    .replace(/@import[^;]*;?/gi, '')
    .replace(/@font-face\s*\{[^}]*\}/gi, '')
    .replace(/(?:-webkit-)?image-set\s*\((?:[^()]|\([^()]*\))*\)/gi, 'none')
    .replace(/url\s*\((?:[^()]|\([^()]*\))*\)/gi, 'none')
    .replace(/expression\s*\(/gi, 'none(')
    .replace(/(?:behavior|-moz-binding)\s*:[^;}]*/gi, '');
}

/** Max side and pixels of an image embedded in a report (a full-page screenshot is tall). */
export const EMBEDDED_MAX_SIDE = 16384, EMBEDDED_MAX_PIXELS = 64_000_000;
/** Does this data: raster (already DATA_RASTER-shaped) declare a size the viewer may decode? */
export function embeddedRasterOk(dataUrl: string): boolean {
  const m = /^data:image\/(png|jpe?g|webp);base64,(.*)$/is.exec(dataUrl);
  if (!m) return false;
  const mime = `image/${m[1]!.toLowerCase() === 'jpg' ? 'jpeg' : m[1]!.toLowerCase()}`;
  let bytes: Uint8Array;
  try { const text = atob(m[2]!.replace(/\s+/g, '')); bytes = Uint8Array.from(text, c => c.charCodeAt(0)); } catch { return false; }
  const size = avatarRasterSize(bytes, mime, { min: 1, max: EMBEDDED_MAX_SIDE });
  return !!size && size.width * size.height <= EMBEDDED_MAX_PIXELS;
}
