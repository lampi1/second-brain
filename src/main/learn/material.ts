// What an Impara lesson is made from (ADR 0185), gathered by the app itself, read only, before any model runs: a GitHub
// PR through the user's own `gh` (view + diff), one of the Task page's Azure DevOps PRs through git in its local clone
// (the PR's branch against its target: diff, stat, commits; the app never fetches), a pasted text, or nothing for a
// topic. The model gets the material inline (up to INLINE_MAX characters) and the whole of it as files in the lesson's
// folder it may read. No credential is read or passed: gh and git use the user's own logins. Used by learn/service.ts;
// tests: test/unit/learn-material.test.ts.
import { execFile } from 'node:child_process';
import type { DevopsPr } from '@shared/contract';
import type { LessonPr, LessonStart } from '@shared/lesson';

/** What the prompt carries inline; the rest stays in the files. */
export const INLINE_MAX = 60_000;
const PASTED_MAX = 200_000;

export interface Material {
  /** the inline part of the prompt (markdown) */
  text: string;
  /** files written to the lesson's folder (name → content): the model may read them whole */
  files: Record<string, string>;
  /** the folder the model reads around the material (a PR's local clone), null = the lesson's own folder */
  cwd: string | null;
  /** short lines for the lesson's «Fonti» */
  sources: string[];
  pr?: LessonPr;
  /** a title when the material has one (the PR's) */
  title?: string;
}

export type Run = (cmd: string, args: string[], cwd?: string) => Promise<string>;

/** A read-only command with the user's own login, no prompt, no window. */
export const runRead: Run = (cmd, args, cwd) => new Promise((resolve, reject) => {
  execFile(cmd, args, { cwd, windowsHide: true, timeout: 90_000, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8',
    env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', PAGER: 'cat' } }, (err, stdout, stderr) => {
    if (err) reject(new Error(String(stderr || err.message).trim().slice(0, 300) || 'comando non riuscito')); else resolve(String(stdout));
  });
});

