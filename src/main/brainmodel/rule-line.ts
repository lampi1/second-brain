// One line of an always-loaded file, replaced (issue #435, ADR 0320). Maintenance could add skills and lines to a
// role's text, but not fix a line of the fixed core every job loads (AGENTS.md, me.md…: brain.json fixedFiles): a fix
// that holds for every role landed in one role's text and the always-loaded file kept the old, wrong line. A research
// finding of kind rule with `file` and `before` now replaces exactly that line with `text`: the file must be one of the
// always-loaded ones, `before` must be one whole line of it, found once, and neither the old nor the new line may be
// about safety, permissions, settings, hooks, production or secrets (those stay the user's to edit by hand). The guard
// refuses when in doubt (five independent review passes, 2026-11-18): only a rule line is written or replaced, never a
// heading, a table's header, a code fence, a --- line or an HTML tag; only a plain ATX heading ends a section, every other
// heading form above the line is checked and ends nothing; a rule is read whole (the top-level item or paragraph the
// line is in), and a title or lead-in is not changed when a line under it is guarded; the words are read
// with accents, _ * ` ~, camelCase and invisible characters taken off; and the fixed core never grows past its budget
// (the launch would stop: rules/instructions.ts). It is a word list, not an understanding of the text: the user's yes
// on the exact line before and after stays the real check.
// editRuleLine is pure: the text in, the text out or the reason why not; editAlwaysLoaded adds the budget of the brain
// as it is; ruleLineChange is the tool's early check. Used by research.ts (maintenance_propose), research-candidate.ts
// (the candidate brain) and service.ts (a card applied alone); tests: test/unit/brainmodel/rule-line.test.ts.
import path from 'node:path';
import type { BrainRule } from '../../shared/brain-model';
import type { ResearchChange } from '../../shared/maintenance-research';
import { checkPermissionText } from '../agents/tool-policy';
import { configOf, read } from '../rules/storage';
import { itemKey } from './item-delta';
import { readRules, readSmall } from './model';

/** The longest line a finding may read or write. */
export const RULE_LINE_MAX = 800;

export type RuleLineWhy = 'shape' | 'same' | 'guarded' | 'structure' | 'missing' | 'twice' | 'budget';
export type RuleLineEdit = { ok: true; text: string } | { ok: false; why: RuleLineWhy };
/** Why a line edit is refused: `en` for the research (the tool's answer), `it` for the card and the candidate's notes. */
export const RULE_LINE_WHY: Readonly<Record<RuleLineWhy, { en: string; it: string }>> = {
  shape: { en: `before and text: one line each (no line break or control character), 1-${RULE_LINE_MAX} characters.`, it: 'riga vuota, troppo lunga o su più righe' },
  same: { en: 'text equals before: nothing would change.', it: 'la riga nuova è uguale a quella vecchia' },
  guarded: { en: 'Refused: a line about safety, permissions, settings, hooks, production or secrets (or one under such a heading) is changed only by the user.', it: 'riga su sicurezza, permessi, impostazioni, hook, produzione o segreti: la cambia solo l\'utente' },
  structure: { en: 'Refused: a line that shapes the document (a heading, a table\'s header, a code fence, a --- line, an HTML tag or comment) is not written or replaced this way, and a table row stays a row with the same cells; only a rule line is changed.', it: 'titolo, intestazione di tabella, blocco di codice o tag HTML: si cambiano solo le righe di regole' },
  missing: { en: 'before: not a line of that file. Copy the whole line exactly as it is now (read the file again).', it: 'la riga da cambiare non c\'è più nel file' },
  twice: { en: 'before: that line is in the file more than once; this change edits a line found exactly once.', it: 'la riga da cambiare è nel file più di una volta' },
  budget: { en: 'Refused: with this line the files loaded in every job would grow past their budget (every launch would stop). Propose a shorter line.', it: 'i file sempre caricati supererebbero il loro limite' },
};

