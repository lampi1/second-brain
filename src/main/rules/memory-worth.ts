// Is a memory fact worth keeping (ADR 0128)? A deterministic, zero-token check of one fact's text: memory keeps general,
// reusable knowledge (procedures, conventions, how-tos, where things are), not what held in one case. It finds the
// signs of a one-off fact: a URL with a port, a query or an id in its path; a ticket, PR, work item, GUID or commit id;
// an absolute path inside one user's home; a single date or "today"; a branch name. "Hard" signs (ids, commits, dates)
// make a fact case-specific however it is worded; "soft" ones (URLs, user paths, branches) only when the fact is not
// stated as a reusable rule or procedure (it starts with when / before / always / use / check…, numbers its steps, or
// its predicate says procedure / convention / rule). Also the near-duplicate test of two facts (their words) and the
// rank the Proposte deck shows them in. Pure. Used by memory-records.ts (the gate of every new fact), agents/
// delegation.ts (agent_report's `remember`, checked before the report), proposals/sources.ts (the deck's grouping, cap
// and flags) and brainmodel/jobs.ts (the maintenance's memory tidy-up). Unit tests: test/unit/rules/memory-worth.test.ts.
import type { MemorySign } from '../../shared/proposals';

export type SpecificSign = MemorySign;
export const SPECIFIC_SIGNS: readonly SpecificSign[] = ['url', 'id', 'commit', 'path', 'date', 'branch'];
/** Signs that keep a fact case-specific even when it is worded as a rule. */
const HARD: ReadonlySet<SpecificSign> = new Set(['id', 'commit', 'date']);

export interface MemoryWorth {
  /** the signs of a one-off fact found in its text, in SPECIFIC_SIGNS order */
  signs: SpecificSign[];
  /** stated as a reusable rule or procedure */
  rule: boolean;
  /** tied to one case: not worth remembering as it is */
  specific: boolean;
  /** rank: a rule first, a plain fact next, a case-specific one last */
  score: number;
}

