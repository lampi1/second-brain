<!-- Records the provenance gate and read-only launch memory selection used by agent packs. -->
# 0137 — Evidence before lesson approval; selective launch memory

Date: 2026-10-23 · Status: partly superseded by ADR 0153 (the timers); accepted

The uploaded research proposes evaluating learned rules and reducing unnecessary permanent context. The existing
explicit user approval gate remains mandatory. A cited outcome is evidence about an observed run, not proof that a
new rule caused an improvement; this change does not launch experiments, spend tokens or manufacture effect estimates.

Before a lesson is offered for approval, main resolves explicit `run:<id>` references (legacy `r_…` references also
work) against its run store. Every cited run must be complete, belong to the proposed role and current brain, and have
a human or independently reviewed verdict. Verified failures and partial outcomes are valid learning evidence.
Unverified self-reports, open runs, unknown scope and absent sources cannot authorize application. The UI can still
show and reject an insufficient proposal. The user assesses whether the proposed rule follows from the cited events.

Main records the exact proposal hash and source fingerprints. Approval and the corrections queue both recheck them;
a changed source or proposal requires resubmission and a new user decision. Pending legacy approvals lack this binding
and return to review. No tool can submit an assessment or approve a lesson. Applied historical lessons are untouched.
Main wiring supplies `learning.evidenceRuns` from the authoritative run store; absent wiring fails closed.

Role launch memory now uses a separate deterministic, read-only view. It retains confirmed records, records with
verification, unknown provenance and security-sensitive records. Unscoped legacy Markdown is retained as quoted data,
including prose outside bullets. Existing project/user/repository/environment scope restrictions still apply.
Only identifiable model proposals are eligible for omission: matching the launch goal ranks them, with a stable
tie-break, a maximum of forty records and the existing conservative 1,200-token optional budget. Protected records
are exempt from that budget. Other memory stays in its original store and remains available through `memory_recall`;
the launch tells the agent how many records were omitted. No expiration, deletion, archive or user-instruction rewrite
is introduced. Role instructions, loaded skills and security enforcement remain outside this selector.

Validation uses unit tests for changed/revoked evidence, exact approval binding, wrong scope/role, legacy migration,
untrusted tool arguments, preserved protected memory, bounded selection and searchability after omission. Existing
pack and corrections integration tests now use real host-owned evidence fixtures. E2E execution is excluded here.

The maintenance dispatcher also enforces the same approval boundary. Timers and the generic maintenance button run
only structural migration (copying existing procedure text without role relinking), already approved corrections,
and non-loadable repeated-task candidates. Recurring `ai-errors.md` text never becomes a rule by itself. Upgrade,
semantic skill merges and memory rewriting/retirement are deferred with an explicit review-required result; neither
an engine call nor a mutation happens before an exact proposal is reviewed. Their implementation helpers remain for
compatibility, but are not reachable from maintenance dispatch. Research and unused-skill findings remain cards;
only the existing explicit proposal decision invokes `ResearchService.approve` and applies their exact content.
