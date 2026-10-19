// The brain's changelog (ADR 0076; the owner, 2026-10-19: "i cambiamenti finiscono nel changelog del brain che farei
// una sezione a parte"): one Markdown file at the brain's root, `changelog.md`, one line per change an agent or the app
// made to the brain (a script added, fixed or deleted, a rule or procedure rewritten…), newest first. Plain text the user
// can read and edit like any note; the Changelog page parses the lines it recognises and shows the rest as they are.
// Written only by main (the Orchestrator's brain_script_* and brain_changelog_add tools); created on its first entry
// (ADR 0072: a fresh brain holds no file of the app's). Line format, `·` separated, the summary last so it may contain
// anything:  - 2026-10-19 10:52 · script · added · scripts/backup.mjs · Orchestrator · Backup delle note in zip
// Used by scripts.ts, scripts-tools.ts, wiring.ts (/api/changelog) and demo-wiring.ts. Unit tests: test/unit/brain/scripts.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { ChangelogAction, ChangelogEntry, ChangelogKind } from '../../shared/contract';
import { maskSecrets } from './procedures';

export const CHANGELOG_FILE = 'changelog.md';
export const CHANGELOG_KINDS: readonly ChangelogKind[] = ['script', 'rule', 'procedure', 'note', 'agent', 'skill', 'other'];
export const CHANGELOG_ACTIONS: readonly ChangelogAction[] = ['added', 'edited', 'fixed', 'deleted', 'restored'];
const HEAD = '# Changelog del brain\n\nOgni cambiamento al brain fatto dagli agenti o dall’app, il più recente in alto.\n\n';
const LINE = /^- (\d{4}-\d\d-\d\d \d\d:\d\d) · (\w+) · (\w+) · (.+?) · (.+?) · (.*)$/;
/** most entries the page and the tool read (the file itself keeps everything) */
const MAX_READ = 500;

/** "YYYY-MM-DD HH:MM", local time (the user reads it). */
export function stampOf(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** One field on one line: no line breaks, no field separator, trimmed and cut. */
const field = (s: string, max: number): string => s.replace(/\s+/g, ' ').replace(/ · /g, ' - ').trim().slice(0, max);

export function formatEntry(e: ChangelogEntry): string {
  return `- ${e.at} · ${e.kind} · ${e.action} · ${field(e.target, 200) || '—'} · ${field(e.by, 60) || 'app'} · ${field(e.summary, 400)}`;
}

/** The entries of a changelog text, in file order (newest first when the app wrote them). Unknown lines are skipped. */
export function parseChangelog(text: string): ChangelogEntry[] {
  const out: ChangelogEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = LINE.exec(raw.trim());
    if (!m) continue;
    const kind = (CHANGELOG_KINDS as readonly string[]).includes(m[2]!) ? m[2] as ChangelogKind : 'other';
    const action = (CHANGELOG_ACTIONS as readonly string[]).includes(m[3]!) ? m[3] as ChangelogAction : 'edited';
    // a hand-written line may hold a credential: masked before it leaves main (AGENTS.md rule 2)
    const mask = (v: string) => maskSecrets(v).text;
    out.push({ at: m[1]!, kind, action, target: mask(m[4]!), by: mask(m[5]!), summary: mask(m[6]!) });
    if (out.length >= MAX_READ) break;
  }
  return out;
}

export class BrainChangelog {
  constructor(private readonly root: () => string | null, private readonly now: () => Date = () => new Date()) {}

  private file(): string | null { const r = this.root(); return r ? path.join(r, CHANGELOG_FILE) : null; }

  /** /api/changelog: the entries, newest first; none (and no file) on a brain that never changed through the app. */
  list(): { root: string | null; file: string; entries: ChangelogEntry[] } {
    const f = this.file();
    let text = '';
    try { if (f) text = fs.readFileSync(f, 'utf8'); } catch { /* not written yet */ }
    return { root: this.root(), file: CHANGELOG_FILE, entries: parseChangelog(text) };
  }

  /** Add one entry at the top (under the title); creates the file on the first one. Returns the written entry. */
  add(e: Omit<ChangelogEntry, 'at'> & { at?: string }): ChangelogEntry {
    const f = this.file();
    if (!f) throw new Error('nessuna cartella brain configurata');
    if (!(CHANGELOG_KINDS as readonly string[]).includes(e.kind)) throw new Error(`kind: one of ${CHANGELOG_KINDS.join(', ')}`);
    if (!(CHANGELOG_ACTIONS as readonly string[]).includes(e.action)) throw new Error(`action: one of ${CHANGELOG_ACTIONS.join(', ')}`);
    const entry: ChangelogEntry = { ...e, at: e.at ?? stampOf(this.now()) };
    if (maskSecrets(formatEntry(entry)).masked) throw new Error('refused: the entry looks like it holds a credential; describe the change without the secret');
    let text = '';
    try { text = fs.readFileSync(f, 'utf8'); } catch { /* first entry */ }
    const line = formatEntry(entry);
    let next: string;
    if (!text.trim()) next = `${HEAD}${line}\n`;
    else {
      // under the first entry-like line's position: the title and intro (anything before the first "- ") stay on top
      const lines = text.split(/\r?\n/);
      const first = lines.findIndex(l => /^- /.test(l));
      if (first < 0) next = `${text.replace(/\s*$/, '')}\n\n${line}\n`;
      else { lines.splice(first, 0, line); next = lines.join('\n'); }
    }
    fs.writeFileSync(f, next, 'utf8');
    return { ...entry, target: field(entry.target, 200), by: field(entry.by, 60), summary: field(entry.summary, 400) };
  }
}
