// Small, explicit frontmatter dialect for topic rules: JSON flow mappings (valid YAML) avoid executing YAML tags.
// Hooks inject matching content once per revision and share a total allowance across all tools in one turn.
// A fresh brain (rules.appRules) also gets the product's topic rules from the app-owned copy (`tools`, rules/tools.ts:
// its .sb-tools.json lists them), labelled by their path there; the brain's own topicFiles come after them.
import { createHash } from 'node:crypto';
import { read } from './storage';
import type { HookInput, RuleContext } from './types';

export interface Topic { file: string; body: string; hash: string; when: { prompt: string[]; tools: string[]; paths: string[] } }
export interface TopicState { seen: Record<string, string>; used: number }
/** `{tools}` in personal text names the app-owned utilities (rules/tools.ts); left as is when the launch has none. */
export const expandTools = (text: string, tools?: string): string => tools ? text.replace(/\{tools\}/g, () => tools) : text;
/** The product topic files of the app-owned copy (relative to it); [] when the copy is absent or names none. */
export function appTopicFiles(tools: string | undefined): string[] {
  if (!tools) return [];
  try {
    const list = (JSON.parse(read(tools, '.sb-tools.json') || '{}') as { topics?: unknown }).topics;
    return Array.isArray(list) ? list.filter((f): f is string => typeof f === 'string' && f.endsWith('.md')) : [];
  } catch { return []; }
}
export function topics(ctx: RuleContext): Topic[] {
  const app = ctx.config.appRules ? appTopicFiles(ctx.tools).map(rel => ({ base: ctx.tools!, rel, file: `${ctx.tools!.replace(/\\/g, '/')}/${rel}` })) : [];
  return [...app, ...ctx.config.topicFiles.map(rel => ({ base: ctx.root, rel, file: rel }))].flatMap(({ base, rel, file }) => {
    const text = read(base, rel);
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
