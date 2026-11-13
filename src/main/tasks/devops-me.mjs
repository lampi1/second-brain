// The app's own Azure DevOps reader for the Task page (issue #95): what the owner's personal ops/tools/devops-me.mjs
// prints, for every brain that has no such script (a fresh brain has none, ADR 0072: app machinery stays in the app).
// Run by TaskService (tasks/service.ts) with Electron's binary as Node, cwd = the brain folder; scripts/build.mjs copies
// it to out/tasks/. Read-only by construction: only GETs and WIQL queries (a read-only POST) to Azure DevOps, with the
// token of the user's own Azure CLI login (`az account get-access-token`), never stored, never printed; no AI, no tokens.
//   node devops-me.mjs --json [--full] [--days N]   news of the last N days, my open work items, reviews waiting on me
//   node devops-me.mjs --prs --json [--full]        my active PRs (reviewers, linked work items, last comment)
// Organizations: --org <name>, else SB_DEVOPS_ORG (comma separated), else DEVOPS_ORG in the brain's brain.json, else
// every organization the account belongs to (Azure DevOps profile API), at most 5. Exit 2 = Azure login missing or
// expired (the page shows "az login"), 1 = anything else (the first stderr line is the reason). Unit tests:
// test/unit/tasks-app-script.test.ts (the pure helpers below, exported; nothing runs on import).
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RESOURCE = '499b84ac-1321-427f-aa17-267ca6975798'; // Azure DevOps, for az account get-access-token
const V = 'api-version=7.1';
const MAX_ORGS = 5, MAX_PROJECTS = 50, MAX_ITEMS = 200, MAX_DETAILS = 30, TEXT_MAX = 4000;
const CLOSED = ['Closed', 'Done', 'Removed', 'Resolved', 'Completed', 'Cut'];
const VOTES = { 10: 'approvata', 5: 'approvata con suggerimenti', 0: 'nessun voto', [-5]: 'in attesa autore', [-10]: 'rifiutata' };
const LOGIN = 'DevOps: login di Azure mancante o scaduto. Lancia: az login';

export class LoginError extends Error {}

