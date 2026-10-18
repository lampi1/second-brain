// Small, explicit frontmatter dialect for topic rules: JSON flow mappings (valid YAML) avoid executing YAML tags.
// Hooks inject matching content once per revision and share a total allowance across all tools in one turn.
import { createHash } from 'node:crypto';
import { read } from './storage';
import type { HookInput, RuleContext } from './types';

export interface Topic { file: string; body: string; hash: string; when: { prompt: string[]; tools: string[]; paths: string[] } }
export interface TopicState { seen: Record<string, string>; used: number }
/** `{tools}` in personal text names the app-owned utilities (rules/tools.ts); left as is when the launch has none. */
export const expandTools = (text: string, tools?: string): string => tools ? text.replace(/\{tools\}/g, () => tools) : text;
export function topics(ctx: RuleContext): Topic[] {
  return ctx.config.topicFiles.flatMap(file => {
    const text = read(ctx.root, file);
    if (!text) return [];
    const match = /^---\nwhen: (\{[^\n]+\})\n---\n([\s\S]*)$/.exec(text);
    if (!match) throw new Error(`Invalid topic frontmatter: ${file}; use when: {"prompt":[],"tools":[],"paths":[]}.`);
    const when = JSON.parse(match[1]!) as Topic['when'];
    for (const key of ['prompt', 'tools', 'paths'] as const) {
      when[key] ??= [];
      if (!Array.isArray(when[key]) || when[key].some(s => typeof s !== 'string' || s.length > 200 || !s.length)) throw new Error(`Invalid topic match: ${file}.`);
    }
    return [{ file, body: expandTools(match[2]!, ctx.tools), hash: createHash('sha256').update(text).digest('hex'), when }];
  });
}
function glob(pattern: string, value: string): boolean {
  const re = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*');
  return new RegExp(`^${re}$`, 'i').test(value.replace(/\\/g, '/'));
}
export function inject(ctx: RuleContext, input: HookInput, state: TopicState): string {
  if (input.hook_event_name === 'UserPromptSubmit') state.used = 0;
  const out: string[] = [];
  for (const topic of topics(ctx)) {
    if (state.seen[topic.file] === topic.hash) continue;
    const matched = topic.when.prompt.some(s => (input.prompt ?? '').toLowerCase().includes(s.toLowerCase())) ||
      topic.when.tools.includes(input.tool_name ?? '') || topic.when.paths.some(s => glob(s, input.tool_input?.file_path ?? ''));
    if (!matched) continue;
    const room = ctx.config.turnBudget - state.used;
    const header = `\nTopic ${topic.file}:\n`;
    const full = header + topic.body;
    const suffix = `\n[Read the rest: ${topic.file}]\n`;
    if (room < header.length + suffix.length + 80) continue;
    const first = topic.body.split(/\n## /)[0]!;
    const text = full.length <= room ? full : header + first.slice(0, room - header.length - suffix.length) + suffix;
    out.push(text); state.used += text.length; state.seen[topic.file] = topic.hash;
  }
  return out.join('');
}
export function topicMap(ctx: RuleContext): string {
  return topics(ctx).map(t => `- ${t.file}: ${[...t.when.prompt, ...t.when.tools, ...t.when.paths].join(', ')}`).join('\n');
}
