// The model registry of the demo (SB_DEMO=1): the release template's own harness/models.json (brain-template), so the
// tiers, the prices and app_create_chat behave as with a fresh brain, with no files and no tokens, and no model id is
// written in the app's code (ADR 0256: the lists are live; models.json only overrides prices, tiers and labels).
// Without the template (a broken install) the demo has an empty registry: every model is then taken with its price
// unknown. Used by demo.ts; the unit tests use their own fixture (test/fixtures/model-registry.ts).
import fs from 'node:fs';
import path from 'node:path';
import type { ModelRegistry } from '../../shared/contract';
import { templateRoot } from '../rules/tools';

const EMPTY: ModelRegistry = { harnesses: {}, defaultModel: '', models: [] };
let cached: ModelRegistry | null = null;

/** The release template's registry, read once. */
export function demoRegistry(): ModelRegistry {
  if (cached) return cached;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(templateRoot(), 'harness', 'models.json'), 'utf8')) as ModelRegistry;
    cached = j && Array.isArray(j.models) ? j : EMPTY;
  } catch { cached = EMPTY; }
  return cached;
}