/** Words of a line (or of a heading above it) the maintenance never edits (English, Italian, German): safety,
 *  permissions and approvals, settings and configuration, hooks, production and deploys, secrets. Read after the
 *  accents are taken off (NFKD), so the lists hold plain letters only. */
const GUARDED = new RegExp(`\\b(?:${[
  'safety|sicurezza|sicherheit\\w*|security|sudo|no[\\s-]*verify',
  'permission\\w*|permess[oi]|\\w*berechtigung\\w*|allowed[\\s_-]*tools|bypass\\w*|approv\\w*|autorizz\\w*|genehmig\\w*',
  'hooks?|settings?(?:\\.json)?|impostazion[ei]|\\w*einstellung\\w*|config\\w*|konfig\\w*',
  'prod|production|produzione|produktion\\w*|deploy\\w*',
  'secrets?|segret[oi]|geheim\\w*|credential\\w*|creds|credenzial[ei]|zugangsdaten|pass[\\s-]*(?:word|wort|worter|phrase)\\w*|passwd|kennwor\\w*|token|chiav[ei]',
  '(?:access|api|auth|bearer|private|ssh|signing|secret|personal|refresh|session)[\\s-]*(?:tokens?|keys?)',
].join('|')})\\b|(?<![\\w.])\\.env\\b`, 'i');
/** A variable that holds a secret by its name (GITHUB_TOKEN, $TOKEN, DB_PASSWORD). */
const ENV_SECRET = /(?:\b|_)(?:TOKEN|SECRET|PASSWORD|PASSWD|PWD)\b|[A-Z0-9]_(?:KEY|PAT)\b/;
/** A letter of another script beside a Latin one (a Cyrillic e inside «permissions»): read as a guarded word. */
const MIXED = /[A-Za-z][\p{Script=Cyrillic}\p{Script=Greek}]|[\p{Script=Cyrillic}\p{Script=Greek}][A-Za-z]/u;
const UNDERLINE = /^\s*(?:=+|-+)\s*$/;
const ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;
/** A line that shapes the document instead of stating a rule, never written and never replaced: a code fence, a
 *  heading («# …», also in a quote or a list), a rule line (---, ===, ***), an HTML comment mark, a line that starts
 *  with a tag, a tag that opens a raw block. Renaming «## Hard rules» or opening a comment above a section would
 *  change what the lines under it mean. */
const STRUCTURE = /^\s*(?:`{3,}|~{3,})|^[\s>]*(?:(?:[-*+]|\d+[.)])\s+)?#{1,6}(?:\s|$)|^\s*(?:[-=*_]\s*){3,}$|^\s*=+\s*$|<!--|-->|^\s*<[\/?!a-z]|<\/?(?:pre|script|style|textarea|details|div|table|h[1-6]|iframe|template|noscript|plaintext|xmp)\b/i;
/** The row of dashes under a table's header (with or without its outer pipes), which is also a Setext underline. */
const DASHES = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
/** The cell bars of a line: a table row has some, with or without the outer ones. */
const cellsOf = (l: string): number => (l.replace(/\\\|/g, '').match(/\|/g) ?? []).length;
const isRow = (l: string): boolean => cellsOf(l) > 0;
/** A line without its invisible characters and without the quote and list marks it sits in («- > # Old» is a heading). */
const bare = (l: string): string => l.replace(/\p{Cf}/gu, '').replace(/^(?:\s*(?:>|[-*+]|\d+[.)])(?:\s+|$))+/, '');
const shapes = (l: string): boolean => STRUCTURE.test(l.replace(/\p{Cf}/gu, '')) || STRUCTURE.test(bare(l)) || DASHES.test(l) || DASHES.test(bare(l)) || !bare(l).trim();

function guardedText(line: string): boolean {
  // accents and invisible characters off (a zero-width space inside a word), then the words also with their marks
  // taken apart: __Safety__, dangerously_skip_permissions, skipPermissions
  const raw = line.normalize('NFKD').replace(/[\p{M}\p{Cf}]/gu, '');
  const plain = raw.replace(/[_*`~]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  if (ENV_SECRET.test(raw) || MIXED.test(raw) || GUARDED.test(raw) || GUARDED.test(plain)) return true;
  try { checkPermissionText(line); return false; } catch { return true; }
}

