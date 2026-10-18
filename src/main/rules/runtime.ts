// Standalone product hook entry API. Guards fail closed; optional context/feed failures warn without storing prompts.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { atomicWrite, configOf, locked, read } from './storage';
import { guard } from './guards';
import { inject, type TopicState } from './topics';
import { autoCommit } from './maintenance';
import type { HookInput, HookResult, LaunchFacts, RuleContext } from './types';
export { writeNow, writeError } from './memory';
export { lint, lease } from './maintenance';
export { configOf } from './storage';

export function runHook(root: string, state: string, input: HookInput, launch: LaunchFacts = {}): HookResult {
  if (!input || typeof input.session_id !== 'string' || !input.session_id || !['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'].includes(input.hook_event_name)) return { deny: 'Invalid product hook input; retry with a valid event and session id.' };
  let ctx: RuleContext;
  try {
    ctx = { root: fs.realpathSync(root), state, config: configOf(root), ...(typeof launch.tools === 'string' ? { tools: launch.tools } : {}) };
    if (input.hook_event_name === 'PreToolUse') { const deny = guard(ctx, input); if (deny) return { deny }; }
  } catch { return { deny: 'Product safety guard could not verify this operation. Check brain.json and file permissions before retrying.' }; }
  try {
    fs.mkdirSync(state, { recursive: true });
    const id = createHash('sha256').update(ctx.root + '\0' + input.session_id).digest('hex');
    return locked(state, id, () => {
      const file = `${id}.json`;
      const saved = read(state, file);
      const current: TopicState = saved ? JSON.parse(saved) as TopicState : { seen: {}, used: 0 };
      let context = '';
      if (input.hook_event_name === 'UserPromptSubmit' || input.hook_event_name === 'PreToolUse') context = inject(ctx, input, current);
      if (input.hook_event_name === 'UserPromptSubmit' && typeof input.prompt === 'string' && launch.correctionHook !== true &&
          !/^\s*<|\[Messaggio di un agente|Another Claude session/.test(input.prompt) &&
          /\b(non (?:così|funziona|devi)|sbagliat|ti ho detto|wrong|incorrect|not what I asked)/i.test(input.prompt)) {
        const reminder = '\nPossible correction: record the verified error with the product memory writer.';
        if (current.used + reminder.length <= ctx.config.turnBudget) { context += reminder; current.used += reminder.length; }
      }
      atomicWrite(state, file, JSON.stringify(current));
      // Feed contains metadata only. Prompts/tool input and credentials never enter this file.
      atomicWrite(state, `${id}.feed.json`, JSON.stringify({ session: input.session_id, event: input.hook_event_name, at: Date.now() }));
      if (input.hook_event_name === 'Stop') autoCommit(ctx);
      return context ? { context } : {};
    });
  } catch {
    process.stderr.write('Product rules warning: optional context/feed/commit unavailable; check topic frontmatter and state permissions.\n');
    return {};
  }
}
