// "Discuti" on a DevOps record (a work item, a PR, a test plan or a test case): the ready message for the Orchestrator,
// pure. It never starts a work chat: the Orchestrator reads it, says what it would do and, when there is work, opens and
// briefs the work chat itself (owner, 2026-10-19: one "Discuti" button replaces "Apri chat" everywhere). The message has
// the record (title, type, state, link, numbers), its area (the PR's repo or the work item's project; none: "DevOps"),
// the folder hint (the repo's local clone when main found one, TasksState.repoDirs), the right first step for that kind
// of record (a bug or task: read it with comments and links, then a plan; a PR: review and QA, or what is missing to
// close it; a test plan or case: run or check it) and the suggested title of the work chat ("Area · <record title>").
// `recordKey` keys the "Discussa" mark (lib/discuss.ts). Why: the user, 2026-10-13, "su devops vorrei un pulsantino
// comodo per far partire una chat da un record devops", then 2026-10-19 "passa dall'Orchestrator". Used by
// components/RecordDiscussButton.tsx; test/unit/record-discuss.test.ts.
import type { DevopsItem, DevopsPrRef, QaPlan, QaPoint } from '@shared/contract';
import { t } from '../../i18n';

export type DevopsRecord =
  | { kind: 'workitem'; item: DevopsItem }
  | { kind: 'pr'; pr: DevopsPrRef; mine?: boolean }
  | { kind: 'testplan'; plan: QaPlan; pr: DevopsPrRef | null }
  | { kind: 'testcase'; point: QaPoint; plan: QaPlan; pr: DevopsPrRef | null };

/** The area of a repo or project name: the name itself, else "DevOps". */
export function areaOf(name: string | null | undefined): string {
  const n = (name ?? '').trim();
  return n || 'DevOps';
}

/** The record's own id (the work item, the PR, the plan, the test point). */
export const recordId = (r: DevopsRecord): number => (r.kind === 'workitem' ? r.item.id : r.kind === 'pr' ? r.pr.id : r.kind === 'testplan' ? r.plan.id : r.point.id);
/** Stable key of the record's "Discussa" mark. */
export const recordKey = (r: DevopsRecord): string => `devops|${r.kind}|${recordId(r)}`;

const TITLE_MAX = 80;
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
const who = (s: string) => s.replace(/\s*<.*$/, '');

function parts(r: DevopsRecord): { area: string; title: string; repo: string | null } {
  switch (r.kind) {
    case 'workitem': return { area: areaOf(r.item.project), title: r.item.title, repo: null };
    case 'pr': return { area: areaOf(r.pr.repo || r.pr.project), title: r.pr.title, repo: r.pr.repo || null };
    case 'testplan': return { area: areaOf(r.pr?.repo || r.pr?.project), title: r.plan.name || r.pr?.title || 'Test plan', repo: r.pr?.repo || null };
    case 'testcase': return { area: areaOf(r.pr?.repo || r.pr?.project), title: r.point.testCase.title, repo: r.pr?.repo || null };
  }
}

/** The title the work chat would have, if the Orchestrator opens one: "Area · <record title>", short enough for a tile. */
export function recordTitle(r: DevopsRecord): string {
  const p = parts(r);
  return clip(`${p.area} · ${p.title.trim() || t('brainLib.recordDiscuss.untitled')}`, TITLE_MAX);
}

/** The record, as lines: what it is, its link, its facts, and the first step the work would start from. */
function recordLines(r: DevopsRecord): { head: string[]; step: string } {
  switch (r.kind) {
    case 'workitem': {
      const w = r.item, kind = w.type || 'Work item';
      return {
        head: [
          `Let's discuss this ${kind.toLowerCase() === 'bug' ? 'bug' : `work item (${kind})`} from Azure DevOps: «${w.title}».`,
          `Link: ${w.url}`,
          `Type: ${kind} · status: ${w.state || '?'}${w.priority !== null ? ` · priority ${w.priority}` : ''}${w.assignedTo ? ` · assigned to ${who(w.assignedTo)}` : ''}`,
        ],
        step: 'read it completely with comments, attachments and links (PRs, test cases, related work items), then a plan in a few lines before touching anything',
      };
    }
    case 'pr': return {
      head: [
        `Let's discuss this pull request from Azure DevOps: «${r.pr.title}».`,
        `Link: ${r.pr.url}`,
        `Type: pull request${r.mine ? ' (mine)' : ' (to review)'} · repo ${r.pr.repo || '?'}${r.pr.author ? ` · author ${who(r.pr.author)}` : ''}`,
      ],
      step: r.mine
        ? 'read the PR with open discussions, the build and related work items, then say what is missing to close it (comments to resolve, build, QA) before touching anything'
        : 'review the PR (diff, discussions, related work items) and say what to test in QA; propose comments before writing them',
    };
    case 'testplan': return {
      head: [
        `Let's discuss this test plan from Azure DevOps: «${r.plan.name}»${r.pr ? `, from the PR «${r.pr.title}»` : ''}.`,
        `Link: ${r.plan.url}${r.pr ? `\nPR: ${r.pr.url}` : ''}`,
        `Type: test plan · ${r.plan.totals.done} test cases executed out of ${r.plan.totals.total}, ${r.plan.totals.failed} failed, ${r.plan.totals.missing} to do`,
      ],
      step: 'check the plan (test cases, results, related bugs) and propose which ones to run or re-run and how, before executing anything',
    };
    case 'testcase': return {
      head: [
        `Let's discuss this test case from Azure DevOps: «${r.point.testCase.title}», from the test plan «${r.plan.name}»${r.pr ? ` (PR «${r.pr.title}»)` : ''}.`,
        `Link: ${r.point.testCase.url}\nTest plan: ${r.plan.url}`,
        `Type: test case · result: ${r.point.outcome ?? 'not yet executed'}${r.point.ranBy ? ` (by ${r.point.ranBy})` : ''}${r.point.bugs.length ? ` · ${r.point.bugs.length} related bugs` : ''}`,
      ],
      step: 'read the test case steps and related bugs, then propose how to run or verify it, before executing anything',
    };
  }
}

/** The draft for the Orchestrator; `repoDirs` from TasksState (repo → local clone). */
export function recordDiscussText(r: DevopsRecord, repoDirs: Readonly<Record<string, string>> = {}): string {
  const p = parts(r);
  const { head, step } = recordLines(r);
  const cwd = p.repo ? repoDirs[p.repo] : undefined;
  const where = cwd ? `Folder: the local clone of ${p.repo}, ${cwd}.`
    : p.repo ? `Folder: no local clone of ${p.repo} found; the brain folder unless you know better.` : 'Folder: the brain folder unless the work needs a repo.';
  return [
    ...head,
    `Area: ${p.area}`,
    where,
    '',
    `Tell me in a few lines what you would do. If it needs work, open a work chat yourself («${recordTitle(r)}»${cwd ? ', in that folder' : ''}) and brief it to ${step}.`,
  ].join('\n');
}
