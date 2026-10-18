// Enforce the fixed-context allowance and validated memory writers before Claude file tools execute.
import path from 'node:path';
import { read, confined } from './storage';
import { check } from './vendor.mjs';
import type { HookInput, RuleContext } from './types';

export function fixedSize(ctx: RuleContext, replacement?: { file: string; text: string }): number {
  const seen = new Set<string>();
  return ctx.config.fixedFiles.filter(f => { const key = process.platform === 'win32' ? f.toLowerCase() : f; if (seen.has(key)) return false; seen.add(key); return true; })
    .map(f => replacement && (process.platform === 'win32' ? f.toLowerCase() === replacement.file.toLowerCase() : f === replacement.file) ? replacement.text : read(ctx.root, f)).filter(Boolean).join('\n\n').length;
}
export function guard(ctx: RuleContext, input: HookInput): string | undefined {
  const ti = input.tool_input ?? {};
  if (['Bash', 'PowerShell'].includes(input.tool_name ?? '')) return check(ti.command ?? '', 'claude') ?? undefined;
  if (!['Write', 'Edit', 'MultiEdit'].includes(input.tool_name ?? '')) return;
  if (typeof ti.file_path !== 'string') throw new Error('File tool is missing its path.');
  const file = path.resolve(input.cwd ?? ctx.root, ti.file_path);
  const rel = path.relative(ctx.root, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return;
  confined(ctx.root, rel);
  if (/^(now|ai-errors)\.md$/i.test(rel)) return 'Use the product memory writer (brain-rules memory); direct memory edits are refused.';
  if (!ctx.config.fixedFiles.some(f => f.toLowerCase() === rel.toLowerCase())) return;
  const before = read(ctx.root, rel);
  let after = before;
  if (input.tool_name === 'Write') {
    if (typeof ti.content !== 'string') throw new Error('Write is missing content.');
    after = ti.content;
  } else {
    const edits = input.tool_name === 'MultiEdit' ? ti.edits : [ti];
    if (!Array.isArray(edits) || !edits.length) throw new Error('Edit is missing replacements.');
    for (const edit of edits) {
      if (!edit || typeof edit.old_string !== 'string' || !edit.old_string || typeof edit.new_string !== 'string') throw new Error('Invalid edit replacement.');
      const old = edit.old_string.replace(/\r\n/g, '\n');
      if (!after.includes(old)) return 'Edit target was not found; reread the file before editing.';
      after = edit.replace_all ? after.split(old).join(edit.new_string) : after.replace(old, () => edit.new_string!);
    }
  }
  const total = fixedSize(ctx);
  const next = fixedSize(ctx, { file: rel, text: after.replace(/\r\n/g, '\n') });
  if (next > total && next > ctx.config.fixedBudget) return `Fixed context ${total} → ${next}; budget ${ctx.config.fixedBudget}. Shorten or move rules to a topic file first.`;
}
