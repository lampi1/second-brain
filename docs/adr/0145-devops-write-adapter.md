# ADR 0145: A host-checked Azure DevOps write adapter for automatic flows

Status: accepted, 2026-10-23.

Automatic flows (ADR 0143) could only read: any `external-write` step blocked with "adapter unavailable". Many
repeatable flows need a few bounded writes on the work item that triggered them (tags, a comment, a state or area
move, the test plan that proves the fix, the PR link). Letting the agent use any DevOps tool would give it the whole
organization.

A flow step may declare `adapter: "devops-write"`, only on an `external-write` agent step without an action. The
automatic configuration of that exact flow version may carry `devopsWrite {organization, projects, ops, fields}`,
which the user sees in the decision modal and approves with the rest of the configuration. Absent means deny-all:
without it, `usable()` refuses any external-write step and the flow service blocks it. The organization must equal the
trigger's; the projects must include the trigger project; `ops` is a subset of `tags`, `comment`, `fields`,
`test-plans`, `test-results`, `pr-links`; `fields` lists the reference names `set-fields` may change, never identity,
revision, project, type or tags. No organization, project or field is built in: all values are user configuration.

The bound chat writes with one chat-endpoint MCP tool, `flow_devops_write`. The host derives the run from the caller
chat (the running current step bound to it, same chat run and task version, inside the selected brain, before the step
timeout) and re-checks the grant on every call: the rule is enabled at its approved revision, same flow version, owner
and scope, and the run comes from that rule's own event with the same inputs; pausing, replacing or rejecting the rule
withdraws it at once. Subjects starting with `auto:` are reserved: only the automation service starts them, and the
grant goes only to the run that event started (its `runId`), never to a manual run with a copied subject.
The work item is always the run's `work-item-id`, read live, its project inside the grant; a linked pull request's
project is resolved from its GUID and must be inside the grant too.
Test plans, suites and cases can be changed only if this run created them (a per-brain ledger,
`flows/<brain>/devops-ledger.json`, at most 500 per run, checked before any create). Requests are serialized, use the Azure CLI token in memory only, never follow
redirects, and fail closed on login errors, concurrent edits (revision test, HTTP 412) and a corrupt ledger. An audit
line (run, operation, target id) goes to the app log; no token or body is logged.

Out of scope: pushes, pull request creation or completion, deployments, any production or Azure resource. The app
cannot stop the bound chat from using other DevOps tools the user configured in their own CLI (rule 6): the prompt
says a refusal is final, and the grant only limits what this tool does.
