// The brain scripts' only way to the user's API credits (ADR 0052): the local MCP mount /mcp/text/<token> with one tool,
// text_complete, which makes the text-only call (text.ts) inside main and answers with the text and its cost. Why: the
// key never leaves main (no file, no log, no argument, no child's environment); a script gets only this endpoint's
// token, in the environment of the brain processes the app itself starts (brain/index.ts: estimates.mjs and what it
// starts, e.g. the sample judge). The token is random for each app run and lives only in memory; a wrong one answers 404
// like a missing route (mcp/server.ts). A script run by hand, or by an agent's shell, has no token and keeps its own road
// (headless Claude Code). The tool answers JSON: {ok:true,text,usd,model,engine} · {ok:false,unavailable:true,reason} ·
// {ok:false,error,usd?}. Used by wiring.ts; tested in test/unit/engines/text.test.ts.
import crypto from 'node:crypto';
import type { McpServer } from '../mcp/server';
import { checkTextRequest, TEXT_MAX_PROMPT, TEXT_MAX_TOKENS, type TextModel } from './text';

/** The environment variable that carries the endpoint's URL (token included) to the brain's scripts. */
export const TEXT_ENV = 'SB_APP_TEXT';

export function mountTextTool(mcp: Pick<McpServer, 'mount' | 'url'>, model: Pick<TextModel, 'complete'>): { url: () => string } {
  const token = crypto.randomBytes(24).toString('base64url');
  const want = Buffer.from(token);
  const authorize = (p: Record<string, string>): boolean => {
    const got = Buffer.from(p.token ?? '');
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  };
  mcp.mount('/mcp/text/:token', {
    name: 'text', authorize, who: () => 'brain-script',
    instructions: 'Text-only calls on the user\'s Anthropic API credits, made by the app (the key never leaves it). When the API engine is off or has no key the answer is {ok:false, unavailable:true}: use your own road.',
    tools: [{
      name: 'text_complete',
      description: 'One prompt → one text answer from a Claude model on the user\'s Anthropic API key (no tools). Answers JSON {ok, text, usd, model} or {ok:false, unavailable|error}.',
      inputSchema: {
        type: 'object', additionalProperties: false, required: ['purpose', 'model', 'prompt'],
        properties: {
          purpose: { type: 'string', description: 'who asks, e.g. routing-judge' },
          model: { type: 'string', description: 'Claude model id, e.g. claude-opus-5-5' },
          effort: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh', 'max'] },
          system: { type: 'string' },
          prompt: { type: 'string', maxLength: TEXT_MAX_PROMPT },
          maxTokens: { type: 'integer', minimum: 1, maximum: TEXT_MAX_TOKENS },
        },
      },
      annotations: { readOnlyHint: true, openWorldHint: true, title: 'Testo dai crediti API' },
      run: async (args, ctx) => {
        const req = checkTextRequest(args);
        if (typeof req === 'string') return JSON.stringify({ ok: false, error: req });
        return JSON.stringify(await model.complete(req, ctx.signal));
      },
    }],
  });
  return { url: () => mcp.url(`/mcp/text/${token}`) };
}
