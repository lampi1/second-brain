// One line of an always-loaded file, replaced (issue #435, ADR 0320). Maintenance could add skills and lines to a
// role's text, but not fix a line of the fixed core every job loads (AGENTS.md, me.md…: brain.json fixedFiles): a fix
// that holds for every role landed in one role's text and the always-loaded file kept the old, wrong line. A research
// finding of kind rule with `file` and `before` now replaces exactly that line with `text`: the file must be one of the
// always-loaded ones, `before` must be one whole line of it, found once, and neither the old nor the new line may be
// about safety, permissions, settings, hooks, production or secrets (those stay the user's to edit by hand). The guard
// refuses when in doubt: only a plain ATX heading ends a section, every other heading form (Setext, an all-bold line, a
// «# …» in a code block or a comment, a label ending with a colon) is checked and ends nothing; a rule wrapped on more
// lines is read whole; the words are also looked for with _ * ` ~ and camelCase taken apart and invisible characters
// off; a code fence line is never written or removed; and the fixed core never grows past its budget (the launch
// would stop: rules/instructions.ts).
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

export type RuleLineWhy = 'shape' | 'same' | 'guarded' | 'fence' | 'missing' | 'twice' | 'budget';
export type RuleLineEdit = { ok: true; text: string } | { ok: false; why: RuleLineWhy };
/** Why a line edit is refused: `en` for the research (the tool's answer), `it` for the card and the candidate's notes. */
export const RULE_LINE_WHY: Readonly<Record<RuleLineWhy, { en: string; it: string }>> = {
  shape: { en: `before and text: one line each (no line break or control character), 1-${RULE_LINE_MAX} characters.`, it: 'riga vuota, troppo lunga o su più righe' },
  same: { en: 'text equals before: nothing would change.', it: 'la riga nuova è uguale a quella vecchia' },
  guarded: { en: 'Refused: a line about safety, permissions, settings, hooks, production or secrets (or one under such a heading) is changed only by the user.', it: 'riga su sicurezza, permessi, impostazioni, hook, produzione o segreti: la cambia solo l\'utente' },
  fence: { en: 'Refused: a line that opens or closes a code block (``` or ~~~) is not written or replaced this way.', it: 'riga che apre o chiude un blocco di codice' },
  missing: { en: 'before: not a line of that file. Copy the whole line exactly as it is now (read the file again).', it: 'la riga da cambiare non c\'è più nel file' },
  twice: { en: 'before: that line is in the file more than once; this change edits a line found exactly once.', it: 'la riga da cambiare è nel file più di una volta' },
  budget: { en: 'Refused: with this line the files loaded in every job would grow past their budget (every launch would stop). Propose a shorter line.', it: 'i file sempre caricati supererebbero il loro limite' },
};

/** Words of a line (or of a heading above it) the maintenance never edits (English, Italian, German). */
const GUARDED = /\b(?:safety|sicurezza|sicherheit\w*|security|permission\w*|permess[oi]|\w*berechtigung\w*|allowed[\s_-]*tools|bypass\w*|hooks?|settings?(?:\.json)?|impostazion[ei]|\w*einstellung\w*|prod|production|produzione|produktion\w*|secrets?|segret[oi]|geheim\w*|credential\w*|credenzial[ei]|zugangsdaten|passw(?:[oö]r|d)\w*|kennw[oö]r\w*|(?:access|api|auth|bearer|private|ssh|signing|secret|personal|refresh|session)[\s-]*(?:tokens?|keys?))\b/i;
/** A variable that holds a secret by its name (GITHUB_TOKEN, $TOKEN, DB_PASSWORD). */
const ENV_SECRET = /(?:\b|_)(?:TOKEN|SECRET|PASSWORD|PASSWD|PWD)\b|[A-Z0-9]_(?:KEY|PAT)\b/;
/** A letter of another script beside a Latin one (pеrmissions with a Cyrillic е): read as a guarded word. */
const MIXED = /[A-Za-z][\p{Script=Cyrillic}\p{Script=Greek}]|[\p{Script=Cyrillic}\p{Script=Greek}][A-Za-z]/u;
/** A line that starts like a code fence, whatever follows: never written, never replaced. */
const FENCE = /^\s*(`{3,}|~{3,})/;
const UNDERLINE = /^\s*(?:=+|-+)\s*$/;
const ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;

function guardedText(line: string): boolean {
  // invisible characters off (a zero-width space inside a word), then the words also with their marks taken apart:
  // __Safety__, dangerously_skip_permissions, skipPermissions
  const raw = line.normalize('NFKC').replace(/[\p{Cf}͏]/gu, '');
  const plain = raw.replace(/[_*`~]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  if (ENV_SECRET.test(raw) || MIXED.test(raw) || GUARDED.test(raw) || GUARDED.test(plain)) return true;
  try { checkPermissionText(line); return false; } catch { return true; }
}

/** A line that reads as a heading without being a plain ATX one: its text, else null. Any other «# …» (no space after,
 *  in a quote or a list, indented as code), an HTML heading, a Setext title (the whole paragraph over === or ---), a
 *  line that is all emphasis, a short line that ends with a colon. */
