// Launch context for migrated brains. Fixed content is checked as a whole; unsupported engines get bounded topic text.
import { configOf, read } from './storage';
import { expandTools, topics } from './topics';
import { enabled } from './delivery';
import { fixedSize } from './guards';

export function productInstructions(root: string, fallback: boolean, tools?: string): string | null {
  if (!enabled(root)) return null;
  const config = configOf(root);
  const fixed = [...new Set(config.fixedFiles)].map(file => expandTools(read(root, file), tools)).filter(Boolean).join('\n\n');
  if (fixedSize({ root, state: '', config }) > config.fixedBudget) throw new Error(`Fixed brain context exceeds ${config.fixedBudget} characters; shorten it before launching.`);
  if (!fallback) return fixed;
  let remaining = config.turnBudget;
  const injected: string[] = [];
  for (const topic of topics({ root, state: '', config, ...(tools ? { tools } : {}) })) {
    const prefix = `\nTopic ${topic.file}:\n`, suffix = `\n[Read the rest: ${topic.file}]\n`;
    if (remaining < prefix.length + suffix.length + 80) break;
    const full = prefix + topic.body;
    const text = full.length <= remaining ? full : prefix + topic.body.split(/\n## /)[0]!.slice(0, remaining - prefix.length - suffix.length) + suffix;
    injected.push(text); remaining -= text.length;
  }
  return [fixed, 'This engine receives topic text at launch. Product pre-tool hooks are not available in this adapter.', ...injected].join('\n\n');
}
