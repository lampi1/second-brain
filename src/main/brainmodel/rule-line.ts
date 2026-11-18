// One line of an always-loaded file, replaced (issue #435, ADR 0320). Maintenance could add skills and lines to a
// role's text, but not fix a line of the fixed core every job loads (AGENTS.md, me.md…: brain.json fixedFiles): a fix
// that holds for every role landed in one role's text and the always-loaded file kept the old, wrong line. A research
// finding of kind rule with `file` and `before` now replaces exactly that line with `text`: the file must be one of the
// always-loaded ones, `before` must be one whole line of it, found once, and neither the old nor the new line may be
// about safety, permissions, settings, hooks, production or secrets (those stay the user's to edit by hand).
// editRuleLine is pure: the text in, the text out or the reason why not; ruleLineChange is the tool's early check
// against the brain now. Used by research.ts (maintenance_propose), research-candidate.ts (the candidate brain) and
// service.ts (a card applied alone); tests: test/unit/brainmodel/rule-line.test.ts.
import path from 'node:path';
import type { BrainRule } from '../../shared/brain-model';
import type { ResearchChange } from '../../shared/maintenance-research';
import { checkPermissionText } from '../agents/tool-policy';
import { itemKey } from './item-delta';
import { readSmall } from './model';

/** The longest line a finding may read or write. */
export const RULE_LINE_MAX = 800;

export type RuleLineWhy = 'shape' | 'same' | 'guarded' | 'missing' | 'twice';
/** Why a line edit is refused: `en` for the research (the tool's answer), `it` for the card and the candidate's notes. */
export const RULE_LINE_WHY: Readonly<Record<RuleLineWhy, { en: string; it: string }>> = {
  shape: { en: `before and text: one line each (no line break), 1-${RULE_LINE_MAX} characters.`, it: 'riga vuota, troppo lunga o su più righe' },
  same: { en: 'text equals before: nothing would change.', it: 'la riga nuova è uguale a quella vecchia' },
  guarded: { en: 'Refused: a line about safety, permissions, settings, hooks, production or secrets (or one under such a heading) is changed only by the user.', it: 'riga su sicurezza, permessi, impostazioni, hook, produzione o segreti: la cambia solo l\'utente' },
  missing: { en: 'before: not a line of that file. Copy the whole line exactly as it is now (read the file again).', it: 'la riga da cambiare non c\'è più nel file' },
  twice: { en: 'before: that line is in the file more than once; this change edits a line found exactly once.', it: 'la riga da cambiare è nel file più di una volta' },
};

/** Words of a line (or of a heading above it) the maintenance never edits. */
const GUARDED = /\b(?:safety|sicurezza|security|permission\w*|permess[oi]|allowedTools|bypass\w*|hooks?|settings(?:\.json)?|impostazioni|prod|production|produzione|secrets?|segret[oi]|credential\w*|credenzial[ei]|passwords?|(?:access|api|auth|bearer)[\s-]*(?:tokens?|keys?))\b/i;

function guardedText(line: string): boolean {
  if (GUARDED.test(line.normalize('NFKC'))) return true;
  try { checkPermissionText(line); return false; } catch { return true; }
}

/** The headings above line `at` (the nearest of each level, up to the top): the sections the line sits in. */
function headingsAbove(lines: readonly string[], at: number): string[] {
  const out: string[] = [];
  let level = 7, fence = false;
  // fences are read top-down so a «# comment» inside a code block is not taken for a heading
  const heads: { i: number; level: number; title: string }[] = [];
  for (let i = 0; i < at; i++) {
    if (/^\s*(```|~~~)/.test(lines[i]!)) { fence = !fence; continue; }
    const m = fence ? null : /^(#{1,6})\s+(.+)$/.exec(lines[i]!);
    if (m) heads.push({ i, level: m[1]!.length, title: m[2]! });
  }
  for (const h of heads.reverse()) if (h.level < level) { out.push(h.title); level = h.level; }
  return out;
}

/** `fileText` with its one line `before` replaced by `after` (the line's indentation and the file's line ends kept),
 *  or why not. A line is found by its trimmed text, inner spaces folded (as the item delta compares lines). */
export function editRuleLine(fileText: string, before: string, after: string): { ok: true; text: string } | { ok: false; why: RuleLineWhy } {
  const one = (s: unknown): s is string => typeof s === 'string' && !!s.trim() && s.length <= RULE_LINE_MAX && !/[\r\n]/.test(s.trim());
  if (!one(before) || !one(after)) return { ok: false, why: 'shape' };
  const want = itemKey(before), next = after.trim();
  if (itemKey(next) === want) return { ok: false, why: 'same' };
  const eol = fileText.includes('\r\n') ? '\r\n' : '\n';
  const lines = fileText.split(/\r?\n/);
  const hits = lines.flatMap((l, i) => (itemKey(l) === want ? [i] : []));
  if (!hits.length) return { ok: false, why: 'missing' };
  if (hits.length > 1) return { ok: false, why: 'twice' };
  const at = hits[0]!;
  if (guardedText(lines[at]!) || guardedText(next) || headingsAbove(lines, at).some(h => GUARDED.test(h))) return { ok: false, why: 'guarded' };
  // the line keeps its place in a list or a quote: its indentation stays, the new text brings its own marker
  lines[at] = `${/^\s*/.exec(lines[at]!)![0]}${next}`;
  return { ok: true, text: lines.join(eol) };
}

/** The always-loaded file `rel` of the brain as it is now, or null (not one of them, a path that leaves the brain,
 *  missing or too big). */
export function alwaysLoadedText(root: string, rules: readonly Pick<BrainRule, 'file' | 'loaded'>[], rel: string): string | null {
  if (!rules.some(r => r.file === rel && r.loaded === 'always') || rel.split('/').some(p => !p || p === '.' || p === '..')) return null;
  return readSmall(path.join(root, ...rel.split('/')));
}

/** maintenance_propose's line edit (kind rule, no role, `file` + `before` + `text`), checked now so the research reads
 *  why not at once (English: the tool's answer). The candidate and the apply check it again: the file may change. */
export function ruleLineChange(root: string | null, rules: readonly Pick<BrainRule, 'file' | 'loaded'>[], o: { target?: unknown; role?: unknown; file?: unknown; before?: unknown; text?: unknown }): ResearchChange {
  if (o.target !== 'rule' || o.role) throw new Error('change.file and change.before: only with kind rule and no role (one line of an always-loaded file, replaced by change.text).');
  if (!root) throw new Error('No brain folder: nothing to change.');
  const always = rules.filter(r => r.loaded === 'always').map(r => r.file);
  const rel = typeof o.file === 'string' ? o.file.trim().replace(/\\/g, '/') : '';
  if (!always.includes(rel)) throw new Error(`change.file: one of the files loaded in every job (${always.join(', ') || 'none in this brain'}); no other file is edited this way.`);
  const now = alwaysLoadedText(root, rules, rel);
  if (now === null) throw new Error('change.file: not readable (missing or too big).');
  const r = editRuleLine(now, o.before as string, o.text as string);
  if (!r.ok) throw new Error(RULE_LINE_WHY[r.why].en);
  return { target: 'rule', file: rel, before: (o.before as string).trim(), text: (o.text as string).trim() };
}
