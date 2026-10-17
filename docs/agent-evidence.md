# Agent evidence: integration contract

This additive read model extends existing agents and ledgers; it introduces no framework, cost store,
scheduler, background model call, award, level, productivity score or new agent.

## Costs and observable time

`main/agents/analytics.ts` exports `aggregateAgentUsage`, `cursorLedgerObservations` and the composed
`buildAgentReadModel`. Agent identity is the existing owner snapshot ID and revision (`ownerOf` uses
AgentProfile.updatedAt). Names/icons do not determine identity. Historical ownership needs no current
catalog entry, so deleting a profile does not erase history.

Caller supplies actual observed session snapshots, keyed by native session ID, with source and observedAt.
The latest snapshot replaces earlier snapshots of that session; totals are never added across snapshots.
`actualUsd`, `listPriceUsd` and calibrated `estimatedUsd` remain separate. Unknown is null, including a
partially unknown total; knownSubtotal and sample counts expose partial coverage. Recorded zero stays zero.
Do not map ChatSummary.costUsd to actual charges: its contract says API-equivalent/live estimate.

The Cursor adapter consumes the EXISTING readLedger output and existing listUsd function. It prices no
unknown model and invents no rate. It attributes only conversation IDs matched to owner snapshots, and
counts unattributed rows. Account quota observations remain separate and are never converted to dollars
or split between agents. Parent inclusive/unknown coverage withholds descendant money/tokens to prevent
double summation; display the scope rather than presenting an exclusive per-agent allocation.

Only explicit nonoverlapping state spans provide execution, user-wait, permission-wait and queue durations.
Elapsed requires observed start/end timestamps. Missing/partial/unknown intervals never become zero.
Incomplete session timing is excluded from totals/medians; observedPartialMs separately retains measured
partial intervals. Cohorts require completed samples with task type, observed engine/model/effort, owner
revision and complete known timing; no fastest-agent ranking or causal comparison is generated.
No current event capture or ledger lifecycle is changed by this module. Integrator must map existing
events, not infer wait duration from a result's durationMs. Native ledger/account access was not tested.

## Canonical insights and reversible selection

`buildAgentReadModel` additionally accepts canonical insight records and an explicit selection policy.
Records retain author, source ID/revision, confirmation basis, state, outcome and timestamp. Model
self-report or ambiguous feedback is proposed/unknown; only trusted human or reviewed canonical evidence
can confirm it. The caller must derive that trust from the real event path, never a model-supplied role label.
The period applies only to canonical insights (`periodScope` says so); metric snapshots retain their own
evidence timestamps and are not represented as prorated period spend.

Policy `{version:1,revision,mode:'chronological'|'confirmed-outcomes-first'}` changes only material order.
Passing the previous policy restores that order; source events, global rules and permissions are not rewritten.
No sample-based productivity scores or token-volume awards exist. Source imports and policy persistence
remain in existing app services; this pure selector creates no extra archive.

## Confirmed user context and Improve

`ConfirmedContextSource(userDataDirectory, clock?)` owns only the fixed confirmed-user-context.json file.
`load`, `save(facts,expectedRevision)`, `getConfirmedEssential` and `readRequestedSource` are the API.
Save input is strictly `{id,key,value,category}` facts; main stamps confirmation time and explicit-user-save
provenance. The ONLY consumer allowed to call save is the explicit renderer action approving selected
values for AI context. Setup completion and interview autosave are not that action. Corrupt/oversized/linked
archives fail closed; requested sources all remain denied in this iteration. No real private files were read.

Loader packets preserve source revision and scope. Canonical essential scope is user. Additional project,
agent-private, task, procedure and archive scopes are labels for future allow-listed providers; authorization
and namespace isolation must be enforced by main before a source is returned. They are not active providers.
The current runtime template remains coding-oriented; no broad template rewrite was made.

`main/improve/evidence.ts` exports `buildImproveEvidence` for the EXISTING Improve coordinator. Caller
passes the already assembled context packet, read model and explicit selected fact refs/agent IDs with a
byte budget. It returns only selected facts, evidence-derived observations and comparable cohort data;
unknown selections fail, whole objects that do not fit are reported omitted. No full transcript is read.
Invoke on an explicit preview/suggestion request; this function sends nothing and runs no model per refresh.
Use the existing proposal, review ledger, preview and human publication flow. No new wizard/branch/autopush.

