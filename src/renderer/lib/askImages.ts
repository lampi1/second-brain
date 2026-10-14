// Which images a question shows (the user, 2026-10-14: "mi piacerebbe che le immagini si potessero vedere direttamente
// nella domanda"): the local PNG, JPG and WebP files a chat names in its question, an option (label, description,
// preview) or the turn's prose: markdown images `![testo](C:\…\x.png)`, `file:///` URLs and bare absolute paths
// (`C:\…\x.png`; a path with spaces only inside `![](<…>)` or a file:/// URL). Each with a caption: the markdown text,
// else the option it came from, else the file name. Also strips the markdown image syntax from a text shown as plain
// (a question's title). Pure: main reads the files (app:askImage, main/ask-image.ts). Used by AskContext.tsx and
// RequestPanel.tsx; pinned by test/unit/askImages.test.ts.

export interface AskImage { path: string; caption: string }

const EXT = String.raw`\.(?:png|jpe?g|webp)`;
const MD_IMG = new RegExp(String.raw`!\[([^\]\n]{0,200})\]\(\s*<?((?:file:\/\/\/)?[a-zA-Z]:[\\/][^)>\n]*?${EXT})>?\s*\)`, 'gi');
const FILE_URL = new RegExp(String.raw`file:\/\/\/[a-zA-Z]:[\\/][^\s<>"'\`)\]]*?${EXT}\b`, 'gi');
const WIN = new RegExp(String.raw`(?<![\w/\\:])[a-zA-Z]:[\\/][^\s<>"'\`|*?)\]]*?${EXT}\b`, 'gi');
const MAX = 8;

function decode(p: string): string {
  let x = p.replace(/^file:\/\/\//i, '');
  if (/^file:/i.test(p)) { try { x = decodeURIComponent(x); } catch { /* as is */ } }
  return x.replace(/\//g, '\\');
}
const name = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** The images named in these texts, in order, without repeats (at most 8). */
export function imagesIn(texts: readonly { text: string; caption?: string }[]): AskImage[] {
  const out: AskImage[] = [];
  const seen = new Set<string>();
  const add = (raw: string, caption: string) => {
    const p = decode(raw.trim());
    const k = p.toLowerCase();
    if (seen.has(k) || out.length >= MAX) return;
    seen.add(k);
    out.push({ path: p, caption: caption.trim() || name(p) });
  };
  for (const t of texts) {
    if (!t.text) continue;
    let rest = t.text.replace(MD_IMG, (_m, alt: string, src: string) => { add(src, alt || t.caption || ''); return ' '; });
    rest = rest.replace(FILE_URL, m => { add(m, t.caption ?? ''); return ' '; });
    for (const m of rest.matchAll(WIN)) add(m[0], t.caption ?? '');
  }
  return out;
}

/** A text without its markdown images (they show as thumbnails), spaces tidied. */
export const withoutImages = (text: string): string => text.replace(MD_IMG, ' ').replace(/[ \t]{2,}/g, ' ').trim();
