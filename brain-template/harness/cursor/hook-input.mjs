// Parses a Cursor hook's JSON input. Two Cursor-on-Windows quirks seen 2026-10-10:
// - a UTF-8 BOM in front (every JSON.parse failed with "Unexpected token '﻿'");
// - text double-encoded: the UTF-8 bytes read as Windows-1252 and sent again as UTF-8 ("£è" arrives as "Â£Ã¨"),
//   so a task with accents or symbols reached Opus garbled. fixMojibake undoes it only when the WHOLE text is such
//   a double encoding (every char maps back to one 1252 byte and the bytes are valid UTF-8); otherwise it is unchanged.
// Throws on invalid JSON: each hook decides what a parse error means (prod-guard: blocked; the others: no output).
const CP1252 = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92,
  0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A,
  0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F };
// a lead byte of a 2-4 byte UTF-8 sequence (Â..ô) followed by a continuation byte (0x80-0xBF as 1252 text)
const MOJIBAKE = /[Â-ô][\u0080-¿ŒœŠšŸŽžƒˆ˜–—‘-„†-•…‰‹›€™]/;

export function fixMojibake(text) {
  const s = String(text ?? '');
  if (!MOJIBAKE.test(s)) return s;
  const bytes = [];
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c <= 0xFF) bytes.push(c);
    else if (CP1252[c] !== undefined) bytes.push(CP1252[c]);
    else return s; // a real character outside 1252: the text is not double-encoded
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes)); } catch { return s; }
}

// The repair is opt-in (capture only: the task text kept for Opus). Never in guards: prod-guard must judge the command
// exactly as the shell gets it (a crafted "Ã”" would otherwise lose a closing quote), brain-limits the exact text.
const deep = v => (typeof v === 'string' ? fixMojibake(v)
  : Array.isArray(v) ? v.map(deep)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) : v);
export const parseHookJson = (raw, { repair = false } = {}) => {
  const v = JSON.parse(String(raw ?? '').replace(/^﻿/, '').trim() || '{}');
  return repair ? deep(v) : v;
};
