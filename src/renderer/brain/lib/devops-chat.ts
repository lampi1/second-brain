// "Apri chat" on a DevOps record (a work item, a PR, a test plan or a test case): the title, the first message and the
// folder of the new work chat, pure. Title "Area · <record title>" (the area: the PR's repo or the work item's project;
// none: "DevOps"); the first message has the link, the type and state
// and the right first step (a bug or task: read it with comments and links, then a plan; a PR: review and QA; a test
// plan or case: run or check it); the folder is the repo's local clone when main found one (DevopsState.repoDirs), else
// none (the app's default: the brain folder). Why: the user, 2026-10-13, "su devops vorrei un pulsantino comodo per far
// partire una chat da un record devops". Used by pages/Devops.tsx and pages/DevopsQa.tsx; test/unit/devops-chat.test.ts.
import type { DevopsItem, DevopsPrRef, QaPlan, QaPoint } from '@shared/contract';

export type DevopsRecord =
  | { kind: 'workitem'; item: DevopsItem }
  | { kind: 'pr'; pr: DevopsPrRef; mine?: boolean }
  | { kind: 'testplan'; plan: QaPlan; pr: DevopsPrRef | null }
  | { kind: 'testcase'; point: QaPoint; plan: QaPlan; pr: DevopsPrRef | null };

export interface RecordChat { title: string; prompt: string; cwd?: string }

/** The area of a repo or project name: the name itself, else "DevOps". */
export function areaOf(name: string | null | undefined): string {
  const n = (name ?? '').trim();
  return n || 'DevOps';
}

const TITLE_MAX = 80;
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

function parts(r: DevopsRecord): { area: string; title: string; repo: string | null } {
  switch (r.kind) {
    case 'workitem': return { area: areaOf(r.item.project), title: r.item.title, repo: null };
    case 'pr': return { area: areaOf(r.pr.repo || r.pr.project), title: r.pr.title, repo: r.pr.repo || null };
    case 'testplan': return { area: areaOf(r.pr?.repo || r.pr?.project), title: r.plan.name || r.pr?.title || 'Test plan', repo: r.pr?.repo || null };
    case 'testcase': return { area: areaOf(r.pr?.repo || r.pr?.project), title: r.point.testCase.title, repo: r.pr?.repo || null };
  }
}

/** What a work item's chat starts with: a bug or a task is read in full first, then a plan before touching code. */
function itemPrompt(w: DevopsItem): string[] {
  const kind = w.type || 'Work item';
  return [
    `Lavoriamo su questo ${kind.toLowerCase() === 'bug' ? 'bug' : `work item (${kind})`} di Azure DevOps: «${w.title}».`,
    `Link: ${w.url}`,
    `Tipo: ${kind} · stato: ${w.state || '?'}${w.priority !== null ? ` · priorità ${w.priority}` : ''}${w.assignedTo ? ` · assegnato a ${w.assignedTo.replace(/\s*<.*$/, '')}` : ''}`,
    '',
    'Primo passo: leggilo per intero con commenti, allegati e link (PR, test case, work item collegati), poi proponimi un piano in poche righe prima di toccare qualcosa.',
  ];
}

/** The new chat for a record; `repoDirs` from DevopsState (repo → local clone). */
export function recordChat(r: DevopsRecord, repoDirs: Readonly<Record<string, string>> = {}): RecordChat {
  const p = parts(r);
  const title = clip(`${p.area} · ${p.title.trim() || 'senza titolo'}`, TITLE_MAX);
  let lines: string[];
  switch (r.kind) {
    case 'workitem': lines = itemPrompt(r.item); break;
    case 'pr': lines = [
      `Lavoriamo su questa pull request di Azure DevOps: «${r.pr.title}».`,
      `Link: ${r.pr.url}`,
      `Tipo: pull request · repo ${r.pr.repo || '?'}${r.pr.author ? ` · autore ${r.pr.author.replace(/\s*<.*$/, '')}` : ''}`,
      '',
      r.mine
        ? 'Primo passo: leggi la PR con le discussioni aperte, la build e i work item collegati, poi dimmi cosa manca per chiuderla (commenti da risolvere, build, QA) prima di toccare qualcosa.'
        : 'Primo passo: fai la review della PR (diff, discussioni, work item collegati) e dimmi cosa testare in QA; proponi i commenti prima di scriverli.',
    ]; break;
    case 'testplan': lines = [
      `Lavoriamo su questo test plan di Azure DevOps: «${r.plan.name}»${r.pr ? `, della PR «${r.pr.title}»` : ''}.`,
      `Link: ${r.plan.url}${r.pr ? `\nPR: ${r.pr.url}` : ''}`,
      `Tipo: test plan · ${r.plan.totals.done} test case eseguiti su ${r.plan.totals.total}, ${r.plan.totals.failed} falliti, ${r.plan.totals.missing} da fare`,
      '',
      'Primo passo: controlla il piano (test case, esiti, bug collegati) e proponimi quali eseguire o rieseguire e come, prima di eseguire qualcosa.',
    ]; break;
    case 'testcase': lines = [
      `Lavoriamo su questo test case di Azure DevOps: «${r.point.testCase.title}», del test plan «${r.plan.name}»${r.pr ? ` (PR «${r.pr.title}»)` : ''}.`,
      `Link: ${r.point.testCase.url}\nTest plan: ${r.plan.url}`,
      `Tipo: test case · esito: ${r.point.outcome ?? 'non ancora eseguito'}${r.point.ranBy ? ` (da ${r.point.ranBy})` : ''}${r.point.bugs.length ? ` · ${r.point.bugs.length} bug collegati` : ''}`,
      '',
      'Primo passo: leggi i passi del test case e i bug collegati, poi proponimi come eseguirlo o verificarlo, prima di eseguire qualcosa.',
    ]; break;
  }
  const cwd = p.repo ? repoDirs[p.repo] : undefined;
  return { title, prompt: lines.join('\n'), ...(cwd ? { cwd } : {}) };
}
