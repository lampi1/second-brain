# ADR 0357 · Claude and GPT models on Antigravity have their own quota pool

Date: 2026-11-25 · Status: accepted (owner, 2026-11-25) ·
Amends: ADR 0354 (credit pools) · Keeps: ADR 0256, ADR 0356

## Context

The Antigravity plan has two quotas: «Gemini models» and «Claude and GPT models». `agy` writes both in its status
(`gemini-5h`, `gemini-weekly`, `3p-5h`, `3p-weekly`). Whether a Claude model may start on Antigravity or Cursor is
already decided by the engine's live model list (ADR 0256, 0356, `shared/model-fit.ts`). What was missing was the quota:
the credit rule counted every window against every model, and the Claude/GPT windows were hidden until used.

## Decision

- A usage window may carry `scope` (`gemini` | `3p`). A scoped window stops only the models of its pool; a window
  without scope stops every model of the engine, as before (`shared/credit-rule.ts`).
- Antigravity's reading is served as two credit pools: `antigravity` (Gemini) and `antigravity:3p` (Claude, GPT-OSS),
  picked by the model name (`poolOf`). A limit error of one pool pauses only that pool; a Gemini quota at 100% does not
  stop Claude on Antigravity, and the other way round. Delegation picks and the credit move use the same pool.
- The limits panel always shows the Claude/GPT windows beside Gemini's (`5h · Claude/GPT`, `7g · Claude/GPT`).
- Cost: a Claude model on Antigravity or Cursor is the engine's own consumption (what the engine reports, or Cursor's
  price list), never Claude API spend and never the Claude engine's quota.

## Open

- The pool of a model is guessed from its name (claude, opus, sonnet, haiku, gpt, oss); a name outside that is Gemini.
- Antigravity reports no cost per turn, so its spend shows no dollar figure.
- Real chat with Claude Sonnet 5.5 on Antigravity not tried here (needs the owner's PC).
