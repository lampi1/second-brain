# 0067 — App-owned GitHub and Jira project connectors

Date: 2026-10-17. Status: proposed for build 1 integration.

The first setup must connect the user's actual tools after the AI setup. The existing
onboarding v2 module prepares harness MCP configuration, but has no production trust,
metadata, login or probe adapter. Its installation would also require a separate product
policy exception for editing other applications' configuration.

Build 1 therefore mounts an app-owned connection screen after successful AI setup and
offline interview completion, also available under Settings → Strumenti e progetti.
This is a different capability from installing MCP servers into coding harnesses.
The existing transactional installer remains isolated and unmounted.

GitHub uses the person's official `gh auth login` and authenticated `gh api` read-only
requests. The app never extracts or stores GitHub tokens. Git-only authentication is
not proof of GitHub API access; absent gh, the panel asks the person to install it.
GitHub Enterprise is outside this initial github.com adapter.

Jira Cloud uses the documented account email + classic API token method. The user
opens the official Atlassian token-management page from a one-use local browser form.
The form posts directly to a random-route loopback main-process HTTP listener, with
exact Host/Origin checks, no scripts, no caching, no referrers and a five-minute expiry.
No token crosses Electron IPC. The token is encrypted using Electron safeStorage;
unavailable storage and Linux basic_text fail closed. This narrowly extends credential
storage to user-authorized Jira tokens; no credentials enter harness or brain files.
OAuth registration, scoped API tokens, Jira Data Center and custom domains are not
provided by this adapter. No runtime dependency is added.

Probes read account identity and at most 100 accessible repositories/projects. Only
successful probes show verified evidence and its timestamp. Selected projects are
persisted in private app metadata and bound to provider account and Jira tenant.
Selection records preferences; it does not grant additional agent permissions or
provide a harness MCP installation. Restart restores preferences but requires fresh
verification. Disconnect removes local selections and the Jira token; official
provider-side revocation is separate. No network/login occurs from panel rendering.

Real login/probe actions are disabled in hidden, test and demo sessions. E2E uses
synthetic adapters on main only and runs on main after integration, per repository policy.
