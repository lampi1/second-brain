<!-- Audit of app-supplied agent instructions for maintainers; records source dates, bounded cleanup and reproducible measurements. -->
# Agent preprompt audit — 24 October 2026

The Orchestrator frame contained repeated tool manuals, an obsolete adapter prohibition, and conflicting review guidance. This change reduces its always-on text while retaining product-specific routing, approval, delegation and production boundaries. It does not change tool access or permission enforcement.

## Evidence and dates

Sources were read on 24 October 2026. These are vendor recommendations, not a formal H2 2026 standard or proof that shorter prompts always perform better.

| Primary source | Date | Relevant guidance |
| --- | --- | --- |
| [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | Published 29 September 2025 | Keep high-value context; discover additional information when needed; design clear, economical tool interfaces. |
| [How Claude remembers your project](https://code.claude.com/docs/en/memory) | Living documentation, checked 24 October 2026; no publication date established | Keep instructions focused, apply local rules by scope, and distinguish behavioral instructions from client-enforced permissions. Imports still consume context. |
| [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices) | Living documentation, checked 24 October 2026; no publication date established | Reserve universal instructions for broadly applicable information; use skills for occasional workflows and supply checks that can verify results. |
| [The new rules of context engineering for Claude 5 generation models](https://claude.com/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models) | Published 24 July 2026 | Remove conflicting repetition; keep tool mechanics in their descriptions; progressively disclose occasional procedures while preserving important constraints. |

The July article was opened through `claude.com` and redirected to `claude.dev`. The [official Anthropic resource index](https://claude.com/resources/articles) also links developer articles to that domain. Its model-specific evaluation claims are not evidence for this app and were not used as a reduction target. The changes below also follow the independently checked `code.claude.com` guidance.

## Code findings and changes

| Finding | Evidence in the baseline | Resolution |
| --- | --- | --- |
| Always-on flow manuals duplicated current tools. | Five paragraphs in `src/main/agents/orchestrator-role.ts` repeated schema/setup/execution details in `src/main/flows/tools.ts` and `automation-tools.ts`, including trigger field enumeration. | Keep when-to-use routing and safety in the frame; point configuration work to current tool descriptions and schemas. |
| A universal capability statement was stale. | The frame said all company adapters were unavailable; the tools already described exact-approved `devopsWrite` and `testDbRead` grants. | Remove the stale inventory. Available adapters and exact host grants come from live tools; a definition is still no execution authority. |
| Review requirements conflicted. | One paragraph required an independent Sentinel after implementation; another limited independent verdicts to unverified/large/sensitive changes. | Development always requires the independent review. Threshold triage is explicitly limited to other reports. |
| Modal instructions repeated formatting rules. | Workflow proposals, general brevity, recap, `DECISION_FLOW_RULE` and `QUESTION_RULE` all explained overlapping question/report formatting. | Leave the shared interaction contract intact; shorten repeated formatting in the Orchestrator-specific paragraphs. |
| Production-query instructions contradicted owner-only execution. | `rules/instructions.ts`, `brain-template/me.template.md` and the shipped Orchestrator output style permitted queries after approval. | State that production queries, including reads, are never executed by the agent; show the full text for the owner to run. Only shipped sources change, not existing user files. |

The audit also traced work-role composition in `src/main/agents/catalog.ts`, `ROLE_PREAMBLE` in `src/shared/roles.ts`, and legacy-line normalization in `orchestrator-role.ts`. Work-role instructions were not indiscriminately shortened: their isolated-contract, exact-decision reuse, delegated-question and final-report conventions are app-specific. User-edited instructions and legacy-profile normalization remain intact. Task-memory selection is a separate concern from this fixed-frame change.

## Complete context composition and remaining limits

The frame is only one layer. The application does **not** currently enforce one combined cap for the complete model input.

| Layer and code owner | When supplied | Size/selectivity behavior in the audited baseline |
| --- | --- | --- |
| Fixed brain files: `rules/storage.ts`, `instructions.ts`, `guards.ts` | Engine launch | `AGENTS.md`, `me.md`, `CLAUDE.md`; default 15,000-character rejection threshold for their joined text. This is not a total prompt limit: product boot text, expanded paths, writer help and all layers below are additional. |
| Mandatory product rules: `instructions.ts` `appBoot` | Product-brain launch | Safety, memory-write conventions, tests and independent review remain unconditional. The production-query sentence now explicitly forbids agent execution, including read-only queries; the owner runs the proposed text. |
| Brain engine adapters: `claude-plugin.ts`, `acp-rules.ts`, `codex.ts`, `domains.ts` | Engine launch | Claude gets fixed rules plus hooks; ACP/Codex fallback gets topic text up front, default 6,000-character topic allowance. Legacy domain instructions use a separate 60,000-character cap; mixed/product domain joins do not have one shared aggregate cap. |
| Topic rules: `rules/topics.ts` | Matching prompt/tool/path on Claude | Default 6,000 characters shared across the turn; once per file revision. Fallback engines receive ordered topic text at launch without task matching. |
| Role framing: `agents/catalog.ts`, `orchestrator-role.ts` | First message per context, after compaction or changed role | Work-role preamble + custom role + output contract + shared interaction rules; Orchestrator also receives live role summaries. Custom role instructions permit 8,000 characters independently. |
| Role skills/memory: `agents/pack/flows.ts`, `wiring.ts` | Work-role launch only | Claude gets qualified selected-skill names plus memory; Cursor gets own skill text, linked-skill file references and memory. Orchestrator exits before this composition, so it receives no scoped role-memory preload. |
| Launch memory: `rules/launch-memory.ts` | Work-role launch | Baseline: optional model proposals ranked by task words within a 1,200 estimated-token allowance; confirmed/protected records and unscoped legacy text are outside that allowance. The companion task-memory change addresses this layer; this frame patch does not bound it. |
| Past-error recall: `search/hybrid/recall.ts`, `chats/manager.ts` | Prompt submission | Non-Claude path quotes up to three matches, 240 characters each, with a 300 ms timeout; Claude uses its prompt hook instead. This can also affect Orchestrator prompts. |
| Task and live state: `chats/manager.ts` | Every relevant turn | Current request, assignment hints, user notes, undo notice, language hint; Orchestrator user requests add estimate and flow-discovery hints. These do not inherit the frame budget. |
| Review/continuation context: `agents/review-pack.ts`, `chats/handoff.ts` | Sentinel launch or session continuation | Review diff is included through 12,000 characters, otherwise file-oriented retrieval; headers/stat are additional. Protected handoff preserves exact instructions/decisions/questions and refuses a fresh handoff above 32,000 characters rather than truncating safety state. |
| MCP/CLI context | Engine-managed | Server instructions, exposed/deferred tool definitions, built-in prompts, native memory/repository files and retained conversation history remain additional and engine-dependent. |

No separate universal lesson-preload block was found in these paths. Approved lessons can become role instructions, skill files or brain rules; they therefore inherit those layers' loading behavior. `agent_task_events` intentionally returns the complete user-instruction ledger before reassignment. Protected handoffs also carry the ledger and exact decisions. This is a potential context cost, but dropping acknowledged instructions or safety decisions would require a separate correctness design; this cleanup does not discard them.

## Measurements

Measured the exported default `ORCHESTRATOR_ROLE` at baseline `ce759437` and after this change, excluding editable custom role text, live role-catalog hints, tool definitions, task text and memory. This is text size, not tokenizer output, latency or quality evaluation.

| Measure | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| JavaScript string length (UTF-16 code units) | 17,457 | 15,363 | 12.0% |
| UTF-8 bytes | 17,518 | 15,421 | 12.0% |
| Whitespace-separated words | 2,722 | 2,393 | 12.1% |
| Lines | 36 | 35 | 1 |

For a deterministic **empty-brain example**, the additive app text is larger than the frame alone. The fixture uses Linux, root `/brain`, tools `/tools`, runtime `/runtime`, a generated profile `Owner / professional / italiano`, the shipped five-role catalog, no topic files, no durable memory, and native own-skill plus shipped linked-skill names (`agent-0123456789abcdef:<skill>`). Totals below sum the model-visible app instruction layers, not message/API overhead or a real session's total tokens.

| Fixture layer | Characters |
| --- | ---: |
| `appBoot` + empty owner profile + memory-writer help, before | 2,038 |
| Same brain instructions after the owner-only production-query correction | 2,042 |
| Orchestrator live five-role catalog increment | 793 |
| Orchestrator frame + catalog + brain instructions, before | 20,288 |
| Orchestrator frame + catalog + brain instructions, after | 18,198 |
| Strategist frame + skill names + empty-memory help + updated brain instructions | 8,884 |
| Scout equivalent (includes `code-investigation`) | 8,382 |
| Artisan equivalent | 9,148 |
| Sentinel equivalent (includes `code-review`) | 9,109 |
| Herald equivalent | 8,627 |

The empty-brain Orchestrator example falls 10.3%. These worker totals isolate the framing/template change with the pre-cleanup memory-help text; they are not the final integrated worker prompt totals, because the companion memory change also replaces that helper. The common owner-only production-query correction adds four characters. These values exclude tools, task text, review packs, engine-native context and real user content. Functions used: `appBoot`, `freshProfile`, `memoryInstructions`, `roleCatalogBrief`, `roleFrame`, `qualifiedSkillsLine`, `ROLE_PREAMBLE`, `ROLE_DEFAULTS`, and `REMEMBER_HINT`. The brain fixture is `[appBoot('/brain','/tools'), freshProfile({OWNER:'Owner',ROLE:'professional',LANG:'italiano'}), memoryInstructions('/runtime','/brain','/tools')].join('\n\n')`; work-role composition follows `catalog.resolve` and `wiring.resolveAgent`, using `qualifiedSkillsLine('agent-0123456789abcdef', [id, ...ROLE_DEFAULTS[id].skills])` and memory text `Your memory (agents/<role>/memory.md): empty so far.\n` followed by `REMEMBER_HINT`.

Reproduce in either revision with the installed repository dependencies:

```sh
node_modules/.bin/esbuild src/main/agents/orchestrator-role.ts --bundle --platform=node --format=esm --outfile=/tmp/second-brain-preprompt.mjs
node --input-type=module -e 'import { ORCHESTRATOR_ROLE as text } from "/tmp/second-brain-preprompt.mjs"; console.log({characters: text.length, utf8Bytes: Buffer.byteLength(text), words: text.trim().split(/\s+/u).length, lines: text.split("\n").length});'
```

## Verification and limits

The targeted regression suite checks that the frame retains single-entry flow routing, exact-revision approval, native yes/no questions, delegated-question handling, independent development review, untrusted event treatment, canonical host reports, production/shared-system restrictions and the disabled updater. It also checks that removed parameter details remain available in tool descriptions, and that the shipped size ceiling does not truncate custom role text.

Targeted validation passed: 28 tests across `preprompt-context.test.ts`, `chats/orchestrator.test.ts` and `reaction.test.ts`; the template safety tests cover both shipped query prohibitions. The frame branch check passed 403 tests with one skipped, plus typecheck, lint and the publish guard. The integrated branch-check result is recorded with the handoff. No E2E or live-model evaluations were run. A shorter frame can reduce repeated input, but these static checks do not establish model quality or token savings across every configured engine. Safety continues to depend on the existing host checks; prompt wording is not an authorization mechanism.


## Integrated task memory and proposal queue

`selectLaunchMemory` now loads only current confirmed records that match the launch task, after exact role/user/project/repository/environment filtering. It ranks lexical matches locally and quotes complete facts with source and verification metadata. The limit is **eight records and 3,600 characters** (approximately 1,200 tokens); records are never truncated mid-condition. An absent or unmatched task loads no facts and includes scoped `memory_recall` guidance. Mandatory policy, user instructions and host permission checks stay outside this retrieval budget. Logs record only counts and estimated size, never the query or memory text.

The selector author's deterministic 500-confirmed-record fixture loaded 161,899 characters under the old unlimited-confirmed path versus 853 characters (two matching facts) for a database task under the new selector. A broad matching query loaded eight facts / 3,375 characters. This synthetic result measures text selection, not model quality or production token usage; archive contents remain unchanged. Lexical retrieval can miss paraphrases, so explicit scoped recall remains available. Existing chats are not retroactively rewritten.

The approval deck now prioritizes three ordinary cards per role across dates, with remaining facts in exact-scope batches of at most eight distinct facts and 6,000 escaped content characters. Contradictions and replacement proposals remain separate and may exceed the ordinary-card limit. Complete membership determines batch identity; a stale approval cannot silently approve new members. No records are approved or deleted merely by displaying the deck.

Creation rejects clear task chatter and reuses exact repeats, including dismissed facts, without recreating legacy copies. Equality preserves case, numbers, punctuation and internal whitespace; similarity is not permission to merge meanings. Maintenance cannot rewrite or retire confirmed content automatically: a generalized replacement is a new unverified proposal, and the original stays confirmed until the user decides.

Personal milestones are removed from Agent Studio and the guide, with award callbacks disconnected and the legacy IPC service disabled. Existing progress files are preserved. Agent XP, levels and real run outcomes are unchanged.
