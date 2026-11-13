// Small, explicit frontmatter dialect for topic rules: JSON flow mappings (valid YAML) avoid executing YAML tags.
// Topic rules are no longer injected by the hooks (#366, ADR 0243: the product's are app skills, rules/tools.ts
// topicSkills); this file still reads them for the brain lint's map and the frontmatter check.
// A fresh brain (rules.appRules) also gets the product's topic rules from the app-owned copy (`tools`, rules/tools.ts:
// its .sb-tools.json lists them), labelled by their path there; the brain's own topicFiles come after them.
import { createHash } from 'node:crypto';
import { read } from './storage';
import type { RuleContext } from './types';

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
export function topicMap(ctx: RuleContext): string {
  return topics(ctx).map(t => `- ${t.file}: ${[...t.when.prompt, ...t.when.tools, ...t.when.paths].join(', ')}`).join('\n');
}
