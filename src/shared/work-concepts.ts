// The one taxonomy of the kinds of work (ADR 0182): the routing table's rows, the job ledger (userData/jobs.jsonl), the
// task estimates and the Classificatori cards all name a job with the same WORK_KINDS, read by the same rule (taskOf).
// Before, the job ledger had its own seven kinds and its own keyword classifier (brain/estimates.ts classify), so the
// same chat could be "fix" in one place and "bug-fix" in the other; old ledger rows are read through fromLedgerKind.
// Under it, a small bilingual (Italian + English) lexicon: each concept is a set of word beginnings that mean the same
// job in either language ("correggi", "sistema", "fix", "bug" → fix). Why: the packaged agents are described in English
// and the owner writes in Italian, and on a clean install (no brain estimates rules, ADR 0072) the kind of every chat
// was "altro" without it. Dictionary-based query translation is the classic remedy for that vocabulary gap in
// cross-language retrieval (Ballesteros & Croft, SIGIR 1997). Used by brain/routing.ts, brain/estimates.ts and
// agents/task-estimate.ts. Pure, no Node: pinned by test/unit/classifiers/work-concepts.test.ts.

/** The kinds of work: the routing table decides on them (the brain's estimates.mjs rules travel in estimates.json
 *  `tasks`), the job ledger and the estimates group by them. */
export const WORK_KINDS = ['qa-run', 'review', 'bug-fix', 'ops-read', 'writing', 'triage', 'research-web', 'investigation', 'app-feature', 'orchestrator', 'altro'] as const;
export type TaskKind = (typeof WORK_KINDS)[number];

/** The job ledger's own kinds before ADR 0182, mapped to the one taxonomy, so an old jobs.jsonl row still loads. */
const LEDGER_KINDS: Readonly<Record<string, TaskKind>> = {
  fix: 'bug-fix', qa: 'qa-run', review: 'review', feature: 'app-feature', research: 'investigation', question: 'altro', other: 'altro',
};
/** A kind read back from a file: a work kind as it is, an old ledger kind mapped, anything else 'altro'. */
export function fromLedgerKind(k: unknown): TaskKind {
  if ((WORK_KINDS as readonly unknown[]).includes(k)) return k as TaskKind;
  return LEDGER_KINDS[String(k)] ?? 'altro';
}

export type Concept = 'fix' | 'build' | 'review' | 'qa' | 'cause' | 'ops' | 'runbook' | 'research' | 'write' | 'inbox' | 'plan';

/** Words per concept, accents folded, lower case: "stem*" matches any word that begins with it, any other entry only the
 *  whole word (so "prod" never catches "produttività" and "post" never catches "postgres"). */
export const CONCEPTS: Readonly<Record<Concept, readonly string[]>> = {
  fix: ['fix', 'fixed', 'fixes', 'fixing', 'hotfix*', 'bug', 'bugs', 'correg*', 'sistemal*', 'sistemare', 'sistemato', 'sistemata', 'ripar*', 'repair*', 'crash*', 'rotto', 'rotta', 'rotti', 'broken', 'guast*',
    'errore', 'errori', 'error', 'errors'],
  build: ['implement*', 'aggiung*', 'add', 'adds', 'crea', 'creare', 'creami', 'create', 'build', 'svilupp*', 'develop*', 'refactor*', 'migra',
    'migrare', 'migrate', 'feature', 'features', 'funzionalit*', 'endpoint*', 'paginazion*', 'pagination', 'pulsant*', 'button*', 'schermat*',
    'screen', 'salvataggio'],
  review: ['review*', 'revision*', 'rivedi', 'rivedere', 'revisiona*', 'diff', 'occhiata'],
  qa: ['test', 'tests', 'testa', 'testare', 'testing', 'collaud*', 'smoke', 'e2e', 'accettazion*', 'acceptance', 'staging', 'browser', 'qa'],
  // no stopwords here ("perché", "quando", "why"): Italian agents say "Usa quando…", so they would match every question
  cause: ['causa', 'cause', 'investig*', 'indag*', 'analizz*', 'analy*', 'bisect', 'commit', 'regress*'],
  ops: ['alert*', 'allarm*', 'incident*', 'outage*', 'latenz*', 'latency', 'log', 'logs', 'produzione', 'production', 'prod', 'metric*', 'metrich*',
    'dashboard*', 'cluster*', 'cpu', 'azure', 'diagnos*', 'database', 'down'],
  runbook: ['runbook*', 'procedur*', 'rollback', 'failover', 'documenta', 'documentare', 'documentalo', 'documentala', 'document'],
  research: ['ricerc*', 'research*', 'fonti', 'fonte', 'source', 'sources', 'cite', 'cita', 'citare', 'online', 'studi', 'study', 'studies',
    'confront*', 'compar*', 'autorevol*', 'affidabil*', 'reliable', 'link', 'web'],
  write: ['scriv*', 'write', 'writing', 'draft*', 'bozz*', 'testo', 'text', 'post', 'newsletter*', 'annunci*', 'announc*', 'riscriv*', 'rewrite',
    'paragraf*', 'redig*', 'copy', 'traduc*', 'traduz*', 'translat*'],
  inbox: ['posta', 'inbox', 'casella', 'unread', 'lette', 'smista*', 'triage', 'diario', 'journal', 'annota*'],
  plan: ['pianific*', 'plan', 'plans', 'planning', 'giornat*', 'today', 'oggi', 'domani', 'tomorrow', 'settiman*', 'week', 'priorit*', 'focus',
    'concentraz*', 'agenda', 'calendar*', 'riunion*', 'meeting*', 'organizz*'],
};

