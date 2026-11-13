// Feed and Task: feed events, the user's Azure DevOps work items, PRs and QA reports (src/main/tasks).
// One area of the IPC contract: src/shared/contract.ts re-exports it and assembles the channel maps (change a shape
// here first, then both sides).
import type { AgentUndo } from '../agents';

export type Priority = 'urgent' | 'normal' | 'quiet';
export interface FeedEvent {
  id: string;
  at: number;
  kind: string;               // 'chat-waiting' | 'chat-done' | 'error' | 'idea' | 'reflection' | 'win' | ...
  label: string;              // Italian label of the kind ("Idea aggiunta")
  priority: Priority;
  title: string;
  detail: string;
  who?: string;
  chatId?: string;
  file?: string;
  away?: boolean;             // happened while the app was closed
  /** the card's one action (agent-retired: Ripristina) */
  action?: FeedAction;
}
/** brain-undo: the changes a maintenance pass the app ran by itself made (brainmodel:rollback each, newest first; ADR 0102) */
/** connector-undo: a connector change the Orchestrator made (app_config, ADR 0207): mcpservers:undo with its key;
 *  `activate`: the server waits for the user's «Attiva» (mcpservers:activate), shown with exactly what it runs */
export type FeedAction = { kind: 'agent-undo'; undo: AgentUndo } | { kind: 'agent-proposals' } | { kind: 'brain-undo'; ids: string[] } | { kind: 'connector-undo'; undo: string; activate?: { server: string; runs: string } };

// ---- DevOps (src/main/tasks): the user's Azure DevOps, read by the brain's read-only scripts, never written

export interface DevopsItem {
  id: number; type: string; title: string; state: string; project: string; priority: number | null;
  assignedTo: string | null; iteration: string | null; changedAt: string | null; url: string;
}
/** A comment as plain text (the script strips the HTML; the page shows it as text, never as HTML). */
export interface DevopsComment { who: string; mine: boolean; at: string; text: string }
/** A test case linked to a work item (Tested By) with the outcome of its most recent run (null = never run). */
export interface DevopsTest { id: number; title: string; outcome: string | null; url: string }
/** What the page shows inside a work item without opening DevOps (devops-me.mjs --full). */
export interface DevopsDetail {
  description: string | null; stateSince: string | null; createdAt: string | null;
  comments: DevopsComment[];   // newest first, at most 5
  tests: DevopsTest[];
}
export interface DevopsPrRef { id: number; title: string; repo: string; project: string; author: string | null; createdAt: string; url: string }
export interface DevopsPr extends DevopsPrRef {
  target: string; draft: boolean; autoComplete: boolean;
  /** the PR's own branch (sourceRefName without refs/heads/): Impara reads its diff in the local clone; absent from a
   *  brain's own older devops-me.mjs */
  source?: string;
  reviewers: { name: string; vote: number; label: string; required: boolean }[];
  build: { result: string | null; status: string; number: string; url: string; at: string | null } | null;
  workItems: DevopsItem[];
  /** --full: open discussions and the last human comment (anyone's) */
  activeThreads?: number;
  lastComment?: (DevopsComment & { url: string }) | null;
}
/** mention · touched (my item changed by someone) · taken (moved away from me) · review (asked for my vote) ·
 *  comment / vote / build (on my PRs) · followed (a ticket I follow or opened: state, assignee, comment) */
export type DevopsNewsKind = 'mention' | 'touched' | 'taken' | 'review' | 'comment' | 'vote' | 'build' | 'followed';
export interface DevopsNews {
  key: string; at: string; kind: DevopsNewsKind; who: string | null; title: string; detail?: string; url: string;
  /** the whole comment or mention as plain text (detail is its first 110 characters) */
  body?: string;
  item?: DevopsItem; pr?: DevopsPrRef; unread: boolean;
}
export interface TasksState {
  enabled: boolean;
  everyMin: number;
  /** the alerts' chime (setting tasks.sound) */
  sound: boolean;
  running: boolean;
  /** last successful read (ms) and the next automatic one (null when off) */
  at: number | null;
  nextAt: number | null;
  /** login = `az login` missing or expired (command says what to run); script = the brain has no devops-me.mjs */
  error: { kind: 'login' | 'script' | 'failed'; message: string; command?: string } | null;
  news: DevopsNews[];          // newest first, the last 14 days
  assigned: DevopsItem[];      // my open work items
  urgent: DevopsItem[];        // my open P1/P2 bugs with no news
  oldReviews: DevopsPrRef[];   // reviews waiting for me from before the window
  reviews: DevopsPrRef[];      // every review waiting for my vote at the last read (recent + old)
  prs: DevopsPr[];             // my active PRs, live
  details: Record<string, DevopsDetail>;  // by work item id: description, last comments, test cases
  unread: number;
  /** "Test e QA": my active PRs' test plans (ops/tools/qa-status.mjs --mine), read with the page; [] without that script */
  qa: QaReport[];
  /** the QA read failed (the rest of the page read fine): the last good qa stays */
  qaError: string | null;
  /** Last successful QA read, separate from PR refresh; absent in legacy snapshots. */
  qaAt?: number | null;
  /** repo name → its local clone (<home>/source/repos/<repo>), for the repos of the PRs on the page: "Discuti" names it
   *  to the Orchestrator as the folder of a PR's work; a repo with no clone is missing */
  repoDirs: Record<string, string>;
}

/** A test point: last outcome (null = not run yet), who ran it and when, who it is assigned to, its QA bugs' ids. */
export interface QaPoint {
  id: number; suite: string;
  testCase: { id: number; title: string; url: string };
  outcome: string | null; ranBy: string | null; ranAt: string | null; tester: string | null; bugs: number[];
}
export interface QaBug { id: number; title: string; state: string; open: boolean; assignedTo: string | null; createdAt: string | null; url: string; testCases: number[] }
export interface QaTotals {
  total: number; done: number; missing: number; passed: number; failed: number; blocked: number; notApplicable: number; other: number;
  byPerson: { name: string; done: number; passed: number; failed: number; blocked: number }[];
}
export interface QaPlan { id: number; name: string; url: string; points: QaPoint[]; totals: QaTotals }
export interface QaReport { pr: DevopsPrRef | null; plans: QaPlan[]; bugs: QaBug[]; totals: QaTotals & { bugs: number; openBugs: number } }

/** renderer → main, feed: each entry [argument, result]. Part of InvokeMap (src/shared/contract.ts). */
export interface FeedInvokeMap {
  'feed:list': [void, FeedEvent[]];
  'tasks:get': [void, TasksState];
  /** "Aggiorna ora": runs the scripts now (resolves when done; a read already running is joined) */
  'tasks:refresh': [void, TasksState];
  /** marks news read: the given keys, or all of them */
  'tasks:markRead': [{ keys?: string[] }, TasksState];
}
