// Additional run-owned DevOps resources. The writer supplies an authorized HTTP port and a durable ownership ledger;
// this module never accepts credentials, arbitrary endpoints, foreign PR writes or agent-supplied image URLs.
import type { DevOpsWriteGrant } from '../../shared/flow-automation';
import { integer, keys, object, text } from './schema';
import { organizationUrl, readEvidenceImage, renderDevOpsComment, type UploadedImage } from './devops-content';

export interface OwnedPullRequest { project: string; projectId: string; repositoryId: string; id: number; source: string; target: string }
export interface ResourceLedger { pushes?: { repositoryId: string; project: string; branch: string; commit: string }[]; images?: UploadedImage[]; prs?: OwnedPullRequest[] }
export interface ResourcePorts {
  grant: DevOpsWriteGrant; workItemId: number; evidenceRoot?: string; mine: ResourceLedger;
  call(method: string, url: string, body?: unknown, contentType?: string): Promise<Record<string, unknown>>;
  workItem(): Promise<{ project: string; rev: number; tags: string[] }>;
  patchItem(patch: unknown[]): Promise<Record<string, unknown>>;
  record(change: (entry: ResourceLedger) => void): void;
}
const API = 'api-version=7.1';
const guid = (v: unknown): string => { const s = text(v, 'GUID', 36).toLowerCase(); if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(s)) throw new Error('Expected GUID'); return s; };
const id = (v: unknown): number => integer(v, 'id', 1, 2_147_483_647);
const branch = (v: unknown): string => { const s = text(v, 'branch', 250); if (!/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9/_-]*$/.test(s) || s.includes('//')) throw new Error('Use a full refs/heads branch'); return s; };
export async function devopsResource(raw: Record<string, unknown>, p: ResourcePorts): Promise<Record<string, unknown> | undefined> {
  const org = `https://dev.azure.com/${encodeURIComponent(p.grant.organization)}`, op = raw.op;
  const ownPr = async () => {
    const prId = id(raw.pullRequestId), mine = p.mine.prs?.find(pr => pr.id === prId);
    if (!mine) throw new Error('Only a PR created by this run can be changed');
    const url = `${org}/${encodeURIComponent(mine.project)}/_apis/git/repositories/${mine.repositoryId}/pullrequests/${prId}`;
    const live = await p.call('GET', `${url}?${API}`), repository = object(live.repository, 'PR repository'), project = object(repository.project, 'PR project');
    if (live.pullRequestId !== mine.id || String(repository.id).toLowerCase() !== mine.repositoryId || String(project.id).toLowerCase() !== mine.projectId || live.sourceRefName !== mine.source || live.targetRefName !== mine.target || !['active', 'abandoned'].includes(String(live.status))) throw new Error('The run PR identity or active status changed');
    if (!p.grant.projects.some(name => name.toLowerCase() === String(project.name).toLowerCase())) throw new Error('PR project is outside the grant');
    return { mine, live, url };
  };
  switch (op) {
    case 'upload-image': {
      keys(raw, ['op', 'filename'], 'request');
      if (!p.evidenceRoot) throw new Error('This run has no evidence folder');
      const file = readEvidenceImage(p.evidenceRoot, text(raw.filename, 'filename', 140));
      const existing = p.mine.images?.find(i => i.sha256 === file.sha256); if (existing) return { attachmentId: existing.id, reference: `attachment:${existing.id}`, url: existing.url };
      if ((p.mine.images?.length ?? 0) >= 50) throw new Error('Run attachment limit reached');
      const item = await p.workItem();
      const result = await p.call('POST', `${org}/${encodeURIComponent(item.project)}/_apis/wit/attachments?fileName=${encodeURIComponent(file.name)}&uploadType=Simple&${API}`, file.data, 'application/octet-stream');
      const imageId = guid(result.id), url = organizationUrl(text(result.url, 'attachment URL', 2000), p.grant.organization);
      const parsed = new URL(url);
      if (!new RegExp(`/_apis/wit/attachments/${imageId}$`, 'i').test(parsed.pathname) || parsed.search || parsed.hash) throw new Error('Unexpected attachment URL');
      p.record(entry => { (entry.images ??= []).push({ id: imageId, url, sha256: file.sha256, name: file.name }); });
      await p.patchItem([{ op: 'test', path: '/rev', value: item.rev }, { op: 'add', path: '/relations/-', value: { rel: 'AttachedFile', url, attributes: { comment: 'Routine evidence' } } }]);
      return { attachmentId: imageId, reference: `attachment:${imageId}`, url };
    }
    case 'relate-work-item': {
      keys(raw, ['op', 'relatedWorkItemId'], 'request');
      const relatedId = id(raw.relatedWorkItemId); if (relatedId === p.workItemId) throw new Error('Cannot relate a work item to itself');
      const related = await p.call('GET', `${org}/_apis/wit/workitems/${relatedId}?fields=System.TeamProject&${API}`);
      if (related.id !== relatedId || !p.grant.projects.some(name => name.toLowerCase() === String(object(related.fields, 'related fields')['System.TeamProject']).toLowerCase())) throw new Error('Related item is outside the approved projects');
      const item = await p.workItem();
      await p.patchItem([{ op: 'test', path: '/rev', value: item.rev }, { op: 'add', path: '/relations/-', value: { rel: 'System.LinkTypes.Related', url: `${org}/_apis/wit/workItems/${relatedId}` } }]);
      return { workItemId: p.workItemId, relatedWorkItemId: relatedId };
    }
    case 'relate-pr': {
      keys(raw, ['op', 'projectId', 'repositoryId', 'pullRequestId'], 'request');
      const projectId = guid(raw.projectId), repositoryId = guid(raw.repositoryId), pullRequestId = id(raw.pullRequestId);
      const linked = await p.call('GET', `${org}/${projectId}/_apis/git/repositories/${repositoryId}/pullrequests/${pullRequestId}?${API}`);
      const repo = object(linked.repository, 'linked repository'), project = object(repo.project, 'linked project');
      if (linked.pullRequestId !== pullRequestId || String(repo.id).toLowerCase() !== repositoryId || String(project.id).toLowerCase() !== projectId || !p.grant.projects.some(name => name.toLowerCase() === String(project.name).toLowerCase())) throw new Error('Introducing PR is outside the approved projects');
      const item = await p.workItem();
      await p.patchItem([{ op: 'test', path: '/rev', value: item.rev }, { op: 'add', path: '/relations/-', value: { rel: 'ArtifactLink', url: `vstfs:///Git/PullRequestId/${projectId}%2F${repositoryId}%2F${pullRequestId}`, attributes: { name: 'Pull Request', comment: 'Introducing PR identified by the routine' } } }]);
      return { workItemId: p.workItemId, introducingPullRequestId: pullRequestId };
    }
    case 'create-pr': {
      keys(raw, ['op', 'project', 'repositoryId', 'sourceRef', 'targetRef', 'title', 'text'], 'request');
      if (p.mine.prs?.length) throw new Error('This run already created a PR');
      const project = text(raw.project, 'project', 128), repositoryId = guid(raw.repositoryId);
      if (!p.grant.projects.some(name => name.toLowerCase() === project.toLowerCase())) throw new Error('PR project is outside the grant');
      const source = branch(raw.sourceRef), target = branch(raw.targetRef); if (source === target) throw new Error('PR source and target must differ');
      if (p.grant.ops.includes('git-push') && !p.mine.pushes?.some(push => push.repositoryId === repositoryId && push.project.toLowerCase() === project.toLowerCase() && push.branch === source)) throw new Error('PR source must be the branch published by this run through host git-push');
      const repository = await p.call('GET', `${org}/${encodeURIComponent(project)}/_apis/git/repositories/${repositoryId}?${API}`), projectInfo = object(repository.project, 'repository project');
      if (String(repository.id).toLowerCase() !== repositoryId || String(projectInfo.name).toLowerCase() !== project.toLowerCase()) throw new Error('Repository identity changed');
      const projectId = guid(projectInfo.id), title = text(raw.title, 'title', 300);
      const description = renderDevOpsComment(text(raw.text, 'text', 10_000), p.grant.organization, p.mine.images ?? [], 'markdown');
      if (/!?\[[^\]]+\]\(/.test(String(raw.text)) && !p.grant.ops.includes('rich-comments')) throw new Error('Formatted PR content needs rich-comments');
      await p.workItem();
      const created = await p.call('POST', `${org}/${encodeURIComponent(project)}/_apis/git/repositories/${repositoryId}/pullrequests?${API}`, { sourceRefName: source, targetRefName: target, title, description, isDraft: true });
      const prId = id(created.pullRequestId);
      p.record(entry => { (entry.prs ??= []).push({ project, projectId, repositoryId, id: prId, source, target }); });
      const item = await p.workItem();
      await p.patchItem([{ op: 'test', path: '/rev', value: item.rev }, { op: 'add', path: '/relations/-', value: { rel: 'ArtifactLink', url: `vstfs:///Git/PullRequestId/${projectId}%2F${repositoryId}%2F${prId}`, attributes: { name: 'Pull Request' } } }]);
      return { pullRequestId: prId, isDraft: true, url: `${org}/${encodeURIComponent(project)}/_git/${repositoryId}/pullrequest/${prId}` };
    }
    case 'pr-comment': {
      keys(raw, ['op', 'pullRequestId', 'text', 'mentions'], 'request');
      const body = text(raw.text, 'text', 10_000);
      // PR mentions: only approved grant identities, rendered by the host as Azure DevOps @<id> tokens (notified by DevOps).
      if (raw.mentions !== undefined && (!Array.isArray(raw.mentions) || raw.mentions.length > 10)) throw new Error('mentions: at most 10 identity ids');
      const mentions = ((raw.mentions as unknown[] | undefined) ?? []).map(v => guid(v));
      if (new Set(mentions).size !== mentions.length) throw new Error('mentions: duplicate identity');
      if (mentions.some(v => !(p.grant.mentions ?? []).includes(v))) throw new Error('Mention is not in the approved DevOps write grant');
      if (/!?\[[^\]]+\]\(/.test(body) && !p.grant.ops.includes('rich-comments')) throw new Error('Formatted PR comments need rich-comments');
      const content = (mentions.length ? `${mentions.map(v => `@<${v.toUpperCase()}>`).join(' ')}\n\n` : '') + renderDevOpsComment(body, p.grant.organization, p.mine.images ?? [], 'markdown'), pr = await ownPr();
      if (pr.live.status !== 'active') throw new Error('PR is no longer active');
      const result = await p.call('POST', `${pr.url}/threads?${API}`, { comments: [{ parentCommentId: 0, content, commentType: 1 }], status: 1 });
      return { pullRequestId: pr.mine.id, threadId: result.id };
    }
    case 'publish-pr': case 'abandon-pr': {
      keys(raw, ['op', 'pullRequestId'], 'request');
      const pr = await ownPr();
      if (pr.live.status === 'abandoned') { if (op === 'abandon-pr') return { pullRequestId: pr.mine.id, status: 'abandoned', skipped: 'Already abandoned' }; throw new Error('PR is no longer active'); }
      if (pr.live.isDraft !== true) { if (op === 'abandon-pr') return { pullRequestId: pr.mine.id, status: 'published', skipped: 'Published PR retained for human review' }; throw new Error('Only the run’s active draft PR may be published'); }
      await p.call('PATCH', `${pr.url}?${API}`, op === 'publish-pr' ? { isDraft: false } : { status: 'abandoned' });
      return { pullRequestId: pr.mine.id, status: op === 'publish-pr' ? 'published' : 'abandoned' };
    }
  }
  return undefined;
}
