// The brain's layout as this app version knows it (issue #166, ADR 0116): one entry per place the app keeps a kind of
// content (the Brain pages read them). Why: when a new version adds a place (the Script section of ADR 0076, a future
// "Queries"), an existing brain keeps that content where older versions left it, and the new page stays empty. No
// per-version upgrade code: the brain records the hash of every entry it was last brought in line with, and the upgrade
// job (main/brainmodel/upgrade.ts) handles every entry whose hash it has not seen, a new one or a changed one, the same
// way: find candidates in the rest of the brain with the entry's `receives` rule (local, zero tokens), let a one-shot
// agent say which candidates really belong there and name them, then move them in one logged, undoable change.
// Adding a page that holds content means adding its entry here (test/unit/brainmodel/upgrade.test.ts checks every
// Brain page against this list): that is the whole upgrade for every brain already out there.
// Pure: used by main/brainmodel/upgrade.ts and the fresh brain (rules/new-brain.ts), which starts in line.

/** How the upgrade finds content that belongs to an entry elsewhere in the brain. */
export interface LayoutReceives {
  /** fenced code blocks (```lang) in Markdown notes, of these languages, with at least `minLines` lines */
  kind: 'code-block';
  languages: readonly string[];
  minLines: number;
  /** how a kept candidate is written into the entry's place: one script file with its header (main/brain/scripts.ts),
   *  or one Markdown note with the block and its title */
  write: 'script-file' | 'note-file';
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

export const BRAIN_LAYOUT: readonly LayoutSection[] = [
  { id: 'profile', place: 'me.md', since: '0.1.0', page: 'impostazioni', holds: 'The owner\'s profile: who they are, their main work, how to work with them.' },
  { id: 'now', place: 'now.md', since: '0.1.0', page: 'memoria', holds: 'What every open chat is doing right now, one line each.' },
  { id: 'journal', place: 'journal/', since: '0.1.0', page: 'memoria', holds: 'One file per day: what happened that day.' },
  { id: 'ideas', place: 'ideas.md', since: '0.1.0', page: 'idee', holds: 'Ideas the owner or the agents noted for later.' },
  { id: 'errors', place: 'ai-errors.md', since: '0.1.0', page: 'memoria', holds: 'Mistakes the AI made and the owner corrected.' },
  { id: 'rules', place: 'rules/', since: '0.1.0', page: 'regole', holds: 'The brain\'s own rules: how agents must work in this brain.' },
  { id: 'skills', place: '.claude/skills/', since: '0.1.0', page: 'skill', holds: 'Skills: reusable know-how, one folder with a SKILL.md each (old runbook sections are moved here by the migration job).' },
  { id: 'agents', place: 'agents/', since: '0.1.0', page: 'memoria', holds: 'Each role\'s own memory (agents/<role>/memory.md; memory/shared.md for what several roles share).' },
  { id: 'knowledge', place: 'folders named after a group (clienti/, ambienti/, persone/, …)', since: '0.1.0', page: 'memoria', holds: 'Reference notes: customers, environments, people, projects.' },
  { id: 'changelog', place: 'changelog.md', since: '0.1.0', page: 'log', holds: 'The brain\'s changelog, one line per change the app or an agent made.' },
  {
    id: 'scripts', place: 'scripts/', since: '0.1.0', page: 'script',
    holds: 'Reusable scripts that were run and worked: a command or a small program someone would run again (a deploy, a backup, a data fix, a test setup), one file each. Not: a one-off command, an example in prose, output, a config snippet, a query result.',
    receives: { kind: 'code-block', languages: ['powershell', 'ps1', 'pwsh', 'bash', 'sh', 'shell', 'zsh', 'python', 'py', 'javascript', 'js', 'mjs', 'typescript', 'ts', 'sql', 'cmd', 'bat', 'batch', 'ruby', 'rb'], minLines: 3, write: 'script-file' },
  },
];

/** The Brain pages that keep no brain content of their own (they show runs, logs, the app's state or other pages'
 *  content): a page missing from both lists fails test/unit/brainmodel/upgrade.test.ts, so a new page that holds
 *  content cannot ship without its layout entry. */
export const PAGES_WITHOUT_CONTENT: readonly string[] = ['home', 'agenti', 'task', 'dashboard', 'fatto', 'costi', 'qualita', 'apprendimento', 'confronto', 'file', 'guida', 'classificatori', 'collegamenti'];

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

/** The record of a brain in line with the whole layout (a fresh brain, or after a full pass). */
export const fullRecord = (app: string, at: string, layout: readonly LayoutSection[] = BRAIN_LAYOUT): LayoutRecord =>
  ({ app, at, sections: Object.fromEntries(layout.map(s => [s.id, sectionHash(s)])) });
