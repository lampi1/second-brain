// The brain's layout as this app version knows it (issue #166, ADR 0116, ADR 0124): one entry per place the app keeps a
// kind of content (the Brain pages read them). Why: when a new version adds a place (the Script section of ADR 0076, the
// saved queries of ADR 0124), an existing brain keeps that content where older versions left it, and the new page stays empty. No
// per-version upgrade code: the brain records the hash of every entry it was last brought in line with, and the upgrade
// job (main/brainmodel/upgrade.ts) handles every entry whose hash it has not seen, a new one or a changed one, the same
// way: find candidates in the rest of the brain with the entry's `receives` rule (code blocks or marked items; local,
// zero tokens), let a one-shot
// agent say which candidates really belong there and name them, then move them in one logged, undoable change.
// Adding a page that holds content means adding its entry here (test/unit/brainmodel/upgrade.test.ts checks every
// Brain page against this list): that is the whole upgrade for every brain already out there.
// Pure: used by main/brainmodel/upgrade.ts and the fresh brain (rules/new-brain.ts), which starts in line.

/** How the upgrade finds content that belongs to an entry elsewhere in the brain: one of two kinds, each handled by the
 *  generic job (main/brainmodel/upgrade.ts) with no code of the entry's own. */
export type LayoutReceives = CodeBlockReceives | MarkedItemsReceives;

/** fenced code blocks (```lang) in Markdown notes, of these languages, with at least `minLines` lines */
export interface CodeBlockReceives {
  kind: 'code-block';
  languages: readonly string[];
  minLines: number;
  /** how a kept candidate is written into the entry's place: one script file with its header (main/brain/scripts.ts),
   *  one saved-query note with its header (main/brain/queries.ts), or one plain Markdown note with the block and its
   *  title; the code itself is always the candidate's own text, byte for byte */
  write: 'script-file' | 'query-file' | 'note-file';
}

/** items marked in the notes' prose: a line or a list item that starts with one of `markers` ("Idea:", "💡"), or every
 *  top-level item (or paragraph) under a heading named one of `headings` ("## Idee"); a heading that starts with a marker
 *  is one item with its section. Case, accents and leading emoji or punctuation of a heading are folded. */
export interface MarkedItemsReceives {
  kind: 'marked-items';
  markers: readonly string[];
  headings: readonly string[];
  /** how kept items are written: appended as entries to the entry's place (a file), each with where it came from and
   *  when, and who had it (the owner or the AI) as the agent read it from the note */
  write: 'append-items';
}

export interface LayoutSection {
  /** stable id, never reused */
  id: string;
  /** brain-relative folder (ending in /) or file the content lives in; for an entry without `receives` it may name a
   *  pattern in words (it only describes) */
  place: string;
  /** what belongs there, in plain English: the upgrade agent decides from this */
  holds: string;
  /** the app version that added it */
  since: string;
  /** the Brain page that shows it (renderer/brain/index.tsx BrainPageId) */
  page: string;
  /** absent: nothing to look for elsewhere (the content can only be born there) */
  receives?: LayoutReceives;
}

/** The record an upgraded brain keeps in brain.json (`layout`). */
export interface LayoutRecord {
  /** the app version of the last upgrade pass */
  app: string;
  /** id → hash of the entry the brain is in line with */
  sections: Record<string, string>;
  at: string;
}

/** The fence languages of a saved query (the 'queries' entry; main/brain/queries.ts labels them). */
export const QUERY_LANGUAGES: readonly string[] = ['sql', 'tsql', 't-sql', 'mysql', 'postgresql', 'postgres', 'pgsql', 'plsql', 'sqlite', 'kusto', 'kql', 'graphql', 'gql', 'promql', 'spl', 'splunk', 'logql', 'cypher', 'sparql', 'flux', 'esql'];