/** A line that reads as a heading without being a plain ATX one: its text, else null. Any other «# …» (no space after,
 *  in a quote or a list, indented as code), an HTML heading, a Setext title (the whole paragraph over === or ---), a
 *  line that is all emphasis, a line that ends with a colon (a lead-in). */
function looseTitle(lines: readonly string[], i: number): string | null {
  const l = lines[i]!, body = l.replace(/^[\s>]*(?:(?:[-*+]|\d+[.)])\s+)?/, '').trim();
  if (!body) return null;
  if (/^#{1,6}/.test(body) || /<h[1-6]\b/i.test(body)) return body;
  if (UNDERLINE.test(lines[i + 1] ?? '') && !UNDERLINE.test(l)) {
    let from = i;
    while (from > 0 && lines[from - 1]!.trim()) from--;
    return lines.slice(from, i + 1).join(' ');
  }
  if (/^(\*\*|__|\*|_)(.+?)\1\s*(?::|\([^)]*\))?\s*:?$/.test(body) || /:$/.test(body)) return body;
  return null;
}

type Kind = 'fence' | 'code' | 'html' | 'head' | 'text';
/** What each line is for the document's shape: a code block's own marks, a line inside one, a line inside an HTML
 *  comment or raw block, a plain ATX heading (at most 3 spaces in, outside those), or text. A code block opens and
 *  closes as CommonMark says (its own marker, at least as long, nothing after it). */
function kindsOf(lines: readonly string[]): Kind[] {
  let fence = '', html = '';
  return lines.map((l): Kind => {
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(l);
      if (!close || close[1]![0] !== fence[0] || close[1]!.length < fence.length) return 'code';
      fence = '';
      return 'fence';
    }
    if (html) { if (l.toLowerCase().includes(html)) html = ''; return 'html'; }
    const open = /^ {0,3}(`{3,})[^`]*$/.exec(l) ?? /^ {0,3}(~{3,})/.exec(l);
    if (open) { fence = open[1]!; return 'fence'; }
    const tag = /<!--(?!.*-->)/.test(l) ? '-->' : /<(pre|script|style|textarea)\b(?!.*<\/\1>)/i.exec(l)?.[1];
    if (tag) { html = tag === '-->' ? tag : `</${tag.toLowerCase()}>`; return 'html'; }
    return /^ {0,3}#{1,6}[ \t]/.test(l) ? 'head' : 'text';
  });
}

/** The sections line `at` sits in, as the texts to check. Only a plain heading ends the sections of its level and
 *  below; every other heading form above the line and after the last plain heading is checked too and ends nothing,
 *  so no form hides a guarded section. A Setext title holds its level (=== 1, --- 2) against the plain headings after
 *  it. */
function sectionsOf(lines: readonly string[], kinds: readonly Kind[], at: number): string[] {
  let plain: { level: number; title: string }[] = [], loose: string[] = [];
  for (let i = 0; i < at; i++) {
    const l = lines[i]!, kind = kinds[i]!;
    if (kind === 'fence') continue;
    if (kind === 'head') {
      const level = /#+/.exec(l)![0].length;
      plain = [...plain.filter(h => h.level < level), { level, title: l }];
      loose = [];
    } else if (kind === 'text' && l.trim() && !UNDERLINE.test(l) && UNDERLINE.test(lines[i + 1] ?? '')) {
      plain.push({ level: lines[i + 1]!.trim().startsWith('=') ? 1 : 2, title: looseTitle(lines, i) ?? l });
    } else { const t = looseTitle(lines, i); if (t) loose.push(t); }
  }
  return [...plain.map(h => h.title), ...loose];
}