/** An organization name from a bare name, https://dev.azure.com/<org>[/...] or https://<org>.visualstudio.com; null if unusable. */
export function orgOf(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  const m = /^https:\/\/dev\.azure\.com\/([^/?#]+)/i.exec(s) ?? /^https:\/\/([^./?#]+)\.visualstudio\.com/i.exec(s);
  if (m) s = m[1];
  return /^[A-Za-z0-9][A-Za-z0-9-]{0,49}$/.test(s) && s.toLowerCase() !== 'your-org' ? s : null;
}

/** The organizations the user named (flag, env, brain.json), in that order, without duplicates. */
export function configuredOrgs(argv, env, brainJson) {
  const out = [];
  const i = argv.indexOf('--org');
  if (i >= 0) out.push(argv[i + 1]);
  if (env.SB_DEVOPS_ORG) out.push(...env.SB_DEVOPS_ORG.split(','));
  try { out.push(JSON.parse(brainJson ?? 'null')?.template?.DEVOPS_ORG); } catch { /* no usable brain.json: discovered */ }
  return [...new Set(out.map(orgOf).filter(Boolean))].slice(0, MAX_ORGS);
}

export const days = argv => { const i = argv.indexOf('--days'); const n = i >= 0 ? Math.round(Number(argv[i + 1])) : 3; return Number.isFinite(n) ? Math.min(14, Math.max(1, n)) : 3; };
export const plain = html => String(html ?? '').replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, '\n').replace(/<[^>]*>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/\n{3,}/g, '\n\n').trim().slice(0, TEXT_MAX);
const enc = encodeURIComponent;
export const itemUrl = (org, project, id) => `https://dev.azure.com/${enc(org)}/${enc(project)}/_workitems/edit/${id}`;
export const prUrl = (org, project, repo, id) => `https://dev.azure.com/${enc(org)}/${enc(project)}/_git/${enc(repo)}/pullrequest/${id}`;
const name = who => (who && typeof who === 'object' ? who.displayName ?? null : typeof who === 'string' ? who.replace(/\s*<[^>]*>$/, '') : null);
const whoId = who => (who && typeof who === 'object' ? who.id ?? null : null);

/** A work item of the workitemsbatch API as the Task page reads it (model.ts itemOf). */
export function itemOf(org, w) {
  const f = w.fields ?? {};
  const project = f['System.TeamProject'] ?? '';
  return { id: w.id, type: f['System.WorkItemType'] ?? '', title: f['System.Title'] ?? '', state: f['System.State'] ?? '', project,
    priority: typeof f['Microsoft.VSTS.Common.Priority'] === 'number' ? f['Microsoft.VSTS.Common.Priority'] : null,
    assignedTo: name(f['System.AssignedTo']), iteration: f['System.IterationPath'] ?? null, changedAt: f['System.ChangedDate'] ?? null, url: itemUrl(org, project, w.id) };
}

/** A pull request of the Git API as a PR reference (model.ts prRefOf). */
export function prRefOf(org, p) {
  const project = p.repository?.project?.name ?? '', repo = p.repository?.name ?? '';
  return { id: p.pullRequestId, title: p.title ?? '', repo, project, author: name(p.createdBy), createdAt: p.creationDate ?? '', url: prUrl(org, project, repo, p.pullRequestId) };
}

/** One work item change as news (model.ts newsOf): kind, who changed it, the key = item + revision (never twice). */
export function changeNews(kind, org, w) {
  const it = itemOf(org, w);
  return { at: w.fields?.['System.ChangedDate'], kind, who: name(w.fields?.['System.ChangedBy']), title: it.title, detail: `stato ${it.state}`, url: it.url, key: `${kind}:${org}:${w.id}:${w.rev}`, item: it };
}

/** The reviews waiting on me: news when asked in the window, else old reviews (my vote still 0). */
export function splitReviews(org, prs, meId, since) {
  const news = [], oldReviews = [];
  for (const p of prs) {
    if (p.createdBy?.id === meId) continue;
    const mine = (p.reviewers ?? []).find(r => r.id === meId);
    if (mine && mine.vote) continue;
    const ref = prRefOf(org, p);
    if (Date.parse(p.creationDate) >= since) news.push({ at: p.creationDate, kind: 'review', who: ref.author, title: ref.title, url: ref.url, key: `review:${org}:${p.pullRequestId}`, pr: ref });
    else oldReviews.push(ref);
  }
  return { news, oldReviews };
}

// ---- I/O (not unit-tested: az and the network)

function azToken() {
  const cmd = `az account get-access-token --resource ${RESOURCE} --query accessToken --output tsv`;
  const win = process.platform === 'win32';
  return new Promise((resolve, reject) => execFile(win ? process.env.ComSpec ?? 'cmd.exe' : 'az', win ? ['/d', '/s', '/c', cmd] : cmd.split(' ').slice(1),
    { windowsHide: true, timeout: 60_000, maxBuffer: 1 << 20, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err && err.code === 'ENOENT') return reject(new LoginError('az: command not found (Azure CLI)'));
      if (/is not recognized/i.test(stderr ?? '')) return reject(new LoginError(String(stderr).trim()));
      const token = String(stdout ?? '').trim();
      return err || !token ? reject(new LoginError(LOGIN)) : resolve(token);
    }));
}

