# Build routines as configuration

A routine is user-owned versioned data, not a product feature for one company. Compose supported steps, prompts, models, inputs, scripts, queries, checklists, retries and outputs through the Orchestrator. A new workflow using these primitives needs no app patch. There is no built-in requirement to follow a bug-fix lifecycle.

Ask the Orchestrator to read `app_flow_capabilities`: its small overview links to `authoring`, `devops` and `test-targets` sections. Details load only when needed, not into every agent prompt. `app_flow_models` supplies actual available model IDs; the proposal tools describe the accepted fields.

| Need | Configuration |
| --- | --- |
| A different workflow | Compose agent, check, approval and manual steps with chosen evidence, timeouts and bounded retry/rework. |
| Deterministic processing | Embed reviewed scripts or query assets; pin their content hash and pass typed parameters or attachments. Required interpreters must be installed. |
| Reusable knowledge | Embed full prompts and checklists in the package. Brain changes become explicit new versions. |
| Automatic starts | Propose an interval or DevOps trigger. DevOps host writes require the approved DevOps configuration. |
| A different supported test environment | Inspect/register its exact target, then approve it in the routine grant. Organization, repository, app, service connection, queue and parameter names are data, never app-specific constants. |
| Review and improvement | Inspect the run dossier and declared outputs, then propose an updated version. Import/export carries the package; imports remain drafts. |

The user approves the exact routine and its automatic grants in the existing modals. Discovery does not grant permissions. Ordinary agent/MCP tools retain their role permissions; generic scripts have local process authority and are not a sandbox or a replacement for host-controlled write grants. Production remains an explicit user action.

Current limits are explicit: target registration still uses the user-managed configuration file returned by the inspection tools; the Orchestrator cannot install it. A new target within a supported adapter is configuration; a new deployment technology or privileged host operation needs adapter code and security tests. An unknown operation must block clearly, never fall back to an unrestricted shell command.

For App Service registration and the supported deployment shape, see [routine-test-targets.md](routine-test-targets.md).