const indentOf = (l: string): number => /^[ \t]*/.exec(l)![0].replace(/\t/g, '    ').length;

/** The lines that make one rule with line `at`, first and last. In a table (rows with a row of dashes): the row, read
 *  with the table's header. Else the whole top-level item or paragraph the line is in, from its first line (an item
 *  at the margin, or a line at the margin after a blank line or a heading) to the line before the next one: its
 *  wrapped lines, every item under it, its second paragraph, its code block. A guarded word anywhere in it guards the
 *  line; the price is that the sub-items of one item stand or fall together. */
function ruleOf(lines: readonly string[], kinds: readonly Kind[], at: number): string {
  if (isRow(lines[at]!)) {
    let top = at, end = at;
    while (top > 0 && isRow(lines[top - 1]!)) top--;
    while (end + 1 < lines.length && isRow(lines[end + 1]!)) end++;
    // a table at the margin: the row and its header; one inside an item is read with the whole item, below
    if (indentOf(lines[top]!) === 0 && lines.slice(top, end + 1).some(l => DASHES.test(l))) return top === at ? lines[at]! : `${lines[top]!} ${lines[at]!}`;
  }
  const starts = (i: number): boolean => kinds[i] === 'head' || (kinds[i] === 'text' && !!lines[i]!.trim() && indentOf(lines[i]!) === 0
    && (ITEM.test(lines[i]!) || i === 0 || !lines[i - 1]!.trim() || kinds[i - 1] === 'head'));
  let a = at, b = at;
  while (a > 0 && !starts(a)) a--;
  while (b + 1 < lines.length && !starts(b + 1)) b++;
  return lines.slice(a, b + 1).join(' ');
}

/** The lines a title or a lead-in at `at` speaks for: down to the next plain heading. */
function governed(lines: readonly string[], kinds: readonly Kind[], at: number): string {
  let end = at + 1;
  while (end < lines.length && kinds[end] !== 'head') end++;
  return lines.slice(at + 1, end).join(' ');
}

/** `fileText` with its one line `before` replaced by `after` (the line's indentation, its trailing spaces, every line
 *  end and a byte order mark kept), or why not. A line is found by its trimmed text, inner spaces folded (as the item
 *  delta compares lines). */
export function editRuleLine(fileText: string, before: string, after: string): RuleLineEdit {
  const one = (s: unknown): s is string => typeof s === 'string' && !!s.trim() && s.length <= RULE_LINE_MAX && !/[\u0000-\u0008\u000a-\u001f\u007f\u0085\u2028\u2029]/.test(s.trim());
  if (!one(before) || !one(after)) return { ok: false, why: 'shape' };
  const want = itemKey(before), next = after.trim();
  if (itemKey(next) === want) return { ok: false, why: 'same' };
  // lines at the even places, their line ends (of every kind) at the odd ones: each stays as it is
  const bom = fileText.startsWith('\uFEFF') ? '\uFEFF' : '';
  const parts = fileText.slice(bom.length).split(/(\r\n|[\r\n\u0085\u2028\u2029])/);
  const lines = parts.filter((_, i) => i % 2 === 0);
  const hits = lines.flatMap((l, i) => (itemKey(l) === want ? [i] : []));
  if (!hits.length) return { ok: false, why: 'missing' };
  if (hits.length > 1) return { ok: false, why: 'twice' };
  const at = hits[0]!, old = lines[at]!;
  // a line that shapes the document, the line over a row of dashes (a table's header, a Setext title), and a table
  // row that would gain or lose cells: never written, never replaced
  const outer = (l: string) => `${/^\s*\|/.test(l)}${/\|\s*$/.test(l)}`;
  if (shapes(old) || shapes(next) || DASHES.test(lines[at + 1] ?? '') || cellsOf(old) !== cellsOf(next) || outer(old) !== outer(next)) return { ok: false, why: 'structure' };
  const written = `${/^\s*/.exec(old)![0]}${next}${/\s*$/.exec(old)![0]}`, after1 = lines.map((l, i) => (i === at ? written : l));
  // the document's shape before and after (the same, since no shaping line is written: computed twice to be sure)
  const kinds = kindsOf(lines), kinds1 = kindsOf(after1);
  // the whole rule is read, before and after, where the new line will stand
  // a title or a lead-in («Never do these:») speaks for the lines under it: not changed when one of them is guarded
  const leads = (all: readonly string[], k: readonly Kind[]) => looseTitle(all, at) !== null && guardedText(governed(all, k, at));
  if (guardedText(old) || guardedText(next) || guardedText(ruleOf(lines, kinds, at)) || guardedText(ruleOf(after1, kinds1, at)) || leads(lines, kinds) || leads(after1, kinds1)
    || sectionsOf(lines, kinds, at).some(guardedText)) return { ok: false, why: 'guarded' };
  // the line keeps its place in a list or a quote: its indentation stays, the new text brings its own marker
  parts[at * 2] = written;
  return { ok: true, text: bom + parts.join('') };
}

