// Per-launch product hook assets. Missing runtime is fatal for brains explicitly migrated to product rules.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { read } from './storage';
import type { LaunchFacts } from './types';

export function enabled(root: string): boolean {
  const text = read(root, 'brain.json');
  return !!text && (JSON.parse(text) as { machinery?: string }).machinery === 'product-v1';
}
let pinned: string | null = null;
/** Tests pin a fixture runtime folder; the app resolves the built one next to its bundle. */
export function useAssets(dir: string | null): void { pinned = dir; }
export function assets(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = pinned ? [pinned] : [path.resolve(here, '../rules'), path.resolve(here, '../../../out/rules')];
  const found = candidates.find(p => fs.existsSync(path.join(p, 'runtime.mjs')));
  if (!found) throw new Error('Product rules runtime is missing; build/install this release before launching a migrated brain.');
  return found;
}
export function productSignature(root: string): string {
  if (!enabled(root)) return '';
  const source = assets();
  return createHash('sha256').update(fs.realpathSync(root)).update(read(root, 'brain.json'))
    .update(fs.readFileSync(path.join(source, 'runtime.mjs'))).update(fs.readFileSync(path.join(source, 'cli.mjs')))
    .update(fs.readFileSync(path.join(source, 'hooks/runner.mjs'))).update(fs.readFileSync(path.join(source, 'hooks/cli.mjs'))).digest('hex');
}
/** The events the runner serves from hooks.json. The app's own Claude chats answer the others in process (ClaudeSession
 *  productHooks, hook_callback): two node processes per tool call were 0.2-2 s each on Windows (ADR 0103). Stop stays a
 *  process: its local brain commit runs synchronous git, which must never block the app's main process. */
export const ALL_EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'] as const;
export const IN_PROCESS_EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse'] as const;
export function installHooks(plugin: string, root: string, state: string, source?: string, launch: LaunchFacts = {}, events: readonly string[] = ALL_EVENTS): void {
  if (!enabled(root)) return;
  const target = path.join(plugin, 'product-rules');
  fs.cpSync(source ?? assets(), target, { recursive: true });
  fs.writeFileSync(path.join(target, 'launch.json'), JSON.stringify({ root, state, ...launch }));
  const hookFile = path.join(plugin, 'hooks/hooks.json');
  const previous = fs.existsSync(hookFile) ? JSON.parse(fs.readFileSync(hookFile, 'utf8')) as { hooks?: Record<string, unknown[]> } : {};
  const hooks = previous.hooks ?? {};
  for (const event of events) {
    const product = { ...(event.endsWith('ToolUse') ? { matcher: '*' } : {}), hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/product-rules/hooks/runner.mjs"', timeout: 10 }] };
    hooks[event] = [product, ...(hooks[event] ?? [])];
  }
  fs.mkdirSync(path.dirname(hookFile), { recursive: true });
  fs.writeFileSync(hookFile, JSON.stringify({ ...previous, hooks }));
}
