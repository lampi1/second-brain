// Work on this app, told apart from the work of the work Regia: Fatto shows only the latter (the owner, 2026-10-13:
// "mi interessa solo il Fatto, non dell’app che lo vedo già nella sezione Migliora l’app, ma della Regia del lavoro").
// The brain’s day report mixes both, so the page filters here: the chats of "Migliora l’app" (titles «App · …»,
// «Pers · App: …», «Regia dell’app»; any chat whose project folder is the app’s repo or one of its worktrees; untitled
// chats with no folder, from reports older than the folder field), diary lines that start with "app:", the brain
// commits about the app and the lines of the technical report that name them. Used by pages/Fatto.tsx (rows, report text, diary table, stand-up).
import { t } from '../../i18n';
import { normBrief, normReport, type Brief, type DayReport, type DayRow, type JournalRow } from '../types';

/** A chat or thread title of the app’s own work: «App · …», «Pers · App: …», «Regia dell’app», older «… second-brain …». */
const APP_TITLE = /^(?:\*\*)?(?:Pers\s*·\s*)?App\s*[·:]|^Regia dell['’]app\b|second-brain/i;
/** A diary line about the app: "app: …" (after the time and the tag), or one that names its repo. */
const APP_NOTE = /^(?:\[personale\]\s*)?app:|second-brain/i;
/** A brain commit about the app: "app:"/"product:" (scoped too: "feat(product): …"), or it names the app or its repo. */
const APP_COMMIT = /^(?:\w+\()?(?:app|product)\)?!?:|\bthe app\b|\bapp's\b|second-brain/i;
/** A chat line of the Cursor/Claude chat list: "Claude · App · X · folder · 13/10, 19:48 · finito" → "App · X". */
const listedChat = (s: string) => s.replace(/^(?:Cursor|Claude)\s*·\s*/i, '');
/** The app’s repo or one of its worktrees (…\second-brain-app, …\second-brain-app-wt\<name>). */
const APP_FOLDER = /[\\/]second-brain-app(?:-wt)?(?:[\\/]|$)/i;

export const isAppTitle = (title: string): boolean => APP_TITLE.test(title.trim());
export const isAppNote = (text: string): boolean => APP_NOTE.test(text.trim());
export const isAppCommit = (msg: string): boolean => APP_COMMIT.test(msg.trim());

/** A row of the day report about the app’s own work. */
export function isAppRow(r: DayRow, appRepo?: string | null): boolean {
  if (r.kind === 'diario') return isAppNote(r.title);
  const cwd = typeof r.cwd === 'string' ? r.cwd : '';
  if ((r.kind === 'chat' || r.kind.startsWith('chat-')) && cwd) return inAppRepo(cwd, appRepo) || APP_FOLDER.test(cwd) || isAppTitle(listedChat(r.title));
  if (r.kind === 'chat' && r.title === t('brainLib.appwork.untitled')) return true; // no folder to tell: an untitled chat is no work to report
  if (r.kind === 'chat' || r.kind.startsWith('chat-')) return isAppTitle(listedChat(r.title));
  return /second-brain/i.test(r.title);
}

/** Compare a configured checkout at path boundaries, including worktrees nested below it. */
function inAppRepo(cwd: string, root?: string | null): boolean {
  if (!root) return false;
  const normalize = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const windows = /^[a-z]:|^\\\\/i.test(root);
  const key = (p: string) => windows ? normalize(p).toLowerCase() : normalize(p);
  return key(cwd) === key(root) || key(cwd).startsWith(`${key(root)}/`);
}

/** A line of the technical report about the app: a chat «App · …», an "app:" diary line, an app commit. */
function isAppLine(line: string, inCommits: boolean): boolean {
  const l = line.replace(/^\s*[-*]\s+/, '');
  const chat = /^chat (?:Claude|Cursor)\s+"([^"]+)"/i.exec(l);
  if (chat) return isAppTitle(chat[1]!);
  const listed = /^chat (?:Claude|Cursor)\s+((?:Cursor|Claude)\s*·.*)$/i.exec(l); // a line of the chat list, no quotes
  if (listed) return isAppTitle(listedChat(listed[1]!));
  const diary = /^diario:\s*(?:\d{1,2}:\d{2}(?: UTC)?\s*·\s*[^·]+·\s*)?(.*)$/i.exec(l);
  if (diary) return isAppNote(diary[1]!);
  return inCommits && isAppCommit(l);
}

/** The day report without the app's own work: rows, commits and the lines of its markdown. */
export function withoutAppWork(rep: DayReport, appRepo?: string | null): DayReport {
  let inCommits = false;
  // the report's line of a dropped chat: same title and hours ('chat Claude "T" 09:34-11:54, …')
  const dropped = new Set(rep.rows.filter(r => (r.kind === 'chat' || r.kind.startsWith('chat-')) && isAppRow(r, appRepo)).map(r => `"${r.title}" ${r.from ?? ''}-${r.to ?? ''}`));
  const text = rep.text.split('\n').filter(l => {
    if (/^#{1,6}\s/.test(l)) { inCommits = /commit/i.test(l); return true; }
    const chat = /^\s*[-*]\s+chat (?:Claude|Cursor|Codex)\s+("[^"]+"\s+\d{1,2}:\d{2}-\d{1,2}:\d{2})/.exec(l);
    if (chat && dropped.has(chat[1]!)) return false;
    if (/^\s*\|/.test(l)) return !isAppTitle(l.replace(/^\s*\|/, '').split('|')[0] ?? ''); // a table row: its first cell
    return !/^\s*[-*]\s/.test(l) || !isAppLine(l, inCommits);
  }).join('\n');
  return { ...rep, rows: rep.rows.filter(r => !isAppRow(r, appRepo)), commits: rep.commits.filter(c => !isAppCommit(c)), text };
}

/** The diary rows of the work, without "app: …" lines. */
export const workJournal = (rows: JournalRow[]): JournalRow[] => rows.filter(r => !isAppNote(r.testo));

/** The brief without the app's threads (the stand-up reads it). */
export const withoutAppThreads = (br: Brief): Brief => ({ ...br, threads: br.threads.filter(t => !isAppTitle(t.label)) });

/** Normalizers for useBrain (stable references: the data is filtered once per fetch). */
export const normWorkReport = (v: unknown, appRepo?: string | null): DayReport => withoutAppWork(normReport(v), appRepo);
export const normWorkBrief = (v: unknown): Brief => withoutAppThreads(normBrief(v));
