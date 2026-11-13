// The routine runtime's tiny read-only DevOps stdio MCP server (ADR 0175, owner decision 2026-10-27): a step may read
// work items, their comments and attachments through the runtime's OWN DevOps adapter (devops.ts, az or the package
// PAT), never through a third-party MCP. No write tool: every DevOps write stays runtime-side, from step-result.json
// through the ledger. Reads are limited to the package's organization and projects. With deploy targets it also reads
// the run's PR build, the test environment and the run's test deployment (status only). Config: the 0600 temp file
// named by SB_ROUTINE_DEVOPS_CONFIG (it may hold the PAT, so it never lives in the run folder); the server deletes it
// once read, so the session never finds it on disk.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createDevOpsClient, type DevOpsClient } from './devops';
import { azureCliTokenProvider, patTokenProvider } from './token';
import { createMasker } from './mask';
import { replyText } from './escalation';
import type { TestDeployTarget } from '../../../src/shared/flow-automation';
import { prBuildStatus } from './devops-host/pr-build-status';
import { testEnvironmentSnapshot } from './devops-host/test-environment';
import { ledgerResources } from './devops-ops';
import type { LedgerEntry } from './run-store';
import { readConfigOnce } from './fs-util';

export const DEVOPS_SERVER_NAME = 'routine-devops';
export interface DevOpsServerConfig {
  organization: string; projects: string[]; pat?: string; evidence: string;
  /** the package's test targets, the run's ledger (its PR) and the deployment state file: the status reads */
  deployTargets?: TestDeployTarget[]; ledgerFile?: string; deployStateFile?: string; runId?: string;
}

type Json = Record<string, unknown>;
const ID = { type: 'number', description: 'work item id' };
const TOOLS = [
  { name: 'get_work_item', description: 'Read one work item (title, state, type, description, repro steps, tags, links to attachments).', inputSchema: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: ID } } },
  { name: 'get_work_item_comments', description: 'Read the comments of one work item, newest first, as plain text.', inputSchema: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: ID } } },
  { name: 'get_attachment', description: 'Download one attachment of a work item into this step\'s evidence folder; returns the saved file path.', inputSchema: { type: 'object', additionalProperties: false, required: ['id', 'url'], properties: { id: ID, url: { type: 'string', description: 'the attachment URL from get_work_item' } } } },
];
const TARGET = { type: 'string', description: 'the deploy target id' };
const STATUS_TOOLS = [
  { name: 'pr_build_status', description: 'Read the build validation of this run\'s PR on a deploy target (queued, running, succeeded, failed).', inputSchema: { type: 'object', additionalProperties: false, required: ['targetId'], properties: { targetId: TARGET } } },
  { name: 'test_environment_status', description: 'Read what the test environment of a deploy target runs now and whether another deployment is in progress.', inputSchema: { type: 'object', additionalProperties: false, required: ['targetId'], properties: { targetId: TARGET } } },
  { name: 'test_deploy_status', description: 'Read this run\'s test deployment on a deploy target as the runtime recorded it.', inputSchema: { type: 'object', additionalProperties: false, required: ['targetId'], properties: { targetId: TARGET } } },
];
const MAX_TEXT = 20_000, MAX_ATTACHMENT = 20 * 1024 * 1024;
const clip = (s: string) => s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : s;

export interface DevOpsServerIo { client: DevOpsClient; download(url: string): Promise<Buffer> }

