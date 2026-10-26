// On-demand authoring catalog for the Orchestrator: compose user routines from existing primitives, not app patches.
// Discovery grants no authority. Keep detailed recipes out of the always-on prompt and point to live configuration.
import { DEVOPS_WRITE_OPS } from '../../shared/flow-automation';

export const FLOW_CAPABILITY_SECTIONS = ['overview', 'authoring', 'devops', 'test-targets', 'components', 'verification'] as const;
export function flowCapabilities(section: unknown = 'overview'): object {
  switch (section) {
    case 'overview': return {
      sections: [...FLOW_CAPABILITY_SECTIONS],
      authoring: { tool: 'app_flow_capabilities', section: 'authoring', rule: 'Compose new routines, parameters, scripts and checklists as versioned data. No app change is needed when existing primitives cover the task.' },
      automaticProduction: { enabled: false, scope: 'routine-only', operations: ['db-read', 'db-write', 'deploy'], requires: ['exact approved routine version', 'explicit user-managed production target', 'approved recipe hash and bounds', 'dedicated host adapter and audit'] },
      browserWrites: { enabled: true, section: 'authoring', writeVia: 'browser', permission: 'Exact non-production origins approved in the definition activation modal', supportedEngineKind: 'claude' },
      testDeploy: { enabled: true, requires: ['exact local target', 'approved test-deploy grant', 'pinned App Service or server-side node demands', 'run-owned PR build'] },
      components: { section: 'components', purpose: 'Discover pinned authoring knowledge and propose copied assets, never install or silently activate it.' },
      verification: { section: 'verification', purpose: 'Check readiness, compare recorded results and explain changes with evidence.' },
      boundaries: ['Discovery is not permission. Exact version and automation grants still require user approval.', 'Existing production commands require the user exact-command click.', 'An unsupported host integration needs an adapter implementation; scripts and MCP tools cannot bypass a host grant refusal.'],
    };
    case 'authoring': return {
      browserWrites: { supportedEngineKind: 'claude (native allowlist and strict MCP); Codex/ACP are refused until their native escape routes can be verifiably disabled; API engines currently have no tools', declaration: { kind: 'agent', effect: 'external-write', writeVia: 'browser', browserTargets: ['https://qa.example.com'] }, approval: 'Exact version in the activation modal; non-production only, no host DevOps adapter required.', runtime: 'Current bound chat only, exact origins; fresh isolated browser session per chat, all network destinations restricted (include required same-task API/CDN origins). Other tools/children receive no grant. Host vault login or human handoff; no typed passwords.', reporting: 'agent_report.browserWrite {outcome: done|partial|not-done,evidence:[read-back or screenshot]}; partial/unknown require reconciliation, not-done may retry.', credentials: 'User CRUD in Credenziali → Siti delle routine, OS-encrypted, exact origin. browser_login never returns a password. Missing/ambiguous credentials or complex forms use handoff_to_user kind login.' },
      workflow: ['Read app_flow_list and app_flow_auto_list, then gather missing decisions with native questions.', 'Propose with app_flow_propose using either definition or definitionPath (plain JSON inside the selected brain, at most 1 MiB); activate the exact version in the user modal.', 'If automatic execution or host grants are needed, propose them separately with app_flow_auto_propose.', 'Use app_flow_start_item dryRun to resolve a manual invocation without executing it.'],
      steps: {
        agent: { roleAndModel: 'Discover app_flow_models; freeze role, tier, engine, model and full agentPrompt in the package.', tools: 'Existing role and connector permissions still apply; the package does not grant arbitrary shell or MCP authority.' },
        check: { builtins: ['scope-present', 'inputs-present'], actions: ['script', 'query'], recipe: 'Embed the exact content as a package asset; action.ref names its id and action.hash pins its sha256. Declare env, args, inputs, evidence, timeoutMs and maxAttempts.' },
        approval: 'User decision in the native modal.', manual: 'User performs and confirms the step.',
      },
      scripts: { extensions: ['.ps1', '.py', '.js', '.mjs', '.cjs', '.sh', '.cmd', '.bat'], requirements: 'The interpreter must be installed. .cmd/.bat require Windows. Scripts run with local process authority, not an isolation sandbox: review their exact content and effects; never use them to bypass granted DevOps/DB/deployment operations.' },
      parameters: { types: ['string', 'int', 'list', 'file', 'enum', 'env'], arguments: ['literal', '{{input-or-param}}', '{{attachment:name}}'] },
      package: { assetKinds: ['script', 'query', 'checklist', 'reference'], outputKinds: ['lesson', 'report'], rule: 'Brain content is copied at authoring time. Runtime uses approved assets; changed rules require a new version. Brain write-backs are declared append-only outputs.' },
      recovery: { attempts: 'maxAttempts 1..5; onFail.goto may name an earlier step.', review: 'reviewOf binds an independent Sentinel review to an earlier agent step.', tools: ['app_flow_cancel_propose', 'app_flow_restart_propose', 'app_flow_message'] },
      automation: { triggerKinds: ['interval', 'devops'], tool: 'app_flow_auto_propose', note: 'devopsWrite requires a DevOps trigger. Do not assume an interval trigger can grant it.' },
      lifecycle: { start: 'app_flow_start_item', observe: 'app_flow_overview', inspect: 'app_flow_dossier', improve: 'app_flow_outputs_since_active', portable: 'Export/import from Routine; import creates an inert draft.' },
    };
    case 'components': return {
      sources: 'User enables public GitHub sources in Routine → Components; local JSON bundles need no network. Refresh uses no model calls and never alters active routines.',
      browserWrites: { supportedEngineKind: 'claude (native allowlist and strict MCP); Codex/ACP are refused until their native escape routes can be verifiably disabled; API engines currently have no tools', declaration: { kind: 'agent', effect: 'external-write', writeVia: 'browser', browserTargets: ['https://qa.example.com'] }, approval: 'Exact version in the activation modal; non-production only, no host DevOps adapter required.', runtime: 'Current bound chat only, exact origins; fresh isolated browser session per chat, all network destinations restricted (include required same-task API/CDN origins). Other tools/children receive no grant. Host vault login or human handoff; no typed passwords.', reporting: 'agent_report.browserWrite {outcome: done|partial|not-done,evidence:[read-back or screenshot]}; partial/unknown require reconciliation, not-done may retry.', credentials: 'User CRUD in Credenziali → Siti delle routine, OS-encrypted, exact origin. browser_login never returns a password. Missing/ambiguous credentials or complex forms use handoff_to_user kind login.' },
      workflow: ['app_component_search: metadata only, bounded hits.', 'app_component_stage or app_component_stage_local: inert files, commit/hash identity, licenses and findings.', 'app_component_inspect: manifest/diff by default; filePath/offset/maxCharacters load individual files on demand.', 'app_component_import_propose: selected assets copied into a new sealed draft, through unchanged validators. Use definitionPath for a large JSON proposal.'],
      review: 'Read the selected content and all licenses; explain intended adaptations with a native yes/no/free-text question. Required dependencies and compatibility are review findings, never an automated safety guarantee.',
      update: 'Stage the new pinned version, inspect against the previous digest and propose a new routine version. User approval is required; no installer, hooks, CLI settings, new role or implicit grant.',
    };
    case 'verification': return {
      beforeRun: 'app_flow_doctor checks the exact version snapshot. Unknowns are explicit; it runs nothing and never replaces effect-time checks or approval.',
      afterRun: ['app_flow_dossier: actual receipts, failures, effects and outputs.', 'app_flow_compare_versions: observed outcomes, extra attempts and evidence coverage, not causal rankings.', 'app_flow_eval_suites / app_flow_eval_save / app_flow_eval: immutable tuning/holdout cases checked against recorded runs; absent results stay unknown. No paid executions or auto-promotion.'],
      progress: 'Three identical failures without new host evidence stop automatic retries; explicit user recovery and existing maxAttempts still apply.',
      context: 'app_agent_context shows the frozen launch manifest for an accessible chat; selected/omitted memory and skill hashes, no raw facts or vendor prompt. app_voice_diagnostics exposes content-free observed timings and coverage.',
      learning: 'Capisci questa modifica opens a native choice: brief explanation, guided exploration, or free text. Link exact changes, tests and evidence; distinguish hypotheses from verified causes. Teach-back is optional; approval is never a knowledge score.',
      companion: 'Routine workbench exports aggregate JSON or an offline static HTML report. No prompts, inputs, transcripts, remote control or exposed MCP. Re-export for fresh observations.',
    };
    case 'devops': return {
      adapter: 'devops-write', tool: 'flow_devops_write', grant: 'devopsWrite', operations: [...DEVOPS_WRITE_OPS],
      proposal: 'app_flow_auto_propose', scope: 'Exact organization/projects/fields, run work item, run-created resources and own PR/branch; each operation must be approved.',
      configuration: ['pushTargets: exact repository and workspace input for host git-push.', 'deployTargets: registered exact test targets for test-deploy/test-environment/pr-validation.', 'mentions: approved identities; host milestones control mentions.'],
      buildStatus: { tool: 'flow_pr_build_status', grant: 'test-deploy or pr-validation', scope: 'Latest build of the run-owned PR live merge commit on the approved target; read only.' },
      repeatDeploy: 'One deployment at a time, same exact target, each release retained. Poll test-deploy-status to terminal before deploying the next PR build; releaseId selects a historical receipt.',
      documentation: 'flow_devops_write describes request fields for each operation. Never invent an op or retry a refused operation through shell or another connector.',
    };
    case 'test-targets': return {
      deployment: { kinds: ['app-service', 'deployment-group'], list: 'app_flow_test_targets', inspect: 'app_flow_inspect_test_target (App Service only)', registration: 'The inspector returns a validated configuration and fingerprint. The user saves it in the path returned by app_flow_test_targets, preserving other targets; agents cannot install it.', approval: 'Copy the exact registered target into devopsWrite.deployTargets and propose the required operations in the modal.', appService: 'Configure organization, project, app, connection, queue, artifact and definition identities per target. Whole Parameters.* references use pinned literal defaults; no company, routine or parameter-name special cases.' },
      database: { tool: 'flow_test_db_query', grant: 'testDbRead.targetIds', registration: 'User-managed exact test database allowlist and dedicated read-only login. Missing configuration refuses; never infer test status from a database name.' },
      limits: ['Only supported deployment shapes pass inspection. New supported targets are configuration; a new deployment technology requires a host adapter.', 'Registration grants nothing; runtime revalidates the target and the exact user-approved grant.'],
    };
    default: throw new Error(`Unknown capability section; choose ${FLOW_CAPABILITY_SECTIONS.join(', ')}`);
  }
}
