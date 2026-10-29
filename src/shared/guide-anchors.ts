// Guida anchors (ADR 0196): a card's point names the code it describes ("src/main/chats/manager.ts#settleReport"), so the
// app can tell when that code changed after the text was written. This file is the pure half: the anchor shape, how a
// named symbol's source block is cut out of a file (function, class, const, interface, type, method, object key or a
// quoted name such as an IPC channel or a tool name; no symbol = the whole file), the text normalized before it is hashed
// (line endings and trailing blanks never count) and the comparison against the stored hashes. Hashing itself (node:crypto)
// and reading files stay in main (main/guide/anchors.ts) and in scripts/guide-anchors.mjs, which writes the stored hashes
// to src/shared/guide-anchors.json. Used by concept-guide.ts (the type), main/guide/*, the script and
// test/unit/guide-anchors.test.ts. No Node, no DOM: the renderer may import the types.

/** "path" (the whole file) or "path#symbol", repo-relative with forward slashes. */
export type AnchorRef = string;
/** A card's anchors by point index (0-based, the order of `points`); -1 = the card as a whole (its tech part). */
export type CardAnchors = Readonly<Record<number, readonly AnchorRef[]>>;

export interface ParsedAnchor { file: string; symbol: string | null }
export function parseAnchor(ref: AnchorRef): ParsedAnchor {
  const i = ref.indexOf('#');
  return i < 0 ? { file: ref, symbol: null } : { file: ref.slice(0, i), symbol: ref.slice(i + 1) || null };
}

/** The stored file (src/shared/guide-anchors.json): one hash per distinct anchor. */
export interface StoredAnchors { version: 1; hashes: Record<AnchorRef, string> }

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The line where `symbol` is declared: a top-level declaration first, then a class member or object key, then a quoted
 *  name ('agents:metrics', name: 'app_create_chat'). -1 when the file never names it that way. */
export function findDeclaration(lines: readonly string[], symbol: string): number {
  const s = esc(symbol);
  const patterns = [
    new RegExp(`^\\s*(export\\s+)?(default\\s+)?(declare\\s+)?(async\\s+)?function\\*?\\s+${s}\\b`),
    new RegExp(`^\\s*(export\\s+)?(declare\\s+)?(const|let|var)\\s+${s}\\b`),
    new RegExp(`^\\s*(export\\s+)?(default\\s+)?(abstract\\s+)?class\\s+${s}\\b`),
    new RegExp(`^\\s*(export\\s+)?(declare\\s+)?(interface|type|enum)\\s+${s}\\b`),
    new RegExp(`^\\s+((private|public|protected|static|async|readonly|override|get|set)\\s+)*${s}\\s*(<[^>]*>)?\\s*\\(`),
    new RegExp(`^\\s+(readonly\\s+)?${s}\\??\\s*[:=]`),
    new RegExp(`['"\`]${s}['"\`]`),
  ];
  for (const re of patterns) {
    const at = lines.findIndex(l => re.test(l));
    if (at >= 0) return at;
  }
  return -1;
}

/** A line that does not finish a statement: the declaration goes on below it. */
const CONTINUES = /(=>|=|\?|:|&&|\|\||\+|\?\?|\|)\s*$/;

/** The source of the declaration that starts on line `start`: brackets counted (strings, template literals and
 *  comments skipped), up to the end of the line where they close again. Deterministic, so a hash of it is stable;
 *  not a parser (a regex literal with a lone bracket may cut a block short or long, the same way every time). */
export function blockFrom(lines: readonly string[], start: number): string {
  let depth = 0, opened = false, inBlockComment = false;
  let quote: string | null = null;
  const out: string[] = [];
  for (let n = start; n < lines.length; n++) {
    const line = lines[n]!;
    out.push(line);
    for (let i = 0; i < line.length; i++) {
      const c = line[i]!, next = line[i + 1];
      if (inBlockComment) { if (c === '*' && next === '/') { inBlockComment = false; i++; } continue; }
      if (quote) {
        if (c === '\\') { i++; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === '/' && next === '/') break;
      if (c === '/' && next === '*') { inBlockComment = true; i++; continue; }
      if (c === '"' || c === '\'' || c === '`') { quote = c; continue; }
      if (c === '{' || c === '(' || c === '[') { depth++; opened = true; }
      else if (c === '}' || c === ')' || c === ']') depth = Math.max(0, depth - 1);
    }
    // a '...' or "..." string never spans lines; a template literal may
    if (quote === '\'' || quote === '"') quote = null;
    if (depth === 0 && !quote && !inBlockComment && (opened || /;\s*$/.test(line)) && !CONTINUES.test(line)) break;
    if (n - start > 4000) break;
  }
  return out.join('\n');
}

/** What an anchor's hash is taken of: the symbol's block, or the whole file; null = the symbol is not in the file. */
export function anchorSource(fileText: string, symbol: string | null): string | null {
  const text = normalize(fileText);
  if (!symbol) return text;
  const lines = text.split('\n');
  const at = findDeclaration(lines, symbol);
  return at < 0 ? null : blockFrom(lines, at);
}

/** CRLF and trailing blanks never count: a Windows checkout hashes like a Linux one. */
export function normalize(s: string): string {
  return s.replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/[ \t]+$/, '')).join('\n').replace(/\n+$/, '');
}

/** Every anchor of every card, with where it is used. */
export interface AnchorUse { card: string; point: number; ref: AnchorRef }
export function anchorUses(cards: readonly { id: string; anchors?: CardAnchors }[]): AnchorUse[] {
  const out: AnchorUse[] = [];
  for (const c of cards) for (const [k, refs] of Object.entries(c.anchors ?? {})) for (const ref of refs) out.push({ card: c.id, point: Number(k), ref });
  return out;
}

/** One card with code that changed after its text was written (or an anchor whose symbol is gone). */
export interface StaleCard { id: string; points: number[]; anchors: { ref: AnchorRef; point: number; why: 'changed' | 'missing' | 'new' }[] }

/** Compares the current hashes (null = the symbol is gone) with the stored ones: the cards to re-read. */
export function staleCards(uses: readonly AnchorUse[], stored: Readonly<Record<string, string>>, current: (ref: AnchorRef) => string | null): StaleCard[] {
  const byCard = new Map<string, StaleCard>();
  const cache = new Map<string, string | null>();
  for (const u of uses) {
    if (!cache.has(u.ref)) cache.set(u.ref, current(u.ref));
    const now = cache.get(u.ref) ?? null, was = stored[u.ref];
    const why = now === null ? 'missing' : was === undefined ? 'new' : was !== now ? 'changed' : null;
    if (!why) continue;
    const c = byCard.get(u.card) ?? { id: u.card, points: [], anchors: [] };
    if (u.point >= 0 && !c.points.includes(u.point)) c.points.push(u.point);
    c.anchors.push({ ref: u.ref, point: u.point, why });
    byCard.set(u.card, c);
  }
  return [...byCard.values()];
}