/** accents off, lower case */
const fold = (s: string): string => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const WHOLE = new Map<string, Concept>(), STEMS: [string, Concept][] = [];
for (const [c, ws] of Object.entries(CONCEPTS) as [Concept, readonly string[]][])
  for (const w of ws) if (w.endsWith('*')) STEMS.push([w.slice(0, -1), c]); else WHOLE.set(w, c);
STEMS.sort((a, b) => b[0].length - a[0].length); // the longest beginning first

/** The concept of one folded word, or null. */
export function conceptOf(word: string): Concept | null {
  const w = fold(word);
  return WHOLE.get(w) ?? STEMS.find(([b]) => w.startsWith(b))?.[1] ?? null;
}

/** The concepts of a text, one per word that has one (repeats kept: they count as evidence). */
export function conceptsOf(text: string): Concept[] {
  return (fold(text).match(/[\p{L}\p{N}]+/gu) ?? []).map(conceptOf).filter((c): c is Concept => c !== null);
}

/** Which routing kind each concept points to; 'cause' alone is an investigation, with an ops word it is ops-read. */
const KIND: Readonly<Record<Concept, TaskKind>> = {
  fix: 'bug-fix', build: 'app-feature', review: 'review', qa: 'qa-run', cause: 'investigation', ops: 'ops-read', runbook: 'writing',
  research: 'research-web', write: 'writing', inbox: 'triage', plan: 'triage',
};
/** Ties go to the earlier kind: an ops incident before a code investigation, a fix before a feature, a review or a QA
 *  run before the fix they look at, the inbox before the drafts it asks for. */
const ORDER: readonly TaskKind[] = ['ops-read', 'review', 'qa-run', 'investigation', 'bug-fix', 'app-feature', 'research-web', 'triage', 'writing'];

/** The kind of work from the concepts alone (the built-in rule when the brain gives none); null = no work word. */
export function builtinTask(text: string): TaskKind | null {
  const score = new Map<TaskKind, number>();
  for (const c of conceptsOf(text)) score.set(KIND[c], (score.get(KIND[c]) ?? 0) + 1);
  let best: TaskKind | null = null, n = 0;
  for (const k of ORDER) if ((score.get(k) ?? 0) > n) { best = k; n = score.get(k)!; }
  return best;
}

// ── the rule ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** accents off: \b does not see an accented letter as part of a word (the brain's estimates.mjs `plain`) */
const plain = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
// A title that only names a topic ("Magazzino · Telemetria ordini": ops-read) loses to a prompt that asks to build
// or fix something: that chat writes code (2026-10-14: an implementation on two repos went to Haiku). Same rule and
// words as the brain's estimates.mjs taskOf.
const TOPIC_KINDS: readonly string[] = ['ops-read', 'research-web'];
const BUILD = /\b(implement\w*|pull request|(apri|aprire|apra|crea|creare|open) (la |una |a )?pr|refactor\w*)\b/i;
const FIX = /\b(fix\w*|hotfix|correggi\w*|corregger\w*|sistema (il|la|i|le) (bug|errore|crash))\b/i;
/** The kind of a job with the brain's rules (estimates.json `tasks`, from estimates.mjs TASKS): the title first, then
 *  the first prompt (which wins over a topic-only title when it builds or fixes); an Orchestrator is its own kind; then
 *  the built-in bilingual words; nothing = 'altro'. */
export function taskOf(title: string, prompt: string, rules: readonly (readonly [string, string, string])[] | undefined): TaskKind {
  const t = String(title ?? '').trim();
  if (/^orchestrator\b/i.test(t)) return 'orchestrator';
  const word = (s: string): TaskKind | null => {
    for (const [k, src, flags] of rules ?? []) {
      try { if (new RegExp(src, flags).test(plain(s)) && (WORK_KINDS as readonly string[]).includes(k)) return k as TaskKind; } catch { /* a bad rule is skipped */ }
    }
    return null;
  };
  const k = word(t), p = plain(String(prompt ?? '').slice(0, 2000));
  if ((!k || TOPIC_KINDS.includes(k)) && (BUILD.test(p) || FIX.test(p))) return BUILD.test(p) ? 'app-feature' : 'bug-fix';
  return k ?? word(p) ?? builtinTask(`${t} ${p}`) ?? 'altro';
}