## Runtime routing metadata

The EXISTING AgentDraft/Profile schema now includes optional routing metadata, not the data-section manifest:
whenToUse, whenNotToUse, input/output contract descriptions, declared tool IDs, access scopes and success
criteria. Keep verified/unknown capability evidence separate and bound to profile ID/revision and harness
observations; a creator's declaration alone is not verification. Compact candidate discovery should contain
metadata and status only; private instructions/skills are excluded from discovery and remain in existing explicit
profile editing and launch flows.
Ambiguous matches and conflicting scopes require clarification; a user override still passes the harness's
tool/access enforcement. Neither task mail nor a metadata declaration grants protected-operation consent.
Runtime contract, discovery boundaries and compatibility behavior are documented in
[ADR 0066](adr/0066-agent-operating-manifest.md). Declarations never replace harness security enforcement.

## Memory sources consulted

- [LangChain memory concepts](https://docs.langchain.com/oss/python/concepts/memory): thread state/checkpoints
  differ from shared long-term namespaced memory; semantic, episodic and procedural material have different
  roles. Reuse that separation without adopting its storage framework or copying user profiles per agent.
- [AGENTS.md](https://agents.md/): repository coding instructions are one context source, not an entire
  user/project/agent memory architecture.
- [Evaluating AGENTS.md](https://arxiv.org/abs/2602.11988): its coding-agent experiments report that context files
  can reduce success and increase inference costs. This is evidence for testing concise relevance, not a universal
  claim about all memory systems or models. Offline fixture replay here does not measure weaker-model success.

Runtime status is refined by the collector integration note below. Deterministic fixtures, isolated native
config validation and code review do not certify enterprise behavior or eliminate model errors.

## Event model provenance and settings boundary

Every observation may carry event provenance: stable agent ID/revision, session/turn/item IDs where known,
observed engine/model, observed effort and separately submitted effort, source and event timestamp.
Legacy missing fields remain null. Current profile defaults/file labels never backfill historical model data.
Session totals are allocated by model only with explicit single-model-observed attribution and excluded child
totals; mixed/inclusive/unknown scopes stay unallocated with coverage counts. Cursor uses actual models in existing
ledger rows. byModel and modelCoverage accompany agent groups. Reporter provenance and responsibleEpisode
are separate on errors; errorsByResponsibleModel never attributes an episode to the reviewer who found it.
Original authors/origin survive revisionLineage. No metadata is inferred using a model call.

Improve's optional insightRefs select canonical errors/ideas/feedback explicitly, preserving author/model and
reviewer lineage. Empty selection sends none of that material. This supplies the existing coordinator.

Routing/autoload should derive from the existing agent profile, verified capability and preserved policy.
There is no new global activity toggle matrix or first-use wizard here. Disabled protected permissions stay
disabled. Codex uses the reviewed native per-tool launch allowlist for ten exact local app read/mail tools,
with prompt fallback for every other tool. No per-engine permission toggle or synthetic approval response is added.
Existing launches and pending requests are never answered by this launch configuration.

## Minimal runtime collector integration

`ChatManager.analytics` now collects native-confirmed sink patches/results and explicit pending/state intervals
in bounded local observations; Costi consumes `/api/agents/analytics` through the existing brain API. The integrator
registers that endpoint as `() => manager.analytics.readModel()` beside the existing local quality endpoint.
The renderer displays all observed history separately from the legacy cost period. Only provider-observed
metadata enters model provenance; configuration/default model changes do not supply historical evidence.

This first collector preserves partial timing only: authoritative task type, full native-session lifecycle,
actual charges and calibrated estimates are not captured, and therefore runtime comparable cohorts remain empty.
The existing Cursor ledger adapter is not invoked to read native account archives by this collector.

Memory tables/ModelOrigin preserve explicit event origin, reporter and responsible-episode snapshots. Template
producers can read an execution-bound explicit snapshot when one is provided, but normal and warm chat launch
environments clear `SB_EVENT_CONTEXT`: native subagents inherit environment variables, so a per-chat snapshot
cannot prove the writing agent's model. Automatic producer binding remains open. Existing brains need their usual
template sync for parser/producer changes; no historical model or error responsibility is reconstructed.