const GITHUB_PR = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d{1,7})(?:[/?#].*)?$/;
export const githubPr = (url: string): { owner: string; repo: string; number: number } | null => {
  const m = GITHUB_PR.exec(url.trim());
  return m ? { owner: m[1]!, repo: m[2]!, number: Number(m[3]) } : null;
};
const REF = /^[\w./-]{1,200}$/;

/** A diff cut for the prompt: whole when it fits, else the first files whole, then the names of the others. */
export function cutDiff(diff: string, max = INLINE_MAX): { text: string; cut: boolean } {
  if (diff.length <= max) return { text: diff, cut: false };
  const files = diff.split(/(?=^diff --git )/m);
  let out = ''; const left: string[] = [];
  for (const f of files) {
    if (!left.length && out.length + f.length <= max) out += f;
    else left.push(/^diff --git a\/(\S+)/.exec(f)?.[1] ?? '?');
  }
  return { text: `${out}\n… (${left.length} file non mostrati qui: ${left.slice(0, 40).join(', ')}${left.length > 40 ? ', …' : ''})`, cut: true };
}

interface GhView { number?: number; title?: string; body?: string; url?: string; author?: { login?: string }; baseRefName?: string; headRefName?: string;
  additions?: number; deletions?: number; changedFiles?: number; files?: { path?: string; additions?: number; deletions?: number }[]; commits?: { messageHeadline?: string }[] }

async function githubMaterial(url: string, run: Run): Promise<Material> {
  const ref = githubPr(url)!;
  let view: GhView;
  try { view = JSON.parse(await run('gh', ['pr', 'view', url, '--json', 'number,title,body,url,author,baseRefName,headRefName,additions,deletions,changedFiles,files,commits'])) as GhView; }
  catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    if (/ENOENT|not found|not recognized/i.test(why)) throw new Error('Per le PR di GitHub serve gh installato e collegato (gh auth login).');
    throw new Error(`gh non ha letto la PR: ${why}`);
  }
  const diff = await run('gh', ['pr', 'diff', url]).catch(e => { throw new Error(`gh non ha letto il diff: ${e instanceof Error ? e.message : String(e)}`); });
  const pr: LessonPr = { provider: 'github', url: view.url ?? url, title: String(view.title ?? `PR #${ref.number}`).slice(0, 200), repo: `${ref.owner}/${ref.repo}`, number: ref.number };
  const files = (view.files ?? []).slice(0, 200).map(f => `- ${f.path} (+${f.additions ?? 0} −${f.deletions ?? 0})`).join('\n');
  const commits = (view.commits ?? []).slice(-30).map(c => `- ${c.messageHeadline ?? ''}`).join('\n');
  const head = [`# PR #${pr.number} · ${pr.title}`, `Repository: ${pr.repo} · ${view.headRefName ?? '?'} → ${view.baseRefName ?? '?'} · autore ${view.author?.login ?? '?'}`,
    `Modifiche: ${view.changedFiles ?? '?'} file, +${view.additions ?? 0} −${view.deletions ?? 0}`, '', '## Descrizione', String(view.body ?? '').trim() || '(nessuna)', '',
    '## File', files || '(nessuno)', '', '## Commit', commits || '(nessuno)'].join('\n');
  return finish(head, diff, null, [`PR #${pr.number} (${pr.repo})`, `${view.changedFiles ?? 0} file nel diff`], pr);
}

async function devopsMaterial(pr: DevopsPr, dir: string | null, run: Run): Promise<Material> {
  const lp: LessonPr = { provider: 'devops', url: pr.url, title: pr.title, repo: pr.repo, number: pr.id };
  const head = [`# PR ${pr.id} · ${pr.title}`, `Repository: ${pr.project}/${pr.repo} · ${pr.source ?? '?'} → ${pr.target || '?'} · autore ${pr.author ?? '?'}`,
    pr.workItems.length ? `\n## Work item\n${pr.workItems.slice(0, 20).map(w => `- ${w.id} ${w.title}`).join('\n')}` : ''].join('\n');
  if (!dir) return finish(`${head}\n\n(Nessuna copia locale del repository: il diff non è disponibile. Spiega dalla descrizione e dai work item, e dillo.)`, '', null, [`PR ${pr.id} (${pr.repo})`, 'senza diff: nessuna copia locale'], lp);
  const refOf = async (name: string | undefined): Promise<string | null> => {
    if (!name || !REF.test(name)) return null;
    for (const cand of [`origin/${name}`, name]) {
      try { await run('git', ['rev-parse', '--verify', '--quiet', `${cand}^{commit}`], dir); return cand; } catch { /* next */ }
    }
    return null;
  };
  const [headRef, baseRef] = [await refOf(pr.source), await refOf(pr.target)];
  if (!headRef || !baseRef) {
    return finish(`${head}\n\n(Il ramo della PR${pr.source ? ` «${pr.source}»` : ''} o quello di destinazione non sono nella copia locale ${dir}: il diff non è disponibile. Leggi il codice nella cartella se serve, e dillo.)`, '', dir,
      [`PR ${pr.id} (${pr.repo})`, 'diff non trovato nella copia locale'], lp);
  }
  const range = `${baseRef}...${headRef}`;
  const [stat, diff, log] = await Promise.all([
    run('git', ['diff', '--stat', range], dir).catch(() => ''),
    run('git', ['diff', range], dir),
    run('git', ['log', '--format=- %h %s', '-n', '30', `${baseRef}..${headRef}`], dir).catch(() => ''),
  ]);
  return finish(`${head}\n\n## File\n${stat.trim() || '(nessuno)'}\n\n## Commit\n${log.trim() || '(nessuno)'}`, diff, dir, [`PR ${pr.id} (${pr.repo})`, `diff ${baseRef}…${headRef}`], lp);
}

function finish(head: string, diff: string, cwd: string | null, sources: string[], pr?: LessonPr): Material {
  const files: Record<string, string> = { 'materiale.md': head };
  let text = head;
  if (diff.trim()) {
    files['diff.patch'] = diff;
    const cut = cutDiff(diff, Math.max(10_000, INLINE_MAX - head.length));
    text += `\n\n## Diff${cut.cut ? ' (tagliato: quello intero è nel file diff.patch)' : ''}\n\`\`\`diff\n${cut.text}\n\`\`\``;
  }
  return { text, files, cwd, sources, ...(pr ? { pr, title: pr.title } : {}) };
}

export interface GatherDeps {
  run: Run;
  /** the Task page's PRs and their local clones (tasks/service.ts) */
  devops: () => { prs: readonly DevopsPr[]; repoDirs: Readonly<Record<string, string>> };
}

/** The material of a start request. Throws a sentence for the user when it cannot be gathered. */
export async function gather(req: LessonStart, d: GatherDeps): Promise<Material> {
  if (req.kind === 'topic') return { text: '', files: {}, cwd: null, sources: [] };
  if (req.kind === 'text') {
    const t = String(req.text ?? '').trim();
    if (!t) throw new Error('Incolla il testo da spiegare.');
    const whole = t.slice(0, PASTED_MAX);
    return { text: `## Testo dell'utente\n${whole.slice(0, INLINE_MAX)}${whole.length > INLINE_MAX ? '\n… (il resto è nel file testo.md)' : ''}`, files: { 'testo.md': whole }, cwd: null, sources: ['testo incollato'] };
  }
  const url = String(req.prUrl ?? '').trim();
  if (!url) throw new Error('Scegli una PR o incollane il link.');
  if (githubPr(url)) return githubMaterial(url, d.run);
  const { prs, repoDirs } = d.devops();
  const pr = prs.find(p => p.url === url);
  if (!pr) throw new Error('PR non riconosciuta: incolla il link di una PR di GitHub o scegline una delle tue dal Task.');
  return devopsMaterial(pr, repoDirs[pr.repo] ?? null, d.run);
}