/** editRuleLine on the always-loaded file `rel` of the brain at `root`, refused also when the fixed core would grow
 *  past its budget: the launch stops over it (rules/instructions.ts), as the agents' write guard knows (rules/
 *  guards.ts). `planned` gives another always-loaded file's text in a plan not written yet. */
export function editAlwaysLoaded(root: string, rel: string, fileText: string, before: string, after: string, planned?: (rel: string) => string | null): RuleLineEdit {
  const r = editRuleLine(fileText, before, after);
  if (!r.ok) return r;
  try {
    const config = configOf(root), lf = (s: string) => s.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');   // as rules/storage.ts read() counts
    const size = (pick: (f: string) => string) => [...new Set(config.fixedFiles)].map(pick).filter(Boolean).join('\n\n').length;
    const was = size(f => read(root, f)), will = size(f => lf(f === rel ? r.text : planned?.(f) ?? read(root, f)));
    return will > was && will > config.fixedBudget ? { ok: false, why: 'budget' } : r;
  } catch { return r; /* a brain.json that does not read: no budget to hold */ }
}

/** The always-loaded file `rel` of the brain as it is now, or null (not one of them, a path that leaves the brain,
 *  missing or too big). */
export function alwaysLoadedText(root: string, rules: readonly Pick<BrainRule, 'file' | 'loaded'>[], rel: string): string | null {
  if (!rules.some(r => r.file === rel && r.loaded === 'always') || rel.split('/').some(p => !p || p === '.' || p === '..')) return null;
  return readSmall(path.join(root, ...rel.split('/')));
}

/** maintenance_propose's line edit (kind rule, no role, `file` + `before` + `text`), checked now so the research reads
 *  why not at once (English: the tool's answer). The candidate and the apply check it again: the file may change. */
export function ruleLineChange(root: string | null, o: { target?: unknown; role?: unknown; file?: unknown; before?: unknown; text?: unknown }): ResearchChange {
  if (o.target !== 'rule' || o.role) throw new Error('change.file and change.before: only with kind rule and no role (one line of an always-loaded file, replaced by change.text).');
  if (!root) throw new Error('No brain folder: nothing to change.');
  const rules = readRules(root), always = rules.filter(r => r.loaded === 'always').map(r => r.file);
  const rel = typeof o.file === 'string' ? o.file.trim().replace(/\\/g, '/') : '';
  if (!always.includes(rel)) throw new Error(`change.file: one of the files loaded in every job (${always.join(', ') || 'none in this brain'}); no other file is edited this way.`);
  const now = alwaysLoadedText(root, rules, rel);
  if (now === null) throw new Error('change.file: not readable (missing or too big).');
  const r = editAlwaysLoaded(root, rel, now, o.before as string, o.text as string);
  if (!r.ok) throw new Error(RULE_LINE_WHY[r.why].en);
  return { target: 'rule', file: rel, before: (o.before as string).trim(), text: (o.text as string).trim() };
}
