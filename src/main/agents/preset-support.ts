// Pure packaged-preset resolution and fingerprinting for catalog migration; models are pinned once at install.
import { createHash } from 'node:crypto';
import type { AgentBehaviour, AgentDraft, AgentModelChoice } from '../../shared/agents';
import type { RoutingRow } from '../../shared/contract';
import type { RoleAgentPreset } from '../../shared/agent-presets';
import { behaviourOf } from './versions';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export function presetHash(value: AgentBehaviour): string {
  return createHash('sha256').update(JSON.stringify(canonical(behaviourOf(value)))).digest('hex');
}
export function presetDraft(preset: RoleAgentPreset, models: AgentModelChoice[], routes: readonly RoutingRow[], pinned?: AgentDraft): AgentDraft | null {
  const { id: _id, presetRevision: _revision, kind, ...draft } = preset;
  void _id; void _revision;
  if (pinned) return { ...draft, engine: pinned.engine, model: pinned.model, ...(pinned.effort === undefined ? { effort: undefined } : {}) };
  // Area-scoped routes cannot be applied to an area-less preset. API engines cannot implement these tool policies.
  const route = routes.find(r => !r.area && r.kind === kind) ?? routes.find(r => !r.area && r.kind === '*');
  // Same readiness as the starters: never a logged-out or missing engine, and a ready one before an unknown one.
  const supported = (e: AgentModelChoice) => e.enabled && e.trusted && e.defaultModel && e.modelSelectable && e.installed !== false && e.authenticated !== false;
  const routed = route && models.find(e => e.engine === route.harness && supported(e) && e.models.some(m => m.id === route.model));
  if (route && !routed) return null; // Never silently substitute a different engine/model for an explicit routing choice.
  const candidates = models.filter(e => supported(e) && e.models.length > 0);
  const engine = routed || candidates.find(e => e.installed === true && e.authenticated === true) || candidates[0];
  if (!engine) return null; // A guessed/default CLI model is not a fixed model. Retry installation on next load.
  return { ...draft, engine: engine.engine, model: routed && route ? route.model : engine.models[0]!.id,
    effort: engine.effort ? draft.effort : undefined };
}
