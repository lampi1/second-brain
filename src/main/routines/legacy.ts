// On-demand, read-only archive of the retired app executor (ADR 0179). No constructor I/O, recovery, writes,
// timers or notifications: old pending settlements remain evidence, never work. Used by the Routine archive and
// explicit package conversion. Files stay byte-for-byte intact, including unknown DevOps outcomes.
import fs from 'node:fs';
import path from 'node:path';
import type { FlowSnapshot } from '../../shared/flows';
import type { FlowAutomationSnapshot } from '../../shared/flow-automation';
import { flowBrainContextKey } from '../flows/context';

export function createLegacyArchive(options: { userData: string; brainRoot(): string | null }) {
  const empty = (contextKey: string): FlowSnapshot => ({ contextKey, drafts: [], versions: [], active: {}, runs: [] });
  function location(): { key: string; dir: string } | null {
    const root = options.brainRoot();
    if (!root) return null;
    const key = flowBrainContextKey(fs.realpathSync(path.resolve(root)));
    return { key, dir: path.join(options.userData, 'flows', key) };
  }
  const read = (file: string): unknown => {
    if (!fs.existsSync(file)) return null;
    if (fs.statSync(file).size > 20 * 1024 * 1024) throw new Error('Archive exceeds 20 MiB');
    return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  };
  return {
    snapshot(): FlowSnapshot {
      try {
        const context = location(); if (!context) return empty('unavailable');
        const value = read(path.join(context.dir, 'state.json')) as Partial<FlowSnapshot> | null;
        if (!value) return empty(context.key);
        if (!Array.isArray(value.runs) || !Array.isArray(value.versions)) throw new Error('Invalid legacy archive');
        return { ...empty(context.key), runs: value.runs, versions: value.versions, active: value.active ?? {} };
      } catch { return { ...empty('unavailable'), storageError: 'Archivio routine non leggibile. I file originali sono conservati.' }; }
    },
    definitions() {
      const snapshot = this.snapshot();
      let context: ReturnType<typeof location> = null;
      try { context = location(); } catch { /* missing brain: an empty archive is still readable */ }
      let automation: Partial<FlowAutomationSnapshot> | null = null;
      try { if (context) automation = read(path.join(context.dir, 'automation.json')) as Partial<FlowAutomationSnapshot> | null; } catch { /* definition still exportable without the old rule */ }
      return snapshot.versions.filter(v => snapshot.active[v.definition.id] === v.version).map(v => {
        const rule = automation?.rules?.find(r => r.config.flowId === v.definition.id && r.approvedRevision === r.revision && ['enabled', 'paused'].includes(r.status));
        return { flowId: v.definition.id, title: v.definition.title, definition: v.definition,
          ...(rule ? { automation: { trigger: rule.config.trigger, ...(rule.config.devopsWrite ? { devopsWrite: rule.config.devopsWrite } : {}) } } : {}) };
      });
    },
  };
}
export type LegacyArchive = ReturnType<typeof createLegacyArchive>;
