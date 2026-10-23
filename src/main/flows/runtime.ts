// Brain-scoped flow instances and live routing hints for the Orchestrator; no scheduler or command executor.
// Host report resolution uses canonical agent_report records, never arbitrary assistant text.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ChatSummary } from '../../shared/contract';
import type { FlowAgentBinding, FlowSnapshot, FlowVerifiedReport } from '../../shared/flows';
import { log } from '../log';
import { FlowService } from './service';

export interface FlowRuntimeOptions {
  userData: string; brainRoot(): string | null; chats(): readonly ChatSummary[];
  changed(snapshot: FlowSnapshot): void;
}
export function createFlowRuntime(options: FlowRuntimeOptions) {
  const instances = new Map<string, FlowService>();
  const current = () => {
    const root = options.brainRoot();
    if (!root) throw new Error('Collega il brain per definire e usare i flussi.');
    const canonical = fs.realpathSync(root);
    return { root: canonical, key: createHash('sha256').update(process.platform === 'win32' ? canonical.toLowerCase() : canonical).digest('hex') };
  };
  const scopedChat = (binding: FlowAgentBinding, root: string) => {
    const c = options.chats().find(chat => chat.id === binding.chatId);
    if (!c?.run || c.quick || c.parentId || c.isOrchestrator || c.run.runId !== binding.chatRunId || (c.run.taskVersion ?? 1) !== binding.taskVersion) return null;
    if (!c.run.scope?.brainRoot) return null;
    try { if (fs.realpathSync(c.run.scope.brainRoot) !== root) return null; } catch { return null; }
    return c;
  };
  const service = (): FlowService => {
    const context = current();
    const existing = instances.get(context.key);
    if (existing) return existing;
    const made = new FlowService({
      file: path.join(options.userData, 'flows', context.key, 'state.json'), contextKey: context.key,
      changed: snapshot => {
        try { if (options.brainRoot() && current().key === context.key) options.changed(snapshot); }
        catch (error) { log.warn('flows', 'Flow saved but notification unavailable', { cause: String(error), hint: 'Reload flows after reconnecting the brain.' }); }
      },
      resolveReport: (binding, reportId): FlowVerifiedReport | null => {
        const c = scopedChat(binding, context.root), report = c?.run?.report, canonical = report?.canonical;
        if (!c?.run || !report || report.via !== 'agent_report' || !canonical
          || reportId !== `${binding.chatRunId}:${report.at}` || canonical.runId !== binding.chatRunId
          || canonical.taskVersion !== binding.taskVersion || report.outcome !== 'done' || report.verified !== 'yes'
          || report.blocking || report.verdict === 'fail' || (!!c.run.reviewOf && report.verdict !== 'success') || canonical.outcome !== 'done') return null;
        return { ...binding, id: reportId, roleId: c.run.agentId, reviewOf: c.run.reviewOf,
          summary: report.summary, completed: canonical.doneWhen.length > 0 && canonical.doneWhen.every(item => item.met && !!item.evidence?.trim()),
          evidence: canonical.doneWhen.filter(item => item.met && item.evidence?.trim()).map(item => `${item.criterion}: ${item.evidence}`) };
      },
    });
    instances.set(context.key, made);
    return made;
  };
  const resolveBinding = (chatId: string, ownerId: string, workspace: string): FlowAgentBinding | null => {
    if (!options.chats().some(c => c.id === ownerId && c.isOrchestrator && !c.closedAt)) return null;
    const c = options.chats().find(chat => chat.id === chatId);
    if (!c?.run || c.closedAt || c.run.report || c.run.endedAt) return null;
    try {
      if (!path.isAbsolute(workspace) || !c.run.scope?.projectRoot || fs.realpathSync(workspace) !== fs.realpathSync(c.run.scope.projectRoot)) return null;
    } catch { return null; }
    const binding = { chatId, chatRunId: c.run.runId, taskVersion: c.run.taskVersion ?? 1 };
    return scopedChat(binding, current().root) ? binding : null;
  };
  const hint = (text: string, ownerId: string): string => {
    const s = service(), snapshot = s.snapshot();
    const catalog = Object.entries(snapshot.active).flatMap(([id, version]) => snapshot.versions.filter(v => v.definition.id === id && v.version === version));
    const candidates = s.match(text).candidates;
    const runs = snapshot.runs.filter(r => r.ownerOrchestratorId === ownerId && r.status !== 'completed');
    if (!catalog.length && !runs.length && !snapshot.drafts.length) return '[app flows] Catalogo vuoto. Per richieste ripetibili puoi proporre di costruire un flusso dal brain con domande Sì/No/Altro. Non inventare procedure aziendali; nessun flusso è attivo.';
    return `[app flows · context ${snapshot.contextKey}] ${JSON.stringify({ candidates: candidates.map(v => ({ id: v.definition.id, version: v.version, title: v.definition.title, scope: v.definition.scope })), activeRuns: runs.slice(0, 20).map(r => ({ id: r.id, revision: r.revision, status: r.status, step: r.steps[r.currentStep]?.stepId })), catalog: catalog.slice(0, 20).map(v => ({ id: v.definition.id, version: v.version, title: v.definition.title, aliases: v.definition.aliases })), more: catalog.length > 20 || runs.length > 20 })}. Read app_flow_list/status before acting; ambiguous matches need a question. Matching is not approval. Start/reuse flows only through authenticated Orchestrator tools; never replace required host evidence with prose.`;
  };
  return { service, resolveBinding, hint };
}
export type FlowRuntime = ReturnType<typeof createFlowRuntime>;
