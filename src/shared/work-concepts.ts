// A small bilingual (Italian + English) lexicon of the kinds of work the app routes: each concept is a set of word
// beginnings that mean the same job in either language ("correggi", "sistema", "fix", "bug" → fix). Why: the packaged
// agents are described in English and the owner writes in Italian, so the agent classifier's words channel matched
// almost nothing without the local model (measured on test/fixtures/classifiers: 10/50 right), and on a clean install
// (no brain estimates rules, ADR 0072) the routing kind of every chat was "altro". Dictionary-based query translation is
// the classic remedy for that vocabulary gap in cross-language retrieval (Ballesteros & Croft, SIGIR 1997).
// Used by agents/classifier.ts (words are folded into concept tokens on both sides) and brain/routing.ts (builtinTask:
// the routing kind when the brain has no rule for the chat). Pure, no Node: pinned by test/unit/classifiers/*.test.ts.
import type { TaskKind } from './contract';

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

/** The routing kind from the concepts alone (the built-in rule when the brain gives none); null = no work word. */
export function builtinTask(text: string): TaskKind | null {
  const score = new Map<TaskKind, number>();
  for (const c of conceptsOf(text)) score.set(KIND[c], (score.get(KIND[c]) ?? 0) + 1);
  let best: TaskKind | null = null, n = 0;
  for (const k of ORDER) if ((score.get(k) ?? 0) > n) { best = k; n = score.get(k)!; }
  return best;
}