/** Handles one JSON-RPC message; null = a notification. Exported for the unit tests. */
export async function handleDevOpsMessage(message: Json, config: DevOpsServerConfig, io: DevOpsServerIo): Promise<Json | null> {
  const id = message.id;
  if (id === undefined || id === null) return null;
  const reply = (result: unknown): Json => ({ jsonrpc: '2.0', id, result });
  const masker = createMasker(config.pat ? [config.pat] : []);
  const text = (t: string, isError = false) => reply({ content: [{ type: 'text', text: masker.mask(t) }], ...(isError ? { isError: true } : {}) });
  switch (message.method) {
    case 'initialize': {
      const asked = (message.params as Json | undefined)?.protocolVersion;
      return reply({ protocolVersion: typeof asked === 'string' ? asked : '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: DEVOPS_SERVER_NAME, version: '1' } });
    }
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: config.deployTargets?.length ? [...TOOLS, ...STATUS_TOOLS] : TOOLS });
    case 'tools/call': {
      const params = (message.params ?? {}) as Json, args = (params.arguments ?? {}) as Json;
      if (STATUS_TOOLS.some(t => t.name === params.name)) {
        const target = config.deployTargets?.find(t => t.id === args.targetId);
        if (!target) return text('targetId: not one of this routine\'s deploy targets', true);
        try { return text(clip(await statusRead(String(params.name), target, config, io))); }
        catch (e) { return text(`DevOps read failed: ${e instanceof Error ? e.message : String(e)}`, true); }
      }
      const wid = args.id;
      if (typeof wid !== 'number' || !Number.isSafeInteger(wid) || wid <= 0) return text('id: a positive work item id', true);
      try {
        const item = await io.client.item(config.organization, wid);
        if (!config.projects.some(p => p.toLowerCase() === item.project.toLowerCase())) return text(`Work item ${wid} is outside this routine's projects.`, true);
        if (params.name === 'get_work_item') {
          const f = item.fields, s = (k: string) => typeof f[k] === 'string' ? f[k] as string : '';
          const relations = ((await io.client.relations(config.organization, wid)) ?? []).filter(r => r.rel === 'AttachedFile');
          return text(clip(JSON.stringify({
            id: wid, rev: item.rev, project: item.project, type: s('System.WorkItemType'), state: s('System.State'), title: s('System.Title'),
            tags: s('System.Tags'), assignedTo: (f['System.AssignedTo'] as Json | undefined)?.displayName ?? '',
            description: replyText(s('System.Description')), reproSteps: replyText(s('Microsoft.VSTS.TCM.ReproSteps')),
            acceptanceCriteria: replyText(s('Microsoft.VSTS.Common.AcceptanceCriteria')),
            attachments: relations.map(r => ({ url: r.url, name: r.name })),
          }, null, 2)));
        }
        if (params.name === 'get_work_item_comments') {
          const comments = await io.client.comments(config.organization, item.project, wid);
          return text(clip(JSON.stringify(comments.map(c => ({ id: c.id, author: c.authorName ?? c.authorId, at: new Date(c.createdAt).toISOString(), text: replyText(c.text) })), null, 2)));
        }
        if (params.name === 'get_attachment') {
          const url = String(args.url ?? '');
          const allowed = ((await io.client.relations(config.organization, wid)) ?? []).find(r => r.rel === 'AttachedFile' && r.url === url);
          if (!allowed) return text('Not an attachment of this work item.', true);
          const data = await io.download(url);
          if (data.length > MAX_ATTACHMENT) return text('Attachment larger than 20 MB: not downloaded.', true);
          const name = (allowed.name ?? 'attachment').replace(/[^\w.-]+/g, '_').slice(0, 100) || 'attachment';
          fs.mkdirSync(config.evidence, { recursive: true });
          const file = path.join(config.evidence, `wi${wid}-${name}`);
          fs.writeFileSync(file, data, { mode: 0o600 });
          return text(`Saved ${file} (${data.length} bytes).`);
        }
        return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool' } };
      } catch (e) {
        return text(`DevOps read failed: ${e instanceof Error ? e.message : String(e)}`, true);
      }
    }
    default: return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
  }
}

const readJson = <T>(file: string | undefined): T | undefined => { if (!file) return undefined; try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return undefined; } };

/** The three status reads: GET only, never the coordinator (which writes its state file). */
async function statusRead(tool: string, target: TestDeployTarget, config: DevOpsServerConfig, io: DevOpsServerIo): Promise<string> {
  const ledger = readJson<Record<string, LedgerEntry>>(config.ledgerFile) ?? {};
  const own = readJson<{ deployments?: { runId: string; target: { id: string }; buildId: number; state: string; releaseId?: number; released?: boolean }[] }>(config.deployStateFile)?.deployments
    ?.filter(d => d.runId === config.runId && d.target.id === target.id) ?? [];
  if (tool === 'test_environment_status') return await testEnvironmentSnapshot(target, (m, u) => io.client.call(m, u), own.flatMap(d => d.releaseId ? [d.releaseId] : []));
  if (tool === 'test_deploy_status') {
    const recorded = Object.entries(ledger).filter(([k]) => k.startsWith(`deploy:${target.id}:`)).map(([, e]) => ({ state: e.state, ...e.resource }));
    return JSON.stringify({ target: target.id, ledger: recorded, deployments: own.map(d => ({ buildId: d.buildId, state: d.state, ...(d.releaseId ? { releaseId: d.releaseId } : {}), released: Boolean(d.released) })) }, null, 2);
  }
  const pr = ledgerResources(ledger).pr;
  if (!pr) return 'This run has no PR yet.';
  const live = await io.client.call('GET', `https://dev.azure.com/${encodeURIComponent(config.organization)}/${encodeURIComponent(pr.project)}/_apis/git/repositories/${pr.repositoryId}/pullrequests/${pr.id}?api-version=7.1`);
  const commit = (live.lastMergeCommit as Json | undefined)?.commitId;
  if (typeof commit !== 'string') return JSON.stringify({ pullRequestId: pr.id, status: 'no-merge-commit', mergeStatus: live.mergeStatus ?? null });
  return JSON.stringify(await prBuildStatus(target, { commit, pullRequestId: pr.id }, (m, u) => io.client.call(m, u), async () => {}), null, 2);
}

export async function serveDevOps(config: DevOpsServerConfig, io: DevOpsServerIo, input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): Promise<void> {
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let message: Json;
    try { message = JSON.parse(line) as Json; } catch { output.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`); continue; }
    const reply = await handleDevOpsMessage(message, config, io);
    if (reply) output.write(`${JSON.stringify(reply)}\n`);
  }
}

export async function devopsMain(): Promise<void> {
  const file = process.env.SB_ROUTINE_DEVOPS_CONFIG;
  if (!file) { process.stderr.write('SB_ROUTINE_DEVOPS_CONFIG is not set\n'); process.exit(2); }
  const config = readConfigOnce<DevOpsServerConfig>(file);
  const authorization = config.pat ? patTokenProvider(config.pat) : azureCliTokenProvider();
  const client = createDevOpsClient({ authorization });
  await serveDevOps(config, { client, download: url => client.download(url) });
}