function looseTitle(lines: readonly string[], i: number): string | null {
  const l = lines[i]!, body = l.replace(/^[\s>]*(?:(?:[-*+]|\d+[.)])\s+)?/, '').trim();
  if (!body) return null;
  if (/^#{1,6}/.test(body) || /<h[1-6]\b/i.test(body)) return body;
  if (UNDERLINE.test(lines[i + 1] ?? '') && !UNDERLINE.test(l)) {
    let from = i;
    while (from > 0 && lines[from - 1]!.trim()) from--;
    return lines.slice(from, i + 1).join(' ');
  }
  if (/^(\*\*|__|\*|_)(.+?)\1\s*(?::|\([^)]*\))?\s*:?$/.test(body) || (body.length <= 80 && /:$/.test(body))) return body;
  return null;
}

/** The sections line `at` sits in, as the texts to check. Only a plain ATX heading (at most 3 spaces in, outside a code
 *  block and an HTML comment or <pre>) ends the sections of its level and below; every other heading form above the
 *  line and after the last plain heading is checked too and ends nothing, so no form hides a guarded section. A code
 *  block opens and closes as CommonMark says (its own marker, at least as long, nothing after it). */
function sectionsOf(lines: readonly string[], at: number): string[] {
  let plain: { level: number; title: string }[] = [], loose: string[] = [];
  let fence = '', html = '';
  const note = (i: number) => { const t = looseTitle(lines, i); if (t) loose.push(t); };
  for (let i = 0; i < at; i++) {
    const l = lines[i]!;
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(l);
      if (close && close[1]![0] === fence[0] && close[1]!.length >= fence.length) fence = ''; else note(i);
      continue;
    }
    if (html) { if (l.toLowerCase().includes(html)) html = ''; note(i); continue; }
    const open = /^ {0,3}(`{3,})[^`]*$/.exec(l) ?? /^ {0,3}(~{3,})/.exec(l);
    if (open) { fence = open[1]!; continue; }
    const tag = /<!--(?!.*-->)/.test(l) ? '-->' : /<(pre|script|style|textarea)\b(?!.*<\/\1>)/i.exec(l)?.[1];
    if (tag) { html = tag === '-->' ? tag : `</${tag.toLowerCase()}>`; note(i); continue; }
    const atx = /^ {0,3}(#{1,6})[ \t]+(.+)$/.exec(l);
    if (atx) { plain = [...plain.filter(h => h.level < atx[1]!.length), { level: atx[1]!.length, title: atx[2]! }]; loose = []; } else note(i);
  }
  return [...plain.map(h => h.title), ...loose];
}

/** The list item or paragraph line `at` is part of, first and last line: a rule wrapped on two lines is one rule. */
function blockOf(lines: readonly string[], at: number): [number, number] {
  const starts = (l: string) => ITEM.test(l) || /^\s*(?:#{1,6}|\|)/.test(l) || FENCE.test(l);
  let a = at, b = at;
  while (a > 0 && !starts(lines[a]!) && lines[a - 1]!.trim() && !/^\s*#{1,6}/.test(lines[a - 1]!) && !FENCE.test(lines[a - 1]!)) a--;
  while (b + 1 < lines.length && lines[b + 1]!.trim() && !starts(lines[b + 1]!)) b++;
  return [a, b];
}

/** `fileText` with its one line `before` replaced by `after` (the line's indentation, its trailing spaces and every
 *  line end kept), or why not. A line is found by its trimmed text, inner spaces folded (as the item delta compares
 *  lines). */
export function editRuleLine(fileText: string, before: string, after: string): RuleLineEdit {
  const one = (s: unknown): s is string => typeof s === 'string' && !!s.trim() && s.length <= RULE_LINE_MAX && !/[\u0000-\u0008\u000a-\u001f\u007f\u0085\u2028\u2029]/.test(s.trim());
  if (!one(before) || !one(after)) return { ok: false, why: 'shape' };
  const want = itemKey(before), next = after.trim();
  if (itemKey(next) === want) return { ok: false, why: 'same' };
  // lines at the even places, their line ends (of every kind) at the odd ones: each stays as it is
  const parts = fileText.split(/(\r\n|[\r\n\u0085\u2028\u2029])/);
  const lines = parts.filter((_, i) => i % 2 === 0);
  const hits = lines.flatMap((l, i) => (itemKey(l) === want ? [i] : []));
  if (!hits.length) return { ok: false, why: 'missing' };
  if (hits.length > 1) return { ok: false, why: 'twice' };
  const at = hits[0]!, old = lines[at]!;
  if (FENCE.test(old) || FENCE.test(next)) return { ok: false, why: 'fence' };
  // the whole rule is read, before and after: a guarded word on the line it wraps onto guards this line too
  const [a, b] = blockOf(lines, at), rule = (line: string) => [...lines.slice(a, at), line, ...lines.slice(at + 1, b + 1)].join(' ');
  if (guardedText(old) || guardedText(next) || guardedText(rule(old)) || guardedText(rule(next)) || sectionsOf(lines, at).some(guardedText)) return { ok: false, why: 'guarded' };
  // the line keeps its place in a list or a quote: its indentation stays, the new text brings its own marker
  parts[at * 2] = `${/^\s*/.exec(old)![0]}${next}${/\s*$/.exec(old)![0]}`;
  return { ok: true, text: parts.join('') };
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
