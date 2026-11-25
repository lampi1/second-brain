// Does a model run on an engine? One rule for every launch, the same the role card's save uses (ADR 0356, problem 3 of
// 2026-11-25: the card saved claude-opus-5-5 on Cursor from Cursor's own live list, then app_create_chat refused it
// because the brain's models.json row says harness claude; the app's own engine move ran it fine on Cursor). The engine's
// live list decides first (ADR 0256: models.json is never an allow-list). Pure; used by brain/routing.ts; tests in
// test/unit/shared/model-fit.test.ts.

const bare = (m: string): string => m.toLowerCase().trim().replace(/\[.*\]$/, '');
const looksClaude = (m: string): boolean => /\b(claude|opus|sonnet|haiku|fable|mythos)\b/i.test(m.replace(/[-_.]/g, ' '));

/** Why `model` cannot start on `engine`, or null when it can. `known` = the engine's live list (ids; null or [] = it has
 *  listed nothing yet); `registryHarness` = the engine the brain's registry row names for the model, if any; `alias` =
 *  the model's other ids (a registry alias such as «opus», resolved id first). A model on the live list runs there; one
 *  off it is still taken (an alias, an id the registry does not know: the CLI judges it) unless the registry or its name
 *  says it belongs to another engine. */
export function modelRefusal(engine: string, model: string | null | undefined, known: readonly string[] | null | undefined, registryHarness?: string | null, alias: readonly string[] = []): string | null {
  if (!model) return null;
  const ids = new Set((known ?? []).map(bare));
  if (ids.has(bare(model)) || alias.some(a => ids.has(bare(a)))) return null;
  if (registryHarness && registryHarness !== engine) return `${model} gira solo su ${registryHarness}, non su ${engine} (non è nel suo elenco dei modelli)`;
  if (!registryHarness && engine !== 'claude' && looksClaude(model)) return 'un modello Claude gira solo sull’harness claude, se il motore non lo elenca tra i suoi';
  return null;
}