export const BRAIN_LAYOUT: readonly LayoutSection[] = [
  { id: 'profile', place: 'me.md', since: '0.1.0', page: 'impostazioni', holds: 'The owner\'s profile: who they are, their main work, how to work with them.' },
  { id: 'now', place: 'now.md', since: '0.1.0', page: 'memoria', holds: 'What every open chat is doing right now, one line each.' },
  { id: 'journal', place: 'journal/', since: '0.1.0', page: 'memoria', holds: 'One file per day: what happened that day.' },
  {
    id: 'ideas', place: 'ideas.md', since: '0.1.0', page: 'idee',
    holds: 'Ideas the owner or the agents noted for later: a what-if, something to try or build, an improvement to pick up one day, one entry each. Not: a task already planned with a date, a decision taken, a fact, a reminder, a note about what happened.',
    receives: {
      kind: 'marked-items', write: 'append-items',
      markers: ['idea:', 'idee:', 'ideas:', 'idea!', 'idea -', 'idea –', 'idea —', 'nuova idea:', 'new idea:', 'ideen:', 'spunto:', 'todo idea', 'todo: idea', 'todo (idea)', '💡'],
      headings: ['idea', 'idee', 'ideas', 'ideen', 'spunti', 'spunti e idee', 'idee da riprendere', 'idee per dopo', 'ideas for later', 'some ideas'],
    },
  },
  { id: 'errors', place: 'ai-errors.md', since: '0.1.0', page: 'memoria', holds: 'Mistakes the AI made and the owner corrected.' },
  { id: 'rules', place: 'rules/', since: '0.1.0', page: 'regole', holds: 'The brain\'s own rules: how agents must work in this brain.' },
  { id: 'skills', place: '.claude/skills/', since: '0.1.0', page: 'skill', holds: 'Skills: reusable know-how, one folder with a SKILL.md each (old runbook sections are moved here by the migration job).' },
  { id: 'agents', place: 'agents/', since: '0.1.0', page: 'memoria', holds: 'Each role\'s own memory (agents/<role>/memory.md; memory/shared.md for what several roles share).' },
  { id: 'knowledge', place: 'folders named after a group (clienti/, ambienti/, persone/, …)', since: '0.1.0', page: 'memoria', holds: 'Reference notes: customers, environments, people, projects.' },
  { id: 'changelog', place: 'changelog.md', since: '0.1.0', page: 'log', holds: 'The brain\'s changelog, one line per change the app or an agent made.' },
  {
    id: 'scripts', place: 'scripts/', since: '0.1.0', page: 'script',
    holds: 'Reusable scripts that were run and worked: a command or a small program someone would run again (a deploy, a backup, a data fix, a test setup), one file each. Not: a one-off command, an example in prose, output, a config snippet, a query result. Saved queries (SQL, KQL and the like) live in queries/, not here.',
    receives: { kind: 'code-block', languages: ['powershell', 'ps1', 'pwsh', 'bash', 'sh', 'shell', 'zsh', 'python', 'py', 'javascript', 'js', 'mjs', 'typescript', 'ts', 'cmd', 'bat', 'batch', 'ruby', 'rb'], minLines: 3, write: 'script-file' },
  },
  {
    id: 'queries', place: 'queries/', since: '0.1.0', page: 'memoria',
    holds: 'Saved queries someone reruns against a data source: SQL, KQL / Kusto, GraphQL, PromQL, Splunk SPL, LogQL and the like (a report, a check, a lookup, a data fix query), one file each with what it does and where it runs. Not: a one-off look-up, a query result or its output, an example in prose, a whole script that only contains a query (that is a script).',
    receives: { kind: 'code-block', languages: QUERY_LANGUAGES, minLines: 2, write: 'query-file' },
  },
];

/** The Brain pages that keep no brain content of their own (they show runs, logs, the app's state or other pages'
 *  content): a page missing from both lists fails test/unit/brainmodel/upgrade.test.ts, so a new page that holds
 *  content cannot ship without its layout entry. Flows keep their definitions and runs in userData/flows,
 *  scoped to the brain context, so the flussi page does not introduce a brain-folder migration. */
export const PAGES_WITHOUT_CONTENT: readonly string[] = ['home', 'flussi', 'agenti', 'task', 'dashboard', 'andamento', 'file', 'guida', 'registrazioni', 'impara', 'collegamenti'];

/** A short stable hash of an entry (FNV-1a over its fields): changes when what the entry means changes. */
export function sectionHash(s: LayoutSection): string {
  const text = JSON.stringify([s.id, s.place, s.holds, s.receives ?? null]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/** The entries a brain with this record has not been brought in line with (all of them for a brain with none). */
export const pendingSections = (record: LayoutRecord | null, layout: readonly LayoutSection[] = BRAIN_LAYOUT): LayoutSection[] =>
  layout.filter(s => record?.sections[s.id] !== sectionHash(s));