function client(token) {
  return async (url, body) => {
    const r = await fetch(url, { method: body ? 'POST' : 'GET', redirect: 'manual', signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    // a bad or expired token: 401, or 203/302 to the sign-in page
    if (r.status === 401 || r.status === 203 || (r.status >= 300 && r.status < 400)) throw new LoginError(LOGIN);
    if (!r.ok) throw new Error(`Azure DevOps ha risposto ${r.status} su ${new URL(url).pathname}`);
    return r.json();
  };
}

async function discoverOrgs(api) {
  const me = await api(`https://app.vssps.visualstudio.com/_apis/profile/profiles/me?${V}`);
  const res = await api(`https://app.vssps.visualstudio.com/_apis/accounts?memberId=${enc(me.id)}&${V}`);
  return (res.value ?? []).map(a => orgOf(a.accountName)).filter(Boolean).slice(0, MAX_ORGS);
}

const FIELDS = ['System.Id', 'System.WorkItemType', 'System.Title', 'System.State', 'System.TeamProject', 'Microsoft.VSTS.Common.Priority', 'System.AssignedTo',
  'System.IterationPath', 'System.ChangedDate', 'System.ChangedBy', 'System.CreatedDate', 'Microsoft.VSTS.Common.StateChangeDate', 'System.Description'];

async function wiql(api, org, where) {
  const base = `https://dev.azure.com/${enc(org)}/_apis/wit`;
  const res = await api(`${base}/wiql?$top=${MAX_ITEMS}&${V}`, { query: `SELECT [System.Id] FROM WorkItems WHERE ${where} ORDER BY [System.ChangedDate] DESC` });
  const ids = (res.workItems ?? []).map(w => w.id).slice(0, MAX_ITEMS);
  if (!ids.length) return [];
  const got = await api(`${base}/workitemsbatch?${V}`, { ids, fields: FIELDS, errorPolicy: 'Omit' });
  return (got.value ?? []).filter(Boolean);
}
/** A query that may not exist on this server (@RecentMentions, @Follows): no rows instead of a failed read. */
const optional = p => p.catch(e => { if (e instanceof LoginError) throw e; return []; });

async function detailsFor(api, org, items, meId) {
  const out = {};
  for (const w of items.slice(0, MAX_DETAILS)) {
    const f = w.fields ?? {};
    const project = f['System.TeamProject'];
    const c = await optional(api(`https://dev.azure.com/${enc(org)}/${enc(project)}/_apis/wit/workItems/${w.id}/comments?$top=5&order=desc&api-version=7.1-preview.4`).then(r => r.comments ?? []));
    out[w.id] = { description: plain(f['System.Description']) || null, stateSince: f['Microsoft.VSTS.Common.StateChangeDate'] ?? null, createdAt: f['System.CreatedDate'] ?? null,
      comments: c.map(x => ({ who: name(x.createdBy) ?? '', mine: whoId(x.createdBy) === meId, at: x.createdDate, text: plain(x.text) })), tests: [] };
  }
  return out;
}

async function projectsOf(api, org) {
  const res = await api(`https://dev.azure.com/${enc(org)}/_apis/projects?$top=${MAX_PROJECTS}&stateFilter=wellFormed&${V}`);
  return (res.value ?? []).map(p => p.name).filter(Boolean).slice(0, MAX_PROJECTS);
}
async function prsWhere(api, org, projects, criteria) {
  const lists = await Promise.all(projects.map(p => optional(api(`https://dev.azure.com/${enc(org)}/${enc(p)}/_apis/git/pullrequests?searchCriteria.status=active&${criteria}&$top=100&${V}`).then(r => r.value ?? []))));
  return lists.flat();
}

async function readOrg(api, org, full, prsMode, since) {
  const conn = await api(`https://dev.azure.com/${enc(org)}/_apis/connectionData`);
  const meId = conn.authenticatedUser?.id, me = conn.authenticatedUser?.providerDisplayName ?? null;
  const notClosed = `[System.State] NOT IN (${CLOSED.map(s => `'${s}'`).join(', ')})`;
  const projects = await projectsOf(api, org);
  if (prsMode) {
    const mine = await prsWhere(api, org, projects, `searchCriteria.creatorId=${enc(meId)}`);
    const prs = [], details = {};
    for (const p of mine) {
      const ref = prRefOf(org, p);
      const base = `https://dev.azure.com/${enc(org)}/${enc(ref.project)}/_apis/git/repositories/${enc(p.repository?.id ?? '')}/pullRequests/${p.pullRequestId}`;
      const ids = (await optional(api(`${base}/workitems?${V}`).then(r => r.value ?? []))).map(w => Number(w.id)).filter(Number.isFinite).slice(0, 20);
      const wis = ids.length ? await optional(wiql(api, org, `[System.Id] IN (${ids.join(', ')})`)) : [];
      const pr = { ...ref, target: String(p.targetRefName ?? '').replace(/^refs\/heads\//, ''), source: String(p.sourceRefName ?? '').replace(/^refs\/heads\//, ''), draft: p.isDraft === true, autoComplete: !!p.autoCompleteSetBy,
        reviewers: (p.reviewers ?? []).map(r => ({ name: r.displayName ?? '', vote: r.vote ?? 0, label: VOTES[r.vote ?? 0] ?? '', required: r.isRequired === true })).filter(r => r.name),
        build: null, workItems: wis.map(w => itemOf(org, w)) };
      if (full) {
        const threads = (await optional(api(`${base}/threads?${V}`).then(r => r.value ?? []))).filter(t => !t.isDeleted && (t.comments ?? []).some(c => c.commentType !== 'system'));
        pr.activeThreads = threads.filter(t => t.status === 'active').length;
        const last = threads.flatMap(t => (t.comments ?? []).filter(c => c.commentType !== 'system' && !c.isDeleted).map(c => ({ t, c })))
          .sort((a, b) => Date.parse(b.c.publishedDate) - Date.parse(a.c.publishedDate))[0];
        if (last) pr.lastComment = { who: name(last.c.author) ?? '', mine: whoId(last.c.author) === meId, at: last.c.publishedDate, text: plain(last.c.content), url: `${ref.url}?discussionId=${last.t.id}` };
        Object.assign(details, await detailsFor(api, org, wis, meId));
      }
      prs.push(pr);
    }
    return { me, prs, details };
  }
  const assignedRaw = await wiql(api, org, `[System.AssignedTo] = @Me AND ${notClosed}`);
  const changedAfter = w => Date.parse(w.fields?.['System.ChangedDate']) >= since && whoId(w.fields?.['System.ChangedBy']) !== meId;
  const mentions = await optional(wiql(api, org, '[System.Id] IN (@RecentMentions)'));
  const follows = await optional(wiql(api, org, `[System.Id] IN (@Follows) AND ${notClosed}`));
  const reviewing = await prsWhere(api, org, projects, `searchCriteria.reviewerId=${enc(meId)}`);
  const { news: reviewNews, oldReviews } = splitReviews(org, reviewing, meId, since);
  const news = [...mentions.filter(changedAfter).map(w => changeNews('mention', org, w)), ...assignedRaw.filter(changedAfter).map(w => changeNews('touched', org, w)),
    ...follows.filter(changedAfter).map(w => changeNews('followed', org, w)), ...reviewNews];
  const assigned = assignedRaw.map(w => itemOf(org, w));
  return { me, news, assigned, urgent: assigned.filter(i => i.priority === 1), oldReviews, details: full ? await detailsFor(api, org, assignedRaw, meId) : {} };
}

async function main(argv) {
  const brainJson = (() => { try { return fs.readFileSync(path.join(process.cwd(), 'brain.json'), 'utf8'); } catch { return null; } })();
  const api = client(await azToken());
  const orgs = configuredOrgs(argv, process.env, brainJson);
  if (!orgs.length) orgs.push(...await discoverOrgs(api));
  if (!orgs.length) throw new Error("Nessuna organizzazione Azure DevOps per questo account: indica DEVOPS_ORG in brain.json o SB_DEVOPS_ORG");
  const full = argv.includes('--full'), prsMode = argv.includes('--prs'), n = days(argv), since = Date.now() - n * 864e5;
  const out = { at: new Date().toISOString(), me: null, ...(prsMode ? { prs: [], details: {} } : { days: n, news: [], assigned: [], urgent: [], oldReviews: [], details: {} }) };
  let ok = 0, lastErr = null;
  for (const org of orgs) {
    try {
      const r = await readOrg(api, org, full, prsMode, since);
      ok++; out.me ??= r.me;
      for (const k of ['news', 'assigned', 'urgent', 'oldReviews', 'prs']) if (r[k]) out[k].push(...r[k]);
      Object.assign(out.details, r.details);
    } catch (e) {
      if (e instanceof LoginError) throw e;
      lastErr = e; process.stderr.write(`${org}: ${e.message}\n`);
    }
  }
  if (!ok) throw lastErr ?? new Error('lettura non riuscita');
  if (argv.includes('--json')) console.log(JSON.stringify(out));
  else if (prsMode) for (const p of out.prs) console.log(`PR ${p.id} ${p.title} (${p.repo}) ${p.url}`);
  else { for (const x of out.news) console.log(`${x.kind}: ${x.title} ${x.url}`); for (const i of out.assigned) console.log(`${i.id} [${i.state}] ${i.title}`); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(e => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(e instanceof LoginError ? 2 : 1);
  });
}