const MONTH = '(?:gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic|jan|may|jun|jul|aug|sep|oct|dec|mär|mai|okt|dez)[a-zà-ü]*\\.?';
const TESTS: readonly [SpecificSign, RegExp][] = [
  // a URL with an explicit port, a query string or a fragment, or an id in its path; a bare localhost:port
  ['url', /\bhttps?:\/\/[^\s/]+:\d{2,5}\b|\bhttps?:\/\/\S*[?#]\S|\bhttps?:\/\/[^\s/]+\/\S*?(?:\/|=)\d{3,}\b|\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d{2,5}\b/i],
  // tickets, PRs, work items, issues; JIRA-like keys; #123, !123; GUIDs
  ['id', /(?:^|[\s(])[#!]\d{2,}\b|\b(?:PR|pull request|merge request|MR|work ?item|WI|ticket|issue|bug|task|story|AB#)\s*#?\s*\d{2,}\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
  // a tracker key (ABC-123), upper case only, not a standard's name (ISO-8601, UTF-16)
  ['id', /\b(?!(?:ISO|UTF|RFC|SHA|TLS|SSL|HTTP|IEC|ECMA|DIN|EN|ES)-)[A-Z][A-Z0-9]{1,9}-\d{2,6}\b/],
  // a commit: 7 to 40 hex characters with at least one digit and one letter
  ['commit', /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/],
  // a path inside one user's home
  ['path', /\b[a-z]:[\\/]+users[\\/]+[^\\/\s]+|(?:^|[\s(`'"«])\/(?:home|users)\/[^/\s]+/i],
  // one day: 2026-10-22, 22/10/2026, 22 ottobre 2026, "oggi", "yesterday"…
  ['date', new RegExp(`\\b\\d{4}-\\d{2}-\\d{2}\\b|\\b\\d{1,2}[/.]\\d{1,2}[/.]\\d{2,4}\\b|\\b\\d{1,2}\\s+${MONTH}\\s+\\d{4}\\b|\\b${MONTH}\\s+\\d{1,2},?\\s+\\d{4}\\b|\\b(?:oggi|ieri|stamattina|stasera|today|yesterday|tonight|this morning|heute|gestern)\\b`, 'i')],
  // a branch: a usual prefix and a name, or "branch <x/y>"
  ['branch', /\b(?:feat|feature|fix|bugfix|hotfix|chore|release|claude|wk|wip|users?)\/[\w.-]+|\bbranch\s+[`'"«]?[\w.-]+\/[\w./-]+/i],
];
// a rule or a procedure: how the fact starts (an instruction or a condition), numbered steps, or what its predicate says
const RULE_START = /^[\s\W]*(?:sempre|mai|ogni volta|prima di|dopo aver|quando|se|per|usa|usare|controlla|verifica|lancia|esegui|evita|non|bisogna|conviene|always|never|whenever|every time|before|after|when|if|to|use|check|run|avoid|don't|do not|prefer|make sure|immer|nie|niemals|wenn|bevor|nachdem|vor|prüfe|verwende|nutze|vermeide)\b/i;
const RULE_STEPS = /(?:^|\s)1[.)]\s.+\s2[.)]\s|\s→\s/;
const RULE_PREDICATE = /procedur|how ?to|come si|convention|convenzion|regol|rule|step|passi|workflow|verfahren|regel|konvention|schritte|anleitung/i;

/** The worth of one fact (subject, predicate, value). */
export function memoryWorth(subject: string, predicate: string, value: string): MemoryWorth {
  const text = `${subject} ${predicate} ${value}`;
  const signs = SPECIFIC_SIGNS.filter(s => TESTS.some(([x, re]) => x === s && re.test(text)));
  const rule = RULE_START.test(value) || RULE_STEPS.test(value) || RULE_PREDICATE.test(predicate);
  const specific = signs.some(s => HARD.has(s)) || (signs.length > 0 && !rule);
  return { signs, rule, specific, score: (rule ? 2 : 0) - signs.length - (specific ? 2 : 0) };
}

/** The signs in plain words, for an agent's error message. */
const SIGN_WORDS: Readonly<Record<SpecificSign, string>> = {
  url: 'an address with a port or an id', id: 'a ticket / PR / work item id', commit: 'a commit id', path: "a path in one user's home",
  date: 'a single date', branch: 'a branch name',
};
/** The words an agent reads when a fact is refused: what was found and how to save it instead. */
export function specificHint(w: MemoryWorth): string {
  return `This fact is tied to one case (${w.signs.map(s => SIGN_WORDS[s]).join(', ')}). Memory keeps general, reusable knowledge: procedures, conventions, how-tos. `
    + 'Save the reusable rule or procedure behind it instead, without the one-off values (e.g. "after login the local app runs on a port other than the default: read it from the launch profile" rather than the URL), or leave it out.';
}
/** The gate of every new fact: throws the hint when the fact is case-specific. */
export function checkMemoryWorth(subject: string, predicate: string, value: string): void {
  const w = memoryWorth(subject, predicate, value);
  if (w.specific) throw new Error(specificHint(w));
}

// ── near-duplicates ─────────────────────────────────────────────────────────────────────────────────────────────────
/** The words of a fact's value: letters and digits, three or more, without accents, lower case. */
export const factWords = (s: string): Set<string> => new Set(s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').match(/[\p{L}\p{N}]{3,}/gu) ?? []);
/** Two values say (nearly) the same thing: their words overlap by `min` or more (Jaccard); short values (under four
 *  words) only when their words are the same. */
export function nearSame(a: string, b: string, min = 0.8): boolean {
  const x = factWords(a), y = factWords(b);
  if (!x.size || !y.size) return a.trim().toLowerCase() === b.trim().toLowerCase();
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  if (x.size < 4 || y.size < 4) return both === x.size && both === y.size;
  return both / (x.size + y.size - both) >= min;
}
