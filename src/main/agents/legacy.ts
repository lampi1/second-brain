/** Converts bounded legacy routing data into editable catalog profiles; main owns persistence and availability. */
import { createHash } from 'node:crypto';
import { TASK_KINDS, type Effort, type RoutingRow } from '../../shared/contract';
import { AGENT_SYMBOLS, type AgentProfileV1 as AgentProfile } from '../../shared/agents';

// Keep the same model syntax accepted by the catalog, without resolving aliases or providers.
const MODEL = /^[\w.:@/[\]][\w.:@/=[\],-]{0,119}$/;
const ENGINE = /^[a-z][a-z0-9_-]{0,59}$/;
const EFFORTS: readonly unknown[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const LABELS: Record<RoutingRow['kind'], string> = {
  '*': 'Assistente', 'qa-run': 'Verifica', review: 'Revisione', 'bug-fix': 'Correzione bug',
  'ops-read': 'Lettura operativa', writing: 'Scrittura', triage: 'Triage', 'research-web': 'Ricerca web',
  investigation: 'Indagine', 'app-feature': 'Sviluppo', regia: 'Orchestrator', altro: 'Altre attività',
};

/** Null means malformed; sorted labels make equivalent area sets share a stable identity. */
function areas(value: unknown): string[] | null {
  if (value === undefined) return [];
  const values = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(values) || values.length === 0 || values.length > 16) return null;
  const normalized: string[] = [];
  for (const item of values) {
    if (typeof item !== 'string' || item.length > 120 || !item.trim() || /[\u0000-\u001f\u007f]/.test(item)) return null;
    normalized.push(item.trim());
  }
  return [...new Set(normalized)].sort();
}

/** Does not mutate routing, invent instructions, or choose an available replacement engine/model. */
export function legacyAgentProfiles(rows: readonly RoutingRow[], now: number, options: { apiEngine?: string | null } = {}): { profiles: AgentProfile[]; skipped: number } {
  if (!Array.isArray(rows)) return { profiles: [], skipped: 1 };
  if (!Number.isFinite(now)) throw new Error('Data di importazione non valida.');
  const profiles: AgentProfile[] = [];
  const seen = new Set<string>();
  let skipped = Math.max(0, rows.length - 1000);
  for (let i = 0; i < Math.min(rows.length, 1000); i++) {
    const value: unknown = rows[i];
    if (!value || typeof value !== 'object' || Array.isArray(value)) { skipped++; continue; }
    const row = value as Record<string, unknown>;
    const area = areas(row.area);
    if (typeof row.harness !== 'string' || !ENGINE.test(row.harness)
      || typeof row.model !== 'string' || !MODEL.test(row.model)
      || !(row.effort === null || EFFORTS.includes(row.effort))
      || !(row.onApi === undefined || typeof row.onApi === 'boolean')
      || !(row.kind === '*' || (TASK_KINDS as readonly unknown[]).includes(row.kind)) || area === null) {
      skipped++; continue;
    }
    // onApi explicitly chose API billing; missing API configuration must never turn it into a CLI chat.
    const engine = row.onApi === true ? options.apiEngine : row.harness;
    if (typeof engine !== 'string' || !ENGINE.test(engine)) { skipped++; continue; }
    const kind = row.kind as RoutingRow['kind'];
    const key = JSON.stringify([engine, row.model, row.effort, kind, area, row.onApi === true]);
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);
    const label = LABELS[kind];
    const scope = area.length ? ` · ${area.join(', ')}` : '';
    profiles.push({
      id: `legacy-${createHash('sha256').update(key).digest('hex').slice(0, 32)}`,
      name: `${label}${scope}`.slice(0, 80),
      purpose: `Importazione legacy: ${label}${scope}. Configurazione del motore e del modello conservata.`.slice(0, 400),
      instructions: '', engine, model: row.model,
      ...(row.effort === null ? {} : { effort: row.effort as Effort }),
      avatar: { kind: 'symbol', value: AGENT_SYMBOLS[0] }, createdAt: now, updatedAt: now,
    });
  }
  return { profiles, skipped };
}
