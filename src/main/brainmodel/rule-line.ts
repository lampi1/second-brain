// One line of an always-loaded file, replaced (issue #435, ADR 0320). Maintenance could add skills and lines to a
// role's text, but not fix a line of the fixed core every job loads (AGENTS.md, me.md…: brain.json fixedFiles): a fix
// that holds for every role landed in one role's text and the always-loaded file kept the old, wrong line. A research
// finding of kind rule with `file` and `before` now replaces exactly that line with `text`: the file must be one of the
// always-loaded ones, `before` must be one whole line of it, found once, and neither the old nor the new line may be
// about safety, permissions, settings, hooks, production or secrets (those stay the user's to edit by hand). The guard
// refuses when in doubt: a heading is read in every form (ATX, Setext, a bold-only line, a «# …» in a code block), the
// words are also looked for with _ * ` ~ and camelCase taken apart, a code fence line is never written or removed, and
// the fixed core never grows past its budget (the launch would stop: rules/instructions.ts).
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
const GUARDED = /\b(?:safety|sicurezza|sicherheit|security|permission\w*|permess[oi]|berechtigung\w*|allowed\s*tools|bypass\w*|hooks?|settings(?:\.json)?|impostazioni|einstellungen|prod|production|produzione|produktion|secrets?|segret[oi]|geheim\w*|credential\w*|credenzial[ei]|zugangsdaten|passw[oö]r\w*|kennw[oö]r\w*|(?:access|api|auth|bearer)[\s-]*(?:tokens?|keys?))\b/i;
/** A variable that holds a secret by its name (GITHUB_TOKEN, DB_PASSWORD). */
const ENV_SECRET = /[A-Z0-9]_(?:TOKEN|KEY|SECRET|PASSWORD|PWD|PAT)\b/;
const FENCE = /^\s*(`{3,}|~{3,})/;

function guardedText(line: string): boolean {
  const raw = line.normalize('NFKC').replace(/[\u00ad\u200b-\u200f\u2060\ufeff]/g, '');
  // the words also with their marks taken apart: __Safety__, dangerously_skip_permissions, skipPermissions
  const plain = raw.replace(/[_*`~]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  if (ENV_SECRET.test(raw) || GUARDED.test(raw) || GUARDED.test(plain)) return true;
  try { checkPermissionText(line); return false; } catch { return true; }
}

/** The headings above line `at` (the nearest of each level, up to the top): the sections the line sits in. Read wide,
 *  so that no form hides a section: ATX at any indentation, Setext (a line over === or ---), and as the lowest level a
 *  bold-only line and a «# …» inside a code block. A code block closes only with its own marker. */
function headingsAbove(lines: readonly string[], at: number): string[] {
  const heads: { level: number; title: string }[] = [];
  let fence = '';
  for (let i = 0; i < at; i++) {
    const l = lines[i]!, f = FENCE.exec(l);
    if (f) { if (!fence) fence = f[1]!; else if (f[1]![0] === fence[0] && f[1]!.length >= fence.length) fence = ''; continue; }
    const atx = /^\s*(#{1,6})\s+(.+)$/.exec(l);
    const under = !atx && !fence && /\S/.test(l) && !/^\s*(?:[-*+>|]|\d+[.)])\s/.test(l) ? /^\s*(=+|-+)\s*$/.exec(lines[i + 1] ?? '') : null;
    const bold = /^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*:?\s*$/.exec(l);
    if (atx) heads.push({ level: fence ? 7 : atx[1]!.length, title: atx[2]! });
    else if (under) heads.push({ level: under[1]![0] === '=' ? 1 : 2, title: l });
    else if (bold) heads.push({ level: 7, title: bold[1]! });
  }
  const out: string[] = [];
  let level = 8;
  for (const h of heads.reverse()) if (h.level < level) { out.push(h.title); level = h.level; }
  return out;
}

/** `fileText` with its one line `before` replaced by `after` (the line's indentation and every line end kept), or why
 *  not. A line is found by its trimmed text, inner spaces folded (as the item delta compares lines). */
export function editRuleLine(fileText: string, before: string, after: string): RuleLineEdit {
  const one = (s: unknown): s is string => typeof s === 'string' && !!s.trim() && s.length <= RULE_LINE_MAX && !/[\u0000-\u0008\u000a-\u001f\u007f\u0085\u2028\u2029]/.test(s.trim());
  if (!one(before) || !one(after)) return { ok: false, why: 'shape' };
  const want = itemKey(before), next = after.trim();
  if (itemKey(next) === want) return { ok: false, why: 'same' };
  // lines at the even places, their line ends at the odd ones: a file with mixed line ends keeps each of them
  const parts = fileText.split(/(\r?\n)/);
  const lines = parts.filter((_, i) => i % 2 === 0);
  const hits = lines.flatMap((l, i) => (itemKey(l) === want ? [i] : []));
  if (!hits.length) return { ok: false, why: 'missing' };
  if (hits.length > 1) return { ok: false, why: 'twice' };
  const at = hits[0]!;
  if (FENCE.test(lines[at]!) || FENCE.test(next)) return { ok: false, why: 'fence' };
  if (guardedText(lines[at]!) || guardedText(next) || headingsAbove(lines, at).some(guardedText)) return { ok: false, why: 'guarded' };
  // the line keeps its place in a list or a quote: its indentation stays, the new text brings its own marker
  parts[at * 2] = `${/^\s*/.exec(lines[at]!)![0]}${next}`;
  return { ok: true, text: parts.join('') };
}

/** editRuleLine on the always-loaded file `rel` of the brain at `root`, refused also when the fixed core would grow
 *  past its budget: the launch stops over it (rules/instructions.ts), as the agents' write guard knows (rules/
 *  guards.ts). `planned` gives another always-loaded file's text in a plan not written yet. */
export function editAlwaysLoaded(root: string, rel: string, fileText: string, before: string, after: string, planned?: (rel: string) => string | null): RuleLineEdit {
  const r = editRuleLine(fileText, before, after);
  if (!r.ok) return r;
  try {
    const config = configOf(root), lf = (s: string) => s.replace(/\r\n/g, '\n');
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
